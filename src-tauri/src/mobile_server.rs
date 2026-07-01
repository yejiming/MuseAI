use crate::agent::sessions::{
    list_agent_sessions_in_dir, load_agent_session_from_dir, save_agent_session_in_dir,
};
use crate::models::{ChatStreamEvent, ChatStreamRequest};
use crate::utils::resolve_document_dir;
use crate::ActiveStreams;
use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, Request, State},
    http::{header, StatusCode},
    response::{sse::Event, IntoResponse, Response, Sse},
    routing::{get, post, put},
    Router,
};
use futures_util::stream::Stream;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MobileServiceStatus {
    pub is_running: bool,
    pub url: Option<String>,
    pub token: Option<String>,
    pub error: Option<String>,
}

static MOBILE_SERVICE_STATUS: OnceLock<Mutex<MobileServiceStatus>> = OnceLock::new();
static MOBILE_ACCESS_TOKEN: OnceLock<String> = OnceLock::new();

static SSE_DISPATCHER: OnceLock<Mutex<HashMap<String, UnboundedSender<ChatStreamEvent>>>> =
    OnceLock::new();
static SSE_RECEIVERS: OnceLock<Mutex<HashMap<String, UnboundedReceiver<ChatStreamEvent>>>> =
    OnceLock::new();
/// Stores the concrete AppHandle<Wry> once at app startup so that route handlers
/// (which are generic over R: Runtime) can call Tauri commands without unsafe transmute.
static WRY_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Called once from lib.rs during setup to register the concrete Wry AppHandle.
/// Must be called before the mobile server starts accepting requests.
pub fn register_wry_handle(handle: AppHandle) {
    let _ = WRY_APP_HANDLE.set(handle);
}

pub fn sse_dispatcher() -> &'static Mutex<HashMap<String, UnboundedSender<ChatStreamEvent>>> {
    SSE_DISPATCHER.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn sse_receivers() -> &'static Mutex<HashMap<String, UnboundedReceiver<ChatStreamEvent>>> {
    SSE_RECEIVERS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn clean_stream(run_id: &str) {
    if let Some(dispatcher) = SSE_DISPATCHER.get() {
        dispatcher.lock().unwrap().remove(run_id);
    }
    if let Some(receivers) = SSE_RECEIVERS.get() {
        receivers.lock().unwrap().remove(run_id);
    }
}

pub fn get_mobile_access_token() -> &'static str {
    MOBILE_ACCESS_TOKEN.get_or_init(|| uuid::Uuid::new_v4().to_string())
}

pub fn get_status() -> MobileServiceStatus {
    MOBILE_SERVICE_STATUS
        .get_or_init(|| {
            Mutex::new(MobileServiceStatus {
                is_running: false,
                url: None,
                token: None,
                error: None,
            })
        })
        .lock()
        .unwrap()
        .clone()
}

pub fn set_status(status: MobileServiceStatus) {
    let cell = MOBILE_SERVICE_STATUS.get_or_init(|| {
        Mutex::new(MobileServiceStatus {
            is_running: false,
            url: None,
            token: None,
            error: None,
        })
    });
    *cell.lock().unwrap() = status;
}

pub fn dispatch_stream_event<R: Runtime>(app: &AppHandle<R>, run_id: &str, event: ChatStreamEvent) {
    let _ = app.emit("agent-chat-stream", event.clone());
    if let Some(dispatcher) = SSE_DISPATCHER.get() {
        let lock = dispatcher.lock().unwrap();
        if let Some(sender) = lock.get(run_id) {
            let _ = sender.send(event);
        }
    }
}

pub fn get_lan_ip() -> Option<IpAddr> {
    #[cfg(target_os = "macos")]
    {
        for interface in &["en0", "en1", "en2", "en3", "en4"] {
            if let Some(ip) = get_mac_interface_ip(interface) {
                return Some(ip);
            }
        }
    }

    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    Some(socket.local_addr().ok()?.ip())
}

#[cfg(target_os = "macos")]
fn get_mac_interface_ip(interface: &str) -> Option<IpAddr> {
    let output = std::process::Command::new("ipconfig")
        .args(["getifaddr", interface])
        .output()
        .ok()?;
    if output.status.success() {
        let ip_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if let Ok(ip) = ip_str.parse::<IpAddr>() {
            return Some(ip);
        }
    }
    None
}

fn parse_query(query: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for part in query.split('&') {
        let mut key_val = part.splitn(2, '=');
        if let (Some(k), Some(v)) = (key_val.next(), key_val.next()) {
            map.insert(k.to_string(), v.to_string());
        }
    }
    map
}

fn is_public_path(path: &str) -> bool {
    matches!(path, "/" | "/api/mobile/status") || path.starts_with("/assets/")
}

fn extract_token_from_cookies(cookie_header: &str) -> Option<String> {
    cookie_header.split(';').find_map(|kv| {
        let mut parts = kv.splitn(2, '=');
        let key = parts.next()?.trim();
        let val = parts.next()?.trim();
        if key == "mobile_token" {
            Some(val.to_string())
        } else {
            None
        }
    })
}

fn validate_token(req: &Request) -> bool {
    let path = req.uri().path();
    if is_public_path(path) {
        return true;
    }

    let expected = get_mobile_access_token();

    if let Some(header_val) = req.headers().get("X-Mobile-Token") {
        if let Ok(s) = header_val.to_str() {
            if s == expected {
                return true;
            }
        }
    }

    if let Some(query) = req.uri().query() {
        if let Some(token) = parse_query(query).get("token") {
            if token == expected {
                return true;
            }
        }
    }

    if let Some(cookie_header) = req.headers().get(header::COOKIE) {
        if let Ok(s) = cookie_header.to_str() {
            if let Some(token) = extract_token_from_cookies(s) {
                if token == expected {
                    return true;
                }
            }
        }
    }

    false
}

async fn auth_middleware(
    req: Request,
    next: axum::middleware::Next,
) -> Result<Response, StatusCode> {
    let path = req.uri().path().to_string();
    let query = req.uri().query().map(|q| q.to_string());

    if validate_token(&req) {
        let mut response = next.run(req).await;
        if path == "/" {
            if let Some(ref q) = query {
                if let Some(token) = parse_query(q).get("token") {
                    if let Ok(cookie_val) = header::HeaderValue::from_str(&format!(
                        "mobile_token={}; Path=/; HttpOnly; SameSite=Lax",
                        token
                    )) {
                        response
                            .headers_mut()
                            .append(header::SET_COOKIE, cookie_val);
                    }
                }
            }
        }
        Ok(response)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

fn get_mime_type(path: &str) -> &'static str {
    if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".js") {
        "application/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "image/jpeg"
    } else if path.ends_with(".json") {
        "application/json; charset=utf-8"
    } else {
        "application/octet-stream"
    }
}

fn serve_asset_by_path<R: Runtime>(app: &AppHandle<R>, path: &str) -> Response {
    if let Some(asset) = app.asset_resolver().get(path.to_string()) {
        let content_type = get_mime_type(path);
        Response::builder()
            .header(header::CONTENT_TYPE, content_type)
            .body(Body::from(asset.bytes))
            .unwrap()
    } else {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not Found"))
            .unwrap()
    }
}

async fn serve_html<R: Runtime>(State(app): State<AppHandle<R>>) -> Response {
    serve_asset_by_path(&app, "index.html")
}

async fn serve_static_assets<R: Runtime>(
    State(app): State<AppHandle<R>>,
    AxumPath(path): AxumPath<String>,
) -> Response {
    let full_path = format!("assets/{}", path);
    serve_asset_by_path(&app, &full_path)
}

async fn get_mobile_status() -> impl IntoResponse {
    let status = get_status();
    axum::Json(status)
}

fn sanitize_settings_state(val: &mut Value) {
    if let Some(obj) = val.as_object_mut() {
        for (k, v) in obj.iter_mut() {
            if k == "llmApiKey" || k == "apiKey" {
                *v = Value::String("".to_string());
            } else {
                sanitize_settings_state(v);
            }
        }
    } else if let Some(arr) = val.as_array_mut() {
        for item in arr.iter_mut() {
            sanitize_settings_state(item);
        }
    }
}

fn merge_settings_preserving_keys(existing: &mut Value, incoming: &Value) {
    match (existing, incoming) {
        (Value::Object(ext_map), Value::Object(inc_map)) => {
            for (k, inc_val) in inc_map.iter() {
                if k == "llmApiKey" || k == "apiKey" {
                    if let Some(s) = inc_val.as_str() {
                        if s.is_empty() {
                            continue;
                        }
                    }
                }
                if let Some(ext_val) = ext_map.get_mut(k) {
                    merge_settings_preserving_keys(ext_val, inc_val);
                } else {
                    ext_map.insert(k.clone(), inc_val.clone());
                }
            }
        }
        (Value::Array(ext_arr), Value::Array(inc_arr)) => {
            for (i, inc_val) in inc_arr.iter().enumerate() {
                if i < ext_arr.len() {
                    merge_settings_preserving_keys(&mut ext_arr[i], inc_val);
                } else {
                    ext_arr.push(inc_val.clone());
                }
            }
            if ext_arr.len() > inc_arr.len() {
                ext_arr.truncate(inc_arr.len());
            }
        }
        (ext_val, inc_val) => {
            *ext_val = inc_val.clone();
        }
    }
}

async fn get_app_state<R: Runtime>(
    State(app): State<AppHandle<R>>,
    AxumPath(name): AxumPath<String>,
) -> Result<Response, (StatusCode, String)> {
    let allowed = [
        "settings-store",
        "partner-store",
        "partner-chat-store",
        "story-store",
    ];
    if !allowed.contains(&name.as_str()) {
        return Err((StatusCode::FORBIDDEN, "未授权访问该配置".to_string()));
    }

    let doc_dir = resolve_document_dir(&app)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let content = crate::commands::workspace::load_app_state_path(&doc_dir, &name)
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;

    if name == "settings-store" {
        if let Ok(mut json_val) = serde_json::from_str::<Value>(&content) {
            sanitize_settings_state(&mut json_val);
            let sanitized = serde_json::to_string(&json_val)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            return Ok(Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .header(
                    header::CACHE_CONTROL,
                    "no-store, no-cache, must-revalidate, max-age=0",
                )
                .body(Body::from(sanitized))
                .unwrap());
        }
    }

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .header(
            header::CACHE_CONTROL,
            "no-store, no-cache, must-revalidate, max-age=0",
        )
        .body(Body::from(content))
        .unwrap())
}

async fn save_app_state<R: Runtime>(
    State(app): State<AppHandle<R>>,
    AxumPath(name): AxumPath<String>,
    body: String,
) -> Result<Response, (StatusCode, String)> {
    let allowed = [
        "settings-store",
        "partner-store",
        "partner-chat-store",
        "story-store",
    ];
    if !allowed.contains(&name.as_str()) {
        return Err((StatusCode::FORBIDDEN, "未授权保存该配置".to_string()));
    }

    let doc_dir = resolve_document_dir(&app)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let final_content = if name == "settings-store" {
        let incoming_json: Value = serde_json::from_str(&body)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON: {}", e)))?;

        let existing_content =
            crate::commands::workspace::load_app_state_path(&doc_dir, &name).ok();
        if let Some(existing_str) = existing_content {
            if let Ok(mut existing_json) = serde_json::from_str::<Value>(&existing_str) {
                merge_settings_preserving_keys(&mut existing_json, &incoming_json);
                serde_json::to_string_pretty(&existing_json)
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            } else {
                body
            }
        } else {
            body
        }
    } else {
        body
    };

    crate::commands::workspace::save_app_state_path(&doc_dir, &name, &final_content)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .body(Body::empty())
        .unwrap())
}

async fn list_sessions<R: Runtime>(
    State(app): State<AppHandle<R>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, (StatusCode, String)> {
    let prefix = params
        .get("prefix")
        .map(String::as_str)
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "缺少会话前缀".to_string()))?;
    if prefix != "partner-session-" && prefix != "story-session-" {
        return Err((StatusCode::BAD_REQUEST, "不合法的会话前缀".to_string()));
    }
    let session_kind = if prefix == "story-session-" {
        let requested = params
            .get("sessionKind")
            .map(String::as_str)
            .unwrap_or("story");
        if requested != "story" {
            return Err((StatusCode::BAD_REQUEST, "不合法的会话类型".to_string()));
        }
        Some("story")
    } else {
        None
    };
    let doc_dir = resolve_document_dir(&app)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let dir = doc_dir.join("MuseAI").join("agent-sessions");
    let summaries = list_agent_sessions_in_dir(&dir, Some(prefix), session_kind)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let body = serde_json::to_string(&summaries)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .header(
            header::CACHE_CONTROL,
            "no-store, no-cache, must-revalidate, max-age=0",
        )
        .body(Body::from(body))
        .unwrap())
}

async fn load_session<R: Runtime>(
    State(app): State<AppHandle<R>>,
    AxumPath(id): AxumPath<String>,
) -> Result<Response, (StatusCode, String)> {
    if !id.starts_with("partner-session-") && !id.starts_with("story-session-") {
        return Err((
            StatusCode::FORBIDDEN,
            "禁止访问非伴侣或故事会话".to_string(),
        ));
    }

    let doc_dir = resolve_document_dir(&app)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let dir = doc_dir.join("MuseAI").join("agent-sessions");
    let record = load_agent_session_from_dir(&dir, &id).map_err(|e| (StatusCode::NOT_FOUND, e))?;
    if id.starts_with("story-session-")
        && !matches!(record.session_kind.as_deref(), None | Some("story"))
    {
        return Err((StatusCode::FORBIDDEN, "禁止访问穿书会话".to_string()));
    }
    let text = serde_json::to_string(&record)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .header(
            header::CACHE_CONTROL,
            "no-store, no-cache, must-revalidate, max-age=0",
        )
        .body(Body::from(text))
        .unwrap())
}

async fn save_session<R: Runtime>(
    State(app): State<AppHandle<R>>,
    body: String,
) -> Result<Response, (StatusCode, String)> {
    let mut record: crate::models::AgentSessionRecord = serde_json::from_str(&body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON: {}", e)))?;

    if !record.id.starts_with("partner-session-") && !record.id.starts_with("story-session-") {
        return Err((
            StatusCode::FORBIDDEN,
            "禁止保存非伴侣或故事会话".to_string(),
        ));
    }
    if record.id.starts_with("story-session-") {
        match record.session_kind.as_deref() {
            None => record.session_kind = Some("story".to_string()),
            Some("story") => {}
            Some(_) => {
                return Err((StatusCode::FORBIDDEN, "禁止保存穿书会话".to_string()));
            }
        }
    } else if record.session_kind.is_some() {
        return Err((StatusCode::BAD_REQUEST, "聊天会话不应包含会话类型".to_string()));
    }

    let doc_dir = resolve_document_dir(&app)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let dir = doc_dir.join("MuseAI").join("agent-sessions");
    let summary = save_agent_session_in_dir(&dir, record)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let resp_body = serde_json::to_string(&summary)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .header(
            header::CACHE_CONTROL,
            "no-store, no-cache, must-revalidate, max-age=0",
        )
        .body(Body::from(resp_body))
        .unwrap())
}

async fn delete_session<R: Runtime>(
    State(app): State<AppHandle<R>>,
    AxumPath(id): AxumPath<String>,
) -> Result<Response, (StatusCode, String)> {
    if !id.starts_with("partner-session-") && !id.starts_with("story-session-") {
        return Err((
            StatusCode::FORBIDDEN,
            "禁止删除非伴侣或故事会话".to_string(),
        ));
    }

    let doc_dir = resolve_document_dir(&app)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let path = doc_dir
        .join("MuseAI")
        .join("agent-sessions")
        .join(format!("{}.json", id));
    if path.exists() {
        fs::remove_file(path).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    Ok(Response::builder()
        .status(StatusCode::OK)
        .body(Body::empty())
        .unwrap())
}

async fn update_session_title<R: Runtime>(
    State(app): State<AppHandle<R>>,
    AxumPath(id): AxumPath<String>,
    body: String,
) -> Result<Response, (StatusCode, String)> {
    if !id.starts_with("partner-session-") && !id.starts_with("story-session-") {
        return Err((
            StatusCode::FORBIDDEN,
            "禁止更新非伴侣或故事会话".to_string(),
        ));
    }

    #[derive(Deserialize)]
    struct TitleUpdate {
        title: String,
    }
    let payload: TitleUpdate = serde_json::from_str(&body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON: {}", e)))?;

    let doc_dir = resolve_document_dir(&app)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let path = doc_dir
        .join("MuseAI")
        .join("agent-sessions")
        .join(format!("{}.json", id));
    let text = fs::read_to_string(&path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut record: crate::models::AgentSessionRecord = serde_json::from_str(&text)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    record.title = payload.title;
    record.saved_at = current_timestamp_millis();
    let updated_text = serde_json::to_string_pretty(&record)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    fs::write(path, updated_text)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let summary = crate::models::AgentSessionSummary {
        id: record.id.clone(),
        title: record.title.clone(),
        saved_at: record.saved_at,
        session_kind: record.session_kind,
        character_card_id: record.character_card_id,
        character_card_ids: record.character_card_ids,
        selected_world_book_id: record.selected_world_book_id,
        dynamic_role_loading_enabled: record.dynamic_role_loading_enabled,
    };

    let resp_body = serde_json::to_string(&summary)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .header(
            header::CACHE_CONTROL,
            "no-store, no-cache, must-revalidate, max-age=0",
        )
        .body(Body::from(resp_body))
        .unwrap())
}

async fn summarize_title<R: Runtime>(
    State(app): State<AppHandle<R>>,
    body: String,
) -> Result<Response, (StatusCode, String)> {
    #[derive(Deserialize)]
    struct SummarizePayload {
        text: String,
    }
    let payload: SummarizePayload = serde_json::from_str(&body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON: {}", e)))?;

    let doc_dir = resolve_document_dir(&app)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let settings_str = crate::commands::workspace::load_app_state_path(&doc_dir, "settings-store")
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load settings: {}", e),
            )
        })?;
    let settings_val: Value = serde_json::from_str(&settings_str).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to parse settings: {}", e),
        )
    })?;

    let state = settings_val.get("state").ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Invalid settings".to_string(),
        )
    })?;
    let model_interface = state
        .get("modelInterface")
        .and_then(|v| v.as_str())
        .unwrap_or("OpenAI")
        .to_string();
    let base_url = state
        .get("llmBaseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let api_key = state
        .get("llmApiKey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let model = state
        .get("llmModel")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if api_key.is_empty() || model.is_empty() || base_url.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "大模型配置缺失，请先在桌面端设置".to_string(),
        ));
    }

    let request = crate::models::SummarizeRequest {
        model_interface,
        base_url,
        api_key,
        model,
        temperature: Some(0.3),
        max_output_tokens: Some(64),
        text: payload.text,
    };

    let title = crate::agent::sessions::summarize_text(request)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .header(
            header::CACHE_CONTROL,
            "no-store, no-cache, must-revalidate, max-age=0",
        )
        .body(Body::from(
            serde_json::to_string(&json!({ "title": title })).unwrap(),
        ))
        .unwrap())
}

async fn analyze_session_memory<R: Runtime>(
    State(app): State<AppHandle<R>>,
    AxumPath(id): AxumPath<String>,
    body: String,
) -> Result<Response, (StatusCode, String)> {
    if !id.starts_with("partner-session-") && !id.starts_with("story-session-") {
        return Err((StatusCode::FORBIDDEN, "不合法的会话ID".to_string()));
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AnalyzePayload {
        character_card_id: Option<String>,
    }
    let payload = if body.trim().is_empty() {
        AnalyzePayload {
            character_card_id: None,
        }
    } else {
        serde_json::from_str::<AnalyzePayload>(&body)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON: {}", e)))?
    };

    let doc_dir = resolve_document_dir(&app)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_path = doc_dir
        .join("MuseAI")
        .join("agent-sessions")
        .join(format!("{}.json", id));
    let session_text =
        fs::read_to_string(session_path).map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;
    let session: crate::models::AgentSessionRecord = serde_json::from_str(&session_text)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let settings_str = crate::commands::workspace::load_app_state_path(&doc_dir, "settings-store")
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load settings: {}", e),
            )
        })?;
    let settings_val: Value = serde_json::from_str(&settings_str).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to parse settings: {}", e),
        )
    })?;

    let state = settings_val.get("state").ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Invalid settings".to_string(),
        )
    })?;
    let model_interface = state
        .get("modelInterface")
        .and_then(|v| v.as_str())
        .unwrap_or("OpenAI")
        .to_string();
    let base_url = state
        .get("llmBaseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let api_key = state
        .get("llmApiKey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let model = state
        .get("llmModel")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if api_key.is_empty() || model.is_empty() || base_url.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "大模型配置缺失，请先在桌面端设置".to_string(),
        ));
    }

    let partner_str = crate::commands::workspace::load_app_state_path(&doc_dir, "partner-store")
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load partner-store: {}", e),
            )
        })?;
    let partner_val: Value = serde_json::from_str(&partner_str).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to parse partner-store: {}", e),
        )
    })?;
    let partner_state = partner_val.get("state").ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Invalid partner-store structure".to_string(),
        )
    })?;
    let character_cards = partner_state
        .get("characterCards")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "characterCards missing".to_string(),
            )
        })?;

    let mut relation_type = String::new();
    let mut interaction_model = String::new();
    let mut relation_bottom_line = String::new();
    let mut key_events = String::new();
    let mut character_names = Vec::new();
    let mut target_character_name: Option<String> = None;
    let mut target_character_content: Option<String> = None;

    if id.starts_with("partner-session-") {
        let card_id = session
            .character_card_id
            .as_ref()
            .ok_or_else(|| (StatusCode::BAD_REQUEST, "会话未绑定角色卡".to_string()))?;
        if let Some(card) = character_cards
            .iter()
            .find(|cc| cc.get("id").and_then(|v| v.as_str()) == Some(card_id))
        {
            let name = card.get("name").and_then(|v| v.as_str()).unwrap_or("");
            character_names.push(name.to_string());
            target_character_name = Some(name.to_string());
            target_character_content = card
                .get("content")
                .and_then(|v| v.as_str())
                .map(|content| content.to_string());
            if let Some(fields) = card.get("fields") {
                relation_type = fields
                    .get("userRelationType")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                interaction_model = fields
                    .get("userInteractionModel")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                relation_bottom_line = fields
                    .get("userRelationBottomLine")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                key_events = fields
                    .get("keyEvents")
                    .and_then(|v| v.as_str())
                    .unwrap_or("暂无共同经历的关键事件。")
                    .to_string();
            }
        }
    } else {
        let card_ids = session
            .character_card_ids
            .as_ref()
            .ok_or_else(|| (StatusCode::BAD_REQUEST, "会话未绑定角色卡".to_string()))?;
        let requested_card_id = payload
            .character_card_id
            .as_deref()
            .unwrap_or_else(|| card_ids.first().map(|id| id.as_str()).unwrap_or(""));
        if requested_card_id.is_empty() || !card_ids.iter().any(|id| id == requested_card_id) {
            return Err((
                StatusCode::BAD_REQUEST,
                "目标角色卡不属于当前会话".to_string(),
            ));
        }
        for card_id in card_ids {
            if card_id != requested_card_id {
                continue;
            }
            if let Some(card) = character_cards
                .iter()
                .find(|cc| cc.get("id").and_then(|v| v.as_str()) == Some(card_id))
            {
                let name = card.get("name").and_then(|v| v.as_str()).unwrap_or("");
                character_names.push(name.to_string());
                if target_character_name.is_none() {
                    target_character_name = Some(name.to_string());
                    target_character_content = card
                        .get("content")
                        .and_then(|v| v.as_str())
                        .map(|content| content.to_string());
                }
                if let Some(fields) = card.get("fields") {
                    if relation_type.is_empty() {
                        relation_type = fields
                            .get("userRelationType")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        interaction_model = fields
                            .get("userInteractionModel")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        relation_bottom_line = fields
                            .get("userRelationBottomLine")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        key_events = fields
                            .get("keyEvents")
                            .and_then(|v| v.as_str())
                            .unwrap_or("暂无共同经历的关键事件。")
                            .to_string();
                    }
                }
            }
        }
    }

    let chat_history_text = session
        .messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "agent")
        .map(|m| {
            let sender = if m.role == "user" {
                "我".to_string()
            } else if character_names.len() == 1 {
                character_names[0].clone()
            } else if id.starts_with("story-session-") {
                "故事旁白与NPC".to_string()
            } else {
                "AI伴侣".to_string()
            };
            let clean_content = m.content.clone();
            let re = regex::Regex::new(r"\[\[THINKING:[^\]]+\]\]").unwrap();
            let clean_content = re.replace_all(&clean_content, "").trim().to_string();
            format!("{}: {}", sender, clean_content)
        })
        .filter(|line| !line.ends_with(": "))
        .collect::<Vec<_>>()
        .join("\n\n");

    let request = crate::models::AnalyzeMemoryRequest {
        model_interface,
        base_url,
        api_key,
        model,
        temperature: Some(0.7),
        max_output_tokens: Some(4096),
        thinking_depth: Some("off".to_string()),
        chat_history: chat_history_text,
        target_character_name,
        target_character_content,
        current_user_relation_type: relation_type,
        current_user_interaction_model: interaction_model,
        current_user_relation_bottom_line: relation_bottom_line,
        current_events: key_events,
        system_prompt: None,
    };

    let result_str = crate::agent::sessions::analyze_character_memory(request)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .header(
            header::CACHE_CONTROL,
            "no-store, no-cache, must-revalidate, max-age=0",
        )
        .body(Body::from(result_str))
        .unwrap())
}

async fn convert_character_card_to_silly_tavern_endpoint<R: Runtime>(
    State(app): State<AppHandle<R>>,
    body: String,
) -> Result<Response, (StatusCode, String)> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ConvertPayload {
        source_character_card: Value,
        world_book_entries: Option<Value>,
        system_prompt: Option<String>,
    }
    let payload: ConvertPayload = serde_json::from_str(&body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON: {}", e)))?;

    let doc_dir = resolve_document_dir(&app)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let settings_str = crate::commands::workspace::load_app_state_path(&doc_dir, "settings-store")
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load settings: {}", e),
            )
        })?;
    let settings_val: Value = serde_json::from_str(&settings_str)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to parse settings: {}", e)))?;
    let state = settings_val.get("state").ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Invalid settings".to_string(),
        )
    })?;

    let model_interface = state
        .get("modelInterface")
        .and_then(|v| v.as_str())
        .unwrap_or("OpenAI")
        .to_string();
    let base_url = state
        .get("llmBaseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let api_key = state
        .get("llmApiKey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let model = state
        .get("llmModel")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if api_key.is_empty() || model.is_empty() || base_url.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "大模型配置缺失，请先在桌面端设置".to_string(),
        ));
    }

    let agent_config = state
        .get("agentConfigs")
        .and_then(|c| c.get("sillyTavernExporter"));
    let temperature = agent_config
        .and_then(|c| c.get("temperature"))
        .and_then(|v| v.as_f64())
        .map(|f| f as f32);
    let max_output_tokens = agent_config
        .and_then(|c| c.get("maxOutputTokens"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);
    let thinking_depth = agent_config
        .and_then(|c| c.get("thinkingDepth"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let request = crate::models::ConvertCharacterCardToSillyTavernRequest {
        model_interface,
        base_url,
        api_key,
        model,
        temperature,
        max_output_tokens,
        thinking_depth,
        source_character_card: payload.source_character_card,
        world_book_entries: payload.world_book_entries,
        system_prompt: payload.system_prompt,
    };

    let result_str = crate::agent::sessions::convert_character_card_to_silly_tavern(request)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .header(
            header::CACHE_CONTROL,
            "no-store, no-cache, must-revalidate, max-age=0",
        )
        .body(Body::from(result_str))
        .unwrap())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchivePayload {
    title: String,
    user_relation_type: Option<String>,
    user_interaction_model: Option<String>,
    user_relation_bottom_line: Option<String>,
    key_events: Option<String>,
    character_memories: Option<Vec<ArchiveCharacterMemory>>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveCharacterMemory {
    character_card_id: String,
    user_relation_type: String,
    user_interaction_model: String,
    user_relation_bottom_line: String,
    key_events: String,
}

fn apply_archive_payload_to_partner_store(
    partner_json: &mut Value,
    card_ids: &[String],
    payload: &ArchivePayload,
) -> usize {
    let character_memories = payload.character_memories.clone().unwrap_or_else(|| {
        card_ids
            .iter()
            .map(|id| ArchiveCharacterMemory {
                character_card_id: id.clone(),
                user_relation_type: payload.user_relation_type.clone().unwrap_or_default(),
                user_interaction_model: payload.user_interaction_model.clone().unwrap_or_default(),
                user_relation_bottom_line: payload
                    .user_relation_bottom_line
                    .clone()
                    .unwrap_or_default(),
                key_events: payload.key_events.clone().unwrap_or_default(),
            })
            .collect()
    });

    let mut updated_card_count = 0usize;
    if let Some(state) = partner_json.get_mut("state") {
        if let Some(character_cards) = state
            .get_mut("characterCards")
            .and_then(|v| v.as_array_mut())
        {
            for cc in character_cards.iter_mut() {
                if let Some(cc_id) = cc.get("id").and_then(|v| v.as_str()) {
                    if let Some(memory) = character_memories.iter().find(|memory| {
                        memory.character_card_id == cc_id && card_ids.contains(&cc_id.to_string())
                    }) {
                        let name = cc
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if !cc.get("fields").map(|v| v.is_object()).unwrap_or(false) {
                            cc["fields"] = json!({});
                        }
                        if let Some(fields) = cc.get_mut("fields").and_then(|v| v.as_object_mut()) {
                            fields.insert(
                                "userRelationType".to_string(),
                                Value::String(memory.user_relation_type.clone()),
                            );
                            fields.insert(
                                "userInteractionModel".to_string(),
                                Value::String(memory.user_interaction_model.clone()),
                            );
                            fields.insert(
                                "userRelationBottomLine".to_string(),
                                Value::String(memory.user_relation_bottom_line.clone()),
                            );
                            fields.insert(
                                "keyEvents".to_string(),
                                Value::String(memory.key_events.clone()),
                            );

                            let fields_val = Value::Object(fields.clone());
                            let new_content = compile_character_card_markdown(&name, &fields_val);
                            cc["content"] = Value::String(new_content);
                            updated_card_count += 1;
                        }
                    }
                }
            }
        }
    }
    updated_card_count
}

async fn archive_session_memory<R: Runtime>(
    State(app): State<AppHandle<R>>,
    AxumPath(id): AxumPath<String>,
    body: String,
) -> Result<Response, (StatusCode, String)> {
    if !id.starts_with("partner-session-") && !id.starts_with("story-session-") {
        return Err((StatusCode::FORBIDDEN, "不合法的会话ID".to_string()));
    }

    let payload: ArchivePayload = serde_json::from_str(&body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON: {}", e)))?;

    let doc_dir = resolve_document_dir(&app)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_path = doc_dir
        .join("MuseAI")
        .join("agent-sessions")
        .join(format!("{}.json", id));
    let session_text =
        fs::read_to_string(&session_path).map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;
    let mut session: crate::models::AgentSessionRecord = serde_json::from_str(&session_text)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let partner_str = crate::commands::workspace::load_app_state_path(&doc_dir, "partner-store")
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load partner-store: {}", e),
            )
        })?;
    let mut partner_json: Value = serde_json::from_str(&partner_str).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to parse partner-store: {}", e),
        )
    })?;

    let card_ids: Vec<String> = if id.starts_with("partner-session-") {
        session.character_card_id.clone().into_iter().collect()
    } else {
        session.character_card_ids.clone().unwrap_or_default()
    };

    let updated_card_count =
        apply_archive_payload_to_partner_store(&mut partner_json, &card_ids, &payload);

    if updated_card_count == 0 {
        return Err((StatusCode::NOT_FOUND, "未找到需要更新的角色卡".to_string()));
    }

    let updated_partner_str = serde_json::to_string_pretty(&partner_json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    crate::commands::workspace::save_app_state_path(
        &doc_dir,
        "partner-store",
        &updated_partner_str,
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to save partner-store: {}", e),
        )
    })?;

    session.title = payload.title.clone();
    session.is_archived = Some(true);
    session.saved_at = current_timestamp_millis();

    let session_save_path = doc_dir
        .join("MuseAI")
        .join("agent-sessions")
        .join(format!("{}.json", session.id));
    let text = serde_json::to_string_pretty(&session)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    fs::write(session_save_path, text)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let _ = app.emit("partner-store-updated", ());

    Ok(Response::builder()
        .status(StatusCode::OK)
        .body(Body::empty())
        .unwrap())
}

fn compile_character_card_markdown(name: &str, fields: &Value) -> String {
    let get_field = |key: &str| -> String {
        fields
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    let field_line = |label: &str, key: &str| -> Option<String> {
        let val = get_field(key);
        if val.trim().is_empty() {
            None
        } else {
            Some(format!("- **{}**：{}", label, val))
        }
    };

    let section = |title: &str, lines: Vec<Option<String>>| -> String {
        let valid: Vec<String> = lines.into_iter().flatten().collect();
        if valid.is_empty() {
            String::new()
        } else {
            format!("## {}\n{}\n\n", title, valid.join("\n"))
        }
    };

    let block_section = |title: &str, key: &str| -> String {
        let val = get_field(key);
        if val.trim().is_empty() {
            String::new()
        } else {
            format!("## {}\n{}\n\n", title, val)
        }
    };

    let tags_str = if let Some(tags) = fields.get("identityTags").and_then(|v| v.as_array()) {
        let s: String = tags
            .iter()
            .map(|t| format!("`{}`", t.as_str().unwrap_or("")))
            .collect::<Vec<_>>()
            .join(" ");
        if s.trim().is_empty() {
            String::new()
        } else {
            format!("## 身份标签\n{}\n\n", s)
        }
    } else {
        String::new()
    };

    let basic = section(
        "基础信息",
        vec![
            field_line("姓名", "").map(|_| format!("- **姓名**：{}", name)),
            field_line("年龄", "age"),
            field_line("性别", "gender"),
            field_line("种族", "race"),
            field_line("出生地", "birthplace"),
            field_line("职业", "occupation"),
            field_line("社会阶层", "socialClass"),
        ],
    );

    let appearance = section(
        "外貌气质",
        vec![
            field_line("身高体型", "heightBuild"),
            field_line("标志性特征", "iconicFeatures"),
            field_line("衣着风格", "clothingStyle"),
            field_line("整体气质", "overallVibe"),
        ],
    );

    let personality = section(
        "性格特征",
        vec![
            field_line("外在性格", "externalPersonality"),
            field_line("内在性格", "internalPersonality"),
            field_line("核心欲望", "coreDesire"),
            field_line("恐惧和弱点", "fearWeakness"),
            field_line("道德观念", "moralValues"),
            field_line("怪癖", "quirk"),
        ],
    );

    let skills = block_section("技能专长", "skills");
    let background = block_section("背景故事", "backgroundStory");
    let relationships = block_section("人际关系", "relationships");
    let speaking = block_section("说话方式", "speakingStyle");
    let reactions = block_section("典型反应", "typicalReactions");

    let memory = section(
        "角色记忆",
        vec![
            field_line("与用户关系类型", "userRelationType"),
            field_line("与用户相处模式", "userInteractionModel"),
            field_line("与用户关系底线", "userRelationBottomLine"),
        ],
    );

    let events = block_section("关键事件", "keyEvents");

    let result = format!(
        "# 角色卡：{}\n\n{}{}{}{}{}{}{}{}{}{}{}",
        name,
        basic,
        tags_str,
        appearance,
        personality,
        skills,
        background,
        relationships,
        speaking,
        reactions,
        memory,
        events
    );
    result.trim().to_string() + "\n"
}

fn current_timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

async fn start_run_endpoint<R: Runtime>(
    State(app): State<AppHandle<R>>,
    body: String,
) -> Result<Response, (StatusCode, String)> {
    let doc_dir = resolve_document_dir(&app)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let settings_str = crate::commands::workspace::load_app_state_path(&doc_dir, "settings-store")
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load settings: {}", e),
            )
        })?;
    let settings_val: Value = serde_json::from_str(&settings_str).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to parse settings: {}", e),
        )
    })?;
    let state = settings_val.get("state").ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Invalid settings".to_string(),
        )
    })?;

    let model_interface = state
        .get("modelInterface")
        .and_then(|v| v.as_str())
        .unwrap_or("OpenAI")
        .to_string();
    let base_url = state
        .get("llmBaseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let api_key = state
        .get("llmApiKey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let model = state
        .get("llmModel")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let mut req_body: Value = serde_json::from_str(&body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON body: {}", e)))?;

    if let Some(obj) = req_body.as_object_mut() {
        obj.insert("modelInterface".to_string(), Value::String(model_interface));
        obj.insert("baseUrl".to_string(), Value::String(base_url));
        obj.insert("apiKey".to_string(), Value::String(api_key));
        obj.insert("model".to_string(), Value::String(model));
    }

    let chat_request: ChatStreamRequest = serde_json::from_value(req_body).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("Invalid stream request schema: {}", e),
        )
    })?;

    // Use the concrete AppHandle<Wry> registered at startup.
    // This is safe (no unsafe code) and correctly manages Arc refcounts.
    let app_wry = WRY_APP_HANDLE.get().cloned().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "App handle not initialized".to_string(),
        )
    })?;
    let run_id = crate::agent::sessions::start_chat_stream_inner(app_wry, chat_request)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let (tx, rx) = unbounded_channel();
    sse_dispatcher().lock().unwrap().insert(run_id.clone(), tx);
    sse_receivers().lock().unwrap().insert(run_id.clone(), rx);

    let resp = json!({ "runId": run_id });
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .header(
            header::CACHE_CONTROL,
            "no-store, no-cache, must-revalidate, max-age=0",
        )
        .body(Body::from(serde_json::to_string(&resp).unwrap()))
        .unwrap())
}

async fn stop_run_endpoint<R: Runtime>(
    State(app): State<AppHandle<R>>,
    body: String,
) -> Result<Response, (StatusCode, String)> {
    #[derive(Deserialize)]
    struct StopPayload {
        run_id: String,
    }
    let payload: StopPayload = serde_json::from_str(&body).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("Invalid stop payload: {}", e),
        )
    })?;

    let active_streams = app.state::<ActiveStreams>();
    crate::agent::sessions::stop_chat_stream(payload.run_id.clone(), active_streams)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    clean_stream(&payload.run_id);

    Ok(Response::builder()
        .status(StatusCode::OK)
        .body(Body::empty())
        .unwrap())
}

async fn subscribe_stream(
    Query(params): Query<HashMap<String, String>>,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, (StatusCode, String)>
{
    let run_id = params
        .get("runId")
        .cloned()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "runId missing".to_string()))?;

    let rx = sse_receivers()
        .lock()
        .unwrap()
        .remove(&run_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                "No receiver registered for runId".to_string(),
            )
        })?;

    let stream = UnboundedReceiverStream::new(rx).map(|event| {
        let json_str = serde_json::to_string(&event).unwrap_or_default();
        Ok(Event::default().data(json_str))
    });

    Ok(Sse::new(stream))
}

pub fn create_mobile_router<R: Runtime>(app_handle: AppHandle<R>) -> Router {
    Router::new()
        .route("/", get(serve_html::<R>))
        .route("/assets/{*path}", get(serve_static_assets::<R>))
        .route("/api/mobile/status", get(get_mobile_status))
        .route(
            "/api/mobile/state/{name}",
            get(get_app_state::<R>).post(save_app_state::<R>),
        )
        .route(
            "/api/mobile/sessions",
            get(list_sessions::<R>).post(save_session::<R>),
        )
        .route(
            "/api/mobile/sessions/{id}",
            get(load_session::<R>).delete(delete_session::<R>),
        )
        .route(
            "/api/mobile/sessions/{id}/title",
            put(update_session_title::<R>),
        )
        .route(
            "/api/mobile/sessions/{id}/analyze-memory",
            post(analyze_session_memory::<R>),
        )
        .route("/api/mobile/summarize", post(summarize_title::<R>))
        .route(
            "/api/mobile/character-cards/convert-silly-tavern",
            post(convert_character_card_to_silly_tavern_endpoint::<R>),
        )
        .route(
            "/api/mobile/sessions/{id}/archive",
            post(archive_session_memory::<R>),
        )
        .route("/api/mobile/chat/start", post(start_run_endpoint::<R>))
        .route("/api/mobile/story/start", post(start_run_endpoint::<R>))
        .route("/api/mobile/chat/stop", post(stop_run_endpoint::<R>))
        .route("/api/mobile/stream", get(subscribe_stream))
        .fallback(serve_html::<R>)
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(app_handle)
}

pub async fn start_server<R: Runtime>(app_handle: AppHandle<R>) -> Result<(), String> {
    let mut listener = None;
    let mut port = 4080;

    for p in 4080..=4085 {
        let addr = SocketAddr::from(([0, 0, 0, 0], p));
        if let Ok(l) = tokio::net::TcpListener::bind(&addr).await {
            listener = Some(l);
            port = p;
            break;
        }
    }

    let Some(l) = listener else {
        let err_msg = "所有配置端口均被占用".to_string();
        set_status(MobileServiceStatus {
            is_running: false,
            url: None,
            token: None,
            error: Some(err_msg.clone()),
        });
        return Err(err_msg);
    };

    let lan_ip = get_lan_ip().unwrap_or(IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));
    let token = get_mobile_access_token().to_string();
    let url = format!("http://{}:{}/?token={}", lan_ip, port, token);

    set_status(MobileServiceStatus {
        is_running: true,
        url: Some(url),
        token: Some(token),
        error: None,
    });

    let router = create_mobile_router(app_handle);

    tokio::task::spawn(async move {
        let _ = axum::serve(l, router).await;
    });

    Ok(())
}

#[tauri::command]
pub fn get_mobile_service_status() -> Result<MobileServiceStatus, String> {
    Ok(get_status())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tower::util::ServiceExt;

    fn create_mock_app() -> AppHandle<tauri::test::MockRuntime> {
        let builder = tauri::test::mock_builder();
        let app = builder
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        app.handle().clone()
    }

    #[tokio::test]
    async fn test_token_generation() {
        let token1 = get_mobile_access_token();
        let token2 = get_mobile_access_token();
        assert!(!token1.is_empty());
        assert_eq!(token1, token2);
    }

    #[tokio::test]
    async fn test_no_token_rejected() {
        let app = create_mock_app();
        let router = create_mobile_router(app);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/mobile/state/partner-store")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // Protected endpoint without a token must be rejected with UNAUTHORIZED.
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_wrong_token_rejected() {
        let app = create_mock_app();
        let router = create_mobile_router(app);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/mobile/state/partner-store")
                    .header("X-Mobile-Token", "definitely-not-the-real-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_query_token_accepted() {
        let app = create_mock_app();
        let router = create_mobile_router(app);
        let token = get_mobile_access_token();

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/mobile/state/partner-store?token={}",
                        token
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_ne!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_cookie_token_accepted() {
        let app = create_mock_app();
        let router = create_mobile_router(app);
        let token = get_mobile_access_token();

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/mobile/state/partner-store")
                    .header(header::COOKIE, format!("mobile_token={}", token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_ne!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_public_paths_allowed_without_token() {
        let app = create_mock_app();
        let router = create_mobile_router(app);

        for path in &["/", "/api/mobile/status", "/assets/app.js"] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(*path)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_ne!(
                response.status(),
                StatusCode::UNAUTHORIZED,
                "public path {} should not require a token",
                path
            );
        }
    }

    #[tokio::test]
    async fn test_subscribe_stream_no_token_rejected() {
        let app = create_mock_app();
        let router = create_mobile_router(app);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/mobile/stream?runId=test_run_id")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // SSE stream endpoint must require a token before checking run_id presence.
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_authorized_by_header() {
        let app = create_mock_app();
        let router = create_mobile_router(app);
        let token = get_mobile_access_token();

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/mobile/state/partner-store")
                    .header("X-Mobile-Token", token)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_ne!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_desktop_only_route_rejection() {
        let app = create_mock_app();
        let router = create_mobile_router(app);
        let token = get_mobile_access_token();

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/mobile/state/works-store")
                    .header("X-Mobile-Token", token)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_archive_updates_character_memory_without_existing_fields() {
        let mut partner_json = json!({
            "state": {
                "worldBooks": [],
                "characterCards": [
                    {
                        "id": "card-1",
                        "name": "禾禾",
                        "type": "character_card",
                        "content": "# 角色卡：禾禾"
                    }
                ],
                "selectedId": null,
                "selectedType": null
            },
            "version": 0
        });
        let payload = ArchivePayload {
            title: "归档标题".to_string(),
            user_relation_type: Some("伙伴".to_string()),
            user_interaction_model: Some("互相信任".to_string()),
            user_relation_bottom_line: Some("保持坦诚".to_string()),
            key_events: Some("共同完成一次对话".to_string()),
            character_memories: None,
        };
        let updated = apply_archive_payload_to_partner_store(
            &mut partner_json,
            &["card-1".to_string()],
            &payload,
        );

        assert_eq!(updated, 1);
        let fields = &partner_json["state"]["characterCards"][0]["fields"];
        assert_eq!(fields["userRelationType"], "伙伴");
        assert_eq!(fields["keyEvents"], "共同完成一次对话");
        assert!(partner_json["state"]["characterCards"][0]["content"]
            .as_str()
            .unwrap()
            .contains("共同完成一次对话"));
    }

    #[test]
    fn test_archive_updates_each_character_memory_independently() {
        let mut partner_json = json!({
            "state": {
                "worldBooks": [],
                "characterCards": [
                    {
                        "id": "card-1",
                        "name": "禾禾",
                        "type": "character_card",
                        "content": "# 角色卡：禾禾",
                        "fields": {}
                    },
                    {
                        "id": "card-2",
                        "name": "林逸",
                        "type": "character_card",
                        "content": "# 角色卡：林逸",
                        "fields": {}
                    }
                ],
                "selectedId": null,
                "selectedType": null
            },
            "version": 0
        });
        let payload = ArchivePayload {
            title: "归档标题".to_string(),
            user_relation_type: None,
            user_interaction_model: None,
            user_relation_bottom_line: None,
            key_events: None,
            character_memories: Some(vec![
                ArchiveCharacterMemory {
                    character_card_id: "card-1".to_string(),
                    user_relation_type: "伙伴".to_string(),
                    user_interaction_model: "互相信任".to_string(),
                    user_relation_bottom_line: "保持坦诚".to_string(),
                    key_events: "禾禾事件".to_string(),
                },
                ArchiveCharacterMemory {
                    character_card_id: "card-2".to_string(),
                    user_relation_type: "同伴".to_string(),
                    user_interaction_model: "并肩冒险".to_string(),
                    user_relation_bottom_line: "尊重选择".to_string(),
                    key_events: "林逸事件".to_string(),
                },
            ]),
        };

        let updated = apply_archive_payload_to_partner_store(
            &mut partner_json,
            &["card-1".to_string(), "card-2".to_string()],
            &payload,
        );

        assert_eq!(updated, 2);
        assert_eq!(
            partner_json["state"]["characterCards"][0]["fields"]["keyEvents"],
            "禾禾事件"
        );
        assert_eq!(
            partner_json["state"]["characterCards"][1]["fields"]["keyEvents"],
            "林逸事件"
        );
    }

    #[tokio::test]
    async fn test_settings_credential_stripping() {
        let mut settings_json = json!({
            "state": {
                "llmApiKey": "secret-api-key",
                "apiKey": "nested-secret-key",
                "otherConfig": "public-val",
                "modelList": [
                    { "name": "gpt-4", "apiKey": "model-secret" }
                ]
            }
        });

        sanitize_settings_state(&mut settings_json);

        let state = settings_json.get("state").unwrap();
        assert_eq!(state.get("llmApiKey").unwrap().as_str().unwrap(), "");
        assert_eq!(state.get("apiKey").unwrap().as_str().unwrap(), "");
        let model = state
            .get("modelList")
            .unwrap()
            .as_array()
            .unwrap()
            .first()
            .unwrap();
        assert_eq!(model.get("apiKey").unwrap().as_str().unwrap(), "");
        assert_eq!(
            state.get("otherConfig").unwrap().as_str().unwrap(),
            "public-val"
        );
    }

    #[tokio::test]
    async fn test_settings_preserves_keys_on_merge() {
        let mut existing = json!({
            "state": {
                "llmApiKey": "secret-api-key",
                "apiKey": "nested-secret-key",
                "otherConfig": "old-val",
                "modelList": [
                    { "name": "gpt-4", "apiKey": "model-secret" }
                ]
            }
        });

        let incoming = json!({
            "state": {
                "llmApiKey": "",
                "apiKey": "",
                "otherConfig": "new-val",
                "modelList": [
                    { "name": "gpt-4", "apiKey": "" }
                ]
            }
        });

        merge_settings_preserving_keys(&mut existing, &incoming);

        let state = existing.get("state").unwrap();
        assert_eq!(
            state.get("llmApiKey").unwrap().as_str().unwrap(),
            "secret-api-key"
        );
        assert_eq!(
            state.get("apiKey").unwrap().as_str().unwrap(),
            "nested-secret-key"
        );
        assert_eq!(
            state.get("otherConfig").unwrap().as_str().unwrap(),
            "new-val"
        );
        let model = state
            .get("modelList")
            .unwrap()
            .as_array()
            .unwrap()
            .first()
            .unwrap();
        assert_eq!(
            model.get("apiKey").unwrap().as_str().unwrap(),
            "model-secret"
        );
    }

    #[tokio::test]
    async fn test_session_prefix_validation() {
        let app = create_mock_app();
        let router = create_mobile_router(app);
        let token = get_mobile_access_token();

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/mobile/sessions?prefix=works-session-")
                    .header("X-Mobile-Token", token)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_mobile_save_rejects_book_travel_session() {
        let app = create_mock_app();
        let router = create_mobile_router(app);
        let token = get_mobile_access_token();
        let body = json!({
            "id": "story-session-book-travel",
            "title": "穿书记录",
            "savedAt": 0,
            "sessionKind": "bookTravel",
            "messages": [],
            "selectedReferenceFiles": [],
            "selectedOutlineFile": null,
            "todos": [],
            "contextCompaction": null,
            "isArchived": false,
            "characterCardId": null,
            "characterCardIds": [],
            "selectedWorldBookId": null,
            "dynamicRoleLoadingEnabled": false,
            "bookTravelState": {}
        });

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/mobile/sessions")
                    .header("X-Mobile-Token", token)
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn test_get_lan_ip_is_resolvable() {
        let ip = get_lan_ip();
        // Since we are running in a CI/test environment, it might be Some(ip) or None if completely offline.
        // We assert that the function executes without panicking.
        if let Some(resolved) = ip {
            assert!(!resolved.is_loopback());
        }
    }

    #[tokio::test]
    async fn test_convert_silly_tavern_rejects_missing_token() {
        let app = create_mock_app();
        let router = create_mobile_router(app);

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/mobile/character-cards/convert-silly-tavern")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_convert_silly_tavern_accepts_token() {
        let app = create_mock_app();
        let router = create_mobile_router(app);
        let token = get_mobile_access_token();

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/mobile/character-cards/convert-silly-tavern")
                    .header("X-Mobile-Token", token)
                    .body(Body::from(
                        serde_json::to_string(&json!({"sourceCharacterCard": {}})).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        // Auth should pass; the handler will fail on missing settings but not with UNAUTHORIZED.
        assert_ne!(response.status(), StatusCode::UNAUTHORIZED);
    }
}
