use futures_util::StreamExt;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::*;
use crate::llm::*;
use crate::models::*;
use crate::utils::*;
use crate::ActiveStreams;

struct BackgroundTaskTokens {
    tokens: Vec<Arc<AtomicBool>>,
    active_count: Arc<AtomicUsize>,
    cancelled: bool,
}

static BACKGROUND_TASK_CANCELLATION: LazyLock<Mutex<HashMap<String, BackgroundTaskTokens>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn register_cancellation_token(task_id: String) -> Arc<AtomicBool> {
    let token = Arc::new(AtomicBool::new(false));
    let mut map = BACKGROUND_TASK_CANCELLATION.lock().unwrap();
    let entry = map.entry(task_id).or_insert_with(|| BackgroundTaskTokens {
        tokens: Vec::new(),
        active_count: Arc::new(AtomicUsize::new(0)),
        cancelled: false,
    });
    // 如果 cancel 已经先执行了，新注册的 token 也要立刻设为取消
    if entry.cancelled {
        token.store(true, Ordering::Relaxed);
    }
    entry.active_count.fetch_add(1, Ordering::Relaxed);
    entry.tokens.push(token.clone());
    token
}

fn unregister_cancellation_token(task_id: &str) {
    let mut map = BACKGROUND_TASK_CANCELLATION.lock().unwrap();
    if let Some(entry) = map.get(task_id) {
        // fetch_sub 返回旧值，旧值为 1 说明减 1 后归零，可以清理
        if entry.active_count.fetch_sub(1, Ordering::Relaxed) == 1 {
            map.remove(task_id);
        }
    }
}

#[tauri::command]
pub async fn cancel_background_task(task_id: String) -> Result<bool, String> {
    // 1. 标记 cancelled 并设置所有 token 为取消状态
    {
        let mut map = BACKGROUND_TASK_CANCELLATION.lock().unwrap();
        if let Some(entry) = map.get_mut(&task_id) {
            entry.cancelled = true;
            for token in &entry.tokens {
                token.store(true, Ordering::Relaxed);
            }
        } else {
            return Ok(false);
        }
    }

    // 2. 等待所有 worker 真正结束（最多等 10 秒）
    let start = std::time::Instant::now();
    loop {
        let done = {
            let map = BACKGROUND_TASK_CANCELLATION.lock().unwrap();
            match map.get(&task_id) {
                Some(entry) => entry.active_count.load(Ordering::Relaxed) == 0,
                None => true,
            }
        };
        if done {
            break;
        }
        if start.elapsed() > std::time::Duration::from_secs(10) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    // 3. 清理
    let mut map = BACKGROUND_TASK_CANCELLATION.lock().unwrap();
    map.remove(&task_id);

    Ok(true)
}

#[tauri::command]
pub fn list_agent_sessions(
    app: AppHandle,
    prefix: Option<String>,
    session_kind: Option<String>,
) -> Result<Vec<AgentSessionSummary>, String> {
    let dir = agent_sessions_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut summaries = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(record) = serde_json::from_str::<AgentSessionRecord>(&text) else {
            continue;
        };
        if let Some(ref p) = prefix {
            if !record.id.starts_with(p) {
                continue;
            }
        }
        if let Some(ref sk) = session_kind {
            let record_sk = record.session_kind.as_deref();
            let matches = if sk == "story" {
                record_sk == Some("story") || record_sk.is_none()
            } else {
                record_sk == Some(sk)
            };
            if !matches {
                continue;
            }
        }
        summaries.push(AgentSessionSummary {
            id: record.id,
            title: record.title,
            saved_at: record.saved_at,
            session_kind: record.session_kind,
            character_card_id: record.character_card_id,
            character_card_ids: record.character_card_ids,
            selected_world_book_id: record.selected_world_book_id,
            dynamic_role_loading_enabled: record.dynamic_role_loading_enabled,
        });
    }

    summaries.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
    Ok(summaries)
}
#[tauri::command]
pub fn load_agent_session(app: AppHandle, id: String) -> Result<AgentSessionRecord, String> {
    let path = agent_session_path(&app, &id)?;
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn save_agent_session(
    app: AppHandle,
    mut session: AgentSessionRecord,
) -> Result<AgentSessionSummary, String> {
    let dir = agent_sessions_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    session.saved_at = now_millis()?;
    let path = agent_session_path(&app, &session.id)?;
    let text = serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())?;
    Ok(AgentSessionSummary {
        id: session.id,
        title: session.title,
        saved_at: session.saved_at,
        session_kind: session.session_kind,
        character_card_id: session.character_card_id,
        character_card_ids: session.character_card_ids,
        selected_world_book_id: session.selected_world_book_id,
        dynamic_role_loading_enabled: session.dynamic_role_loading_enabled,
    })
}
#[tauri::command]
pub async fn summarize_text(request: SummarizeRequest) -> Result<String, String> {
    let client = reqwest::Client::new();
    let system_prompt = "请使用用户输入的消息，总结用户意图，不超过15个字。务必注意，是总结用户意图，而不是回应用户的消息";
    let user_prompt = format!("通过以下信息，总结意图，不超过15个字：{}", request.text);
    let max_tokens = request.max_output_tokens.unwrap_or(64).min(128);

    match request.model_interface.as_str() {
        "Anthropic-compatible" => {
            let endpoint = build_anthropic_endpoint(&request.base_url);
            let body = json!({
                "model": request.model,
                "messages": [{"role": "user", "content": user_prompt}],
                "system": system_prompt,
                "stream": false,
                "temperature": request.temperature.unwrap_or(0.3),
                "max_tokens": max_tokens,
            });

            let response = client
                .post(&endpoint)
                .header("x-api-key", &request.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await
                .map_err(|e| {
                    let msg = e.to_string();
                    if msg.contains("error sending request") {
                        format!("{}。提示：请检查设置中的“接口类型”是否与模型提供商匹配（如 Kimi、OpenAI 应选 OpenAI-compatible，Claude 应选 Anthropic-compatible）。", msg)
                    } else {
                        msg
                    }
                })?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("Anthropic 接口请求失败：{} {}", status, body_text));
            }

            let json: Value = response.json().await.map_err(|e| e.to_string())?;
            let content = json
                .get("content")
                .and_then(|c| c.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("type") == Some(&json!("text")))
                })
                .and_then(|text_block| text_block.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .trim()
                .trim_matches(|c| {
                    c == '"' || c == '\'' || c == '「' || c == '」' || c == '『' || c == '』'
                })
                .to_string();

            if content.is_empty() {
                return Err(String::from("生成标题为空"));
            }
            Ok(content)
        }
        _ => {
            let endpoint = build_openai_endpoint(&request.base_url);
            let messages = vec![
                json!({"role": "system", "content": system_prompt}),
                json!({"role": "user", "content": user_prompt}),
            ];
            let body = json!({
                "model": request.model,
                "messages": messages,
                "stream": false,
                "temperature": request.temperature.unwrap_or(0.3),
                "max_tokens": max_tokens,
            });

            let response = client
                .post(&endpoint)
                .bearer_auth(&request.api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| {
                    let msg = e.to_string();
                    if msg.contains("error sending request") {
                        format!("{}。提示：请检查设置中的“接口类型”是否与模型提供商匹配（如 Kimi、OpenAI 应选 OpenAI-compatible，Claude 应选 Anthropic-compatible）。", msg)
                    } else {
                        msg
                    }
                })?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("OpenAI 兼容接口请求失败：{} {}", status, body_text));
            }

            let json: Value = response.json().await.map_err(|e| e.to_string())?;
            let content = json
                .get("choices")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|choice| choice.get("message"))
                .and_then(|msg| msg.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .trim()
                .trim_matches(|c| {
                    c == '"' || c == '\'' || c == '「' || c == '」' || c == '『' || c == '』'
                })
                .to_string();

            if content.is_empty() {
                return Err(String::from("生成标题为空"));
            }
            Ok(content)
        }
    }
}
#[tauri::command]
pub fn update_agent_session_title(
    app: AppHandle,
    id: String,
    title: String,
) -> Result<AgentSessionSummary, String> {
    let path = agent_session_path(&app, &id)?;
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut record: AgentSessionRecord = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    record.title = title;
    record.saved_at = now_millis()?;
    let updated_text = serde_json::to_string_pretty(&record).map_err(|e| e.to_string())?;
    fs::write(path, updated_text).map_err(|e| e.to_string())?;
    Ok(AgentSessionSummary {
        id: record.id,
        title: record.title,
        saved_at: record.saved_at,
        session_kind: record.session_kind,
        character_card_id: record.character_card_id,
        character_card_ids: record.character_card_ids,
        selected_world_book_id: record.selected_world_book_id,
        dynamic_role_loading_enabled: record.dynamic_role_loading_enabled,
    })
}
#[tauri::command]
pub fn delete_agent_session(app: AppHandle, id: String) -> Result<(), String> {
    let path = agent_session_path(&app, &id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
/// Core agent-spawn logic exposed so both the Tauri command and the mobile HTTP
/// server can call it.  The caller must pass a properly-owned (cloned) AppHandle
/// so the Arc reference count is correct – no unsafe transmute_copy required.
pub fn start_chat_stream_inner(
    app: AppHandle,
    mut request: ChatStreamRequest,
) -> Result<String, String> {
    if request.api_key.trim().is_empty() {
        let error = String::from("API Key 不能为空");
        log_agent_run_error(&app, None, &error);
        return Err(error);
    }
    if request.model.trim().is_empty() {
        let error = String::from("模型名称不能为空");
        log_agent_run_error(&app, None, &error);
        return Err(error);
    }
    if request.base_url.trim().is_empty() {
        let error = String::from("接口地址不能为空");
        log_agent_run_error(&app, None, &error);
        return Err(error);
    }
    if request.messages.is_empty() {
        let error = String::from("消息不能为空");
        log_agent_run_error(&app, None, &error);
        return Err(error);
    }

    let reference_context = build_reference_context(&request);
    if !reference_context.is_empty() {
        if let Some(last_msg) = request.messages.last_mut() {
            last_msg.content.push_str(&reference_context);
        }
    }

    let run_id = Uuid::new_v4().to_string();
    let spawned_run_id = run_id.clone();
    // Clone properly so the Arc refcount is incremented for each owner.
    let task_app = app.clone();
    let cleanup_app = app.clone();

    let handle = tauri::async_runtime::spawn(async move {
        emit_chat_event(
            &task_app,
            &spawned_run_id,
            "start",
            None,
            Some("开始生成回复".to_string()),
            &AgentRunOptions::parent(),
        );

        let mut options = AgentRunOptions::parent();
        options.allowed_tools = request.allowed_tools.clone();

        let result = match request.model_interface.as_str() {
            "Anthropic-compatible" => {
                run_anthropic_agent_loop(&task_app, &spawned_run_id, &request, options).await
            }
            _ => run_openai_agent_loop(&task_app, &spawned_run_id, &request, options).await,
        };

        match result {
            Ok(_) => emit_chat_event(
                &task_app,
                &spawned_run_id,
                "done",
                None,
                None,
                &AgentRunOptions::parent(),
            ),
            Err(error) => {
                log_agent_run_error(&task_app, Some(&spawned_run_id), &error);
                emit_chat_event(
                    &task_app,
                    &spawned_run_id,
                    "error",
                    None,
                    Some(error),
                    &AgentRunOptions::parent(),
                )
            }
        }

        if let Some(active_streams) = cleanup_app.try_state::<ActiveStreams>() {
            if let Ok(mut streams) = active_streams.0.lock() {
                streams.remove(&spawned_run_id);
            }
        }
        crate::mobile_server::clean_stream(&spawned_run_id);
    });

    if let Some(active_streams) = app.try_state::<ActiveStreams>() {
        if let Ok(mut streams) = active_streams.0.lock() {
            streams.insert(run_id.clone(), handle);
        }
    }

    Ok(run_id)
}

#[tauri::command]
pub fn start_chat_completion_stream(
    app: AppHandle,
    request: ChatStreamRequest,
    _state: tauri::State<'_, ActiveStreams>,
) -> Result<String, String> {
    // Delegate to the shared inner implementation.
    start_chat_stream_inner(app, request)
}
#[tauri::command]
pub fn stop_chat_stream(
    run_id: String,
    state: tauri::State<'_, ActiveStreams>,
) -> Result<(), String> {
    if let Some(handle) = state.0.lock().unwrap().remove(&run_id) {
        handle.abort();
    }
    crate::mobile_server::clean_stream(&run_id);
    Ok(())
}

fn log_agent_run_error(app: &AppHandle, run_id: Option<&str>, error: &str) {
    let Ok(doc_dir) = resolve_document_dir(app) else {
        return;
    };
    let museai_dir = doc_dir.join("MuseAI");
    let _ = append_agent_run_error_log(&museai_dir, run_id, error, now_millis().unwrap_or(0));
}

fn append_agent_run_error_log(
    museai_dir: &Path,
    run_id: Option<&str>,
    error: &str,
    timestamp: u64,
) -> Result<(), String> {
    let log_dir = museai_dir.join(".logs");
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let log_path = log_dir.join("agent-runs.log");
    let entry = json!({
        "timestamp": timestamp,
        "runId": run_id,
        "event": "error",
        "message": error,
    });
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{}", entry).map_err(|e| e.to_string())
}

fn clean_json_response(text: String) -> String {
    let trimmed = text.trim();

    // Find the first occurrence of '{' or '['
    let start_idx = trimmed.find('{').or_else(|| trimmed.find('['));
    // Find the last occurrence of '}' or ']'
    let end_idx = trimmed.rfind('}').or_else(|| trimmed.rfind(']'));

    if let (Some(start), Some(end)) = (start_idx, end_idx) {
        if start < end {
            return trimmed[start..=end].to_string();
        }
    }

    // Fallback to old trimming logic if braces aren't found or invalid
    let mut cleaned = trimmed.to_string();
    if cleaned.starts_with("```json") {
        cleaned = cleaned
            .strip_prefix("```json")
            .unwrap_or(&cleaned)
            .to_string();
    } else if cleaned.starts_with("```") {
        cleaned = cleaned.strip_prefix("```").unwrap_or(&cleaned).to_string();
    }
    if cleaned.ends_with("```") {
        cleaned = cleaned.strip_suffix("```").unwrap_or(&cleaned).to_string();
    }
    cleaned.trim().to_string()
}

fn format_network_error(e: &reqwest::Error) -> String {
    let msg = e.to_string().to_lowercase();
    if msg.contains("timeout") {
        "请求超时：大模型响应时间过长（超过10分钟）或网络连接不稳定。建议稍后重试，或换用响应更快的模型。".to_string()
    } else if msg.contains("connection") || msg.contains("decode") || msg.contains("body") {
        "网络连接异常：与服务器的连接被中断。请检查网络状况、API 地址是否正确，或稍后重试。"
            .to_string()
    } else {
        format!("网络请求失败：{}", e)
    }
}

fn canonical_json_response(text: String) -> Result<String, String> {
    let cleaned = clean_json_response(text);
    let parsed: Value = serde_json::from_str(&cleaned).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("EOF") {
            "模型返回的 JSON 被截断了（输出超长）。".to_string()
        } else {
            format!("模型没有返回合法 JSON，请重新分析：{}", e)
        }
    })?;
    serde_json::to_string(&parsed).map_err(|e| e.to_string())
}

fn background_json_error_with_raw(raw: &str, error: impl std::fmt::Display) -> String {
    json!({
        "message": format!("模型没有返回合法 JSON，请重新分析：{}", error),
        "rawOutput": raw.trim()
    })
    .to_string()
}

fn escape_likely_inner_quotes_and_control_chars(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut repaired = String::new();
    let mut in_string = false;
    let mut escaped = false;
    let mut index = 0;

    while index < chars.len() {
        let current = chars[index];
        if in_string {
            if escaped {
                repaired.push(current);
                escaped = false;
            } else if current == '\\' {
                repaired.push(current);
                escaped = true;
            } else if current == '"' {
                let next_significant = chars[index + 1..]
                    .iter()
                    .copied()
                    .find(|next| !next.is_whitespace());
                if matches!(
                    next_significant,
                    Some(':') | Some(',') | Some('}') | Some(']') | None
                ) {
                    repaired.push(current);
                    in_string = false;
                } else {
                    repaired.push_str("\\\"");
                }
            } else if current == '\n' {
                repaired.push_str("\\n");
            } else if current == '\r' {
                repaired.push_str("\\r");
            } else if current == '\t' {
                repaired.push_str("\\t");
            } else {
                repaired.push(current);
            }
        } else {
            repaired.push(current);
            if current == '"' {
                in_string = true;
            }
        }
        index += 1;
    }

    repaired
}

fn remove_trailing_json_commas(text: &str) -> String {
    let mut repaired = String::new();
    let mut chars = text.chars().peekable();
    while let Some(current) = chars.next() {
        if current == ',' {
            let mut lookahead = chars.clone();
            if matches!(
                lookahead.find(|next| !next.is_whitespace()),
                Some('}') | Some(']')
            ) {
                continue;
            }
        }
        repaired.push(current);
    }
    repaired
}

fn close_unclosed_json_containers(text: &str) -> String {
    let mut repaired = text.to_string();
    let mut stack = Vec::new();
    let mut in_string = false;
    let mut escaped = false;

    for current in text.chars() {
        if in_string {
            if escaped {
                escaped = false;
            } else if current == '\\' {
                escaped = true;
            } else if current == '"' {
                in_string = false;
            }
            continue;
        }

        match current {
            '"' => in_string = true,
            '{' => stack.push('}'),
            '[' => stack.push(']'),
            '}' | ']' => {
                if stack.last() == Some(&current) {
                    stack.pop();
                }
            }
            _ => {}
        }
    }

    while let Some(closer) = stack.pop() {
        repaired.push(closer);
    }
    repaired
}

fn repair_background_json_like_response(text: &str) -> Option<String> {
    let cleaned = clean_json_response(text.to_string());
    let repaired = close_unclosed_json_containers(&remove_trailing_json_commas(
        &escape_likely_inner_quotes_and_control_chars(&cleaned),
    ));
    let parsed: Value = serde_json::from_str(&repaired).ok()?;
    serde_json::to_string(&parsed).ok()
}

fn canonical_background_json_response(text: String) -> Result<String, String> {
    match canonical_json_response(text.clone()) {
        Ok(canonical) => Ok(canonical),
        Err(strict_error) => repair_background_json_like_response(&text).ok_or_else(|| {
            background_json_error_with_raw(
                &text,
                strict_error.trim_start_matches("模型没有返回合法 JSON，请重新分析："),
            )
        }),
    }
}

fn build_analyze_memory_user_prompt(request: &AnalyzeMemoryRequest) -> String {
    let target_name = request
        .target_character_name
        .as_deref()
        .unwrap_or("当前角色");
    let target_content = request
        .target_character_content
        .as_deref()
        .unwrap_or("未提供");

    format!(
        "根据以下对话记录，分析并生成新的与用户关系设定、关键事件和建议的会话标题。\n\n\
        ### 0. 本次只允许更新的目标角色\n\
        - **目标角色**：{}\n\
        - **目标角色卡内容**：\n{}\n\n\
        重要约束：你只分析并输出“目标角色”与用户之间的关系、相处模式、关系底线与关键事件。\
        对话中出现的其他角色、旁白、NPC 或群体事件只能作为背景上下文，严禁把其他角色与用户的关系、情绪、承诺、亲密度或关键事件写入目标角色记忆。\n\n\
        字数约束：\"userRelationType\" 不要超过50字；\"userInteractionModel\" 和 \"userRelationBottomLine\" 各不要超过100字。\
        \"keyEvents\" 必须保留原有关键事件内容，只能在原本基础上最多增加100字；新增部分前面必须空一行，新增内容格式必须为“【事件名】事件详情”。\n\n\
        ### 1. 本次聊天历史记录\n{}\n\n\
        ### 2. 目标角色目前的与用户关系设定\n\
        - **与用户关系类型**：{}\n\
        - **与用户相处模式**：{}\n\
        - **与用户关系底线**：{}\n\n\
        ### 3. 目标角色目前的关键事件记录\n{}\n\n\
        请结合上述对话，分析：\n\
        1. 关系设定修改点：经过本次对话后，目标角色与用户之间的“与用户关系类型”、“与用户相处模式”以及“与用户关系底线”应当怎样改变、加深或确立？如果相处模式或关系底线有更新，请进行相应的调整和完善。\n\
        2. 关键事件修改点：本次对话是否发生了影响目标角色与用户关系的里程碑或纪念性共同经历？如果有，只追加目标角色亲历或明确参与的事件，追加内容最多100字，且必须在原有关键事件后先空一行，再写“【事件名】事件详情”；如果没有，保持原样。\n\
        3. 会话标题：为本次会话起一个不超过15字、体现对话主题的合适标题。\n\n\
        请以纯 JSON 格式输出，不要包含 markdown 格式标记（如 ```json）或额外的解释字眼。JSON 结构必须严格满足以下字段：\n\
        {{\n  \
          \"userRelationType\": \"更新后的完整与用户关系类型内容，不超过50字\",\n  \
          \"userInteractionModel\": \"更新后的完整与用户相处模式内容，不超过100字\",\n  \
          \"userRelationBottomLine\": \"更新后的完整与用户关系底线内容，不超过100字\",\n  \
          \"keyEvents\": \"保留原有关键事件内容；如需新增，先空一行，再追加不超过100字的【事件名】事件详情\",\n  \
          \"sessionTitle\": \"本次会话的建议标题（不超过15个字）\",\n  \
          \"relationChanges\": \"关于目标角色与用户关系设定（类型、模式或底线）的改变/修改点说明，如果没变请写'无修改'\",\n  \
          \"eventChanges\": \"关于目标角色关键事件的改变/修改点说明，如果没变请写'无修改'\"\n\
        }}",
        target_name,
        target_content,
        request.chat_history,
        request.current_user_relation_type,
        request.current_user_interaction_model,
        request.current_user_relation_bottom_line,
        request.current_events
    )
}

#[tauri::command]
pub async fn analyze_character_memory(request: AnalyzeMemoryRequest) -> Result<String, String> {
    let client = reqwest::Client::new();
    let system_prompt = request.system_prompt.as_deref().unwrap_or(
        "你是一个专门负责伴侣角色记忆管理的AI。你需要基于本次对话记录，以及原有的与用户关系设定（包括关系类型、相处模式、关系底线）和关键事件，来分析两者的改变，并输出本次会话的建议标题。请务必严格按照JSON格式返回。"
    );
    let user_prompt = build_analyze_memory_user_prompt(&request);

    let max_tokens = request.max_output_tokens.unwrap_or(4096);

    let raw_content = match request.model_interface.as_str() {
        "Anthropic-compatible" => {
            let endpoint = build_anthropic_endpoint(&request.base_url);
            let mut body = json!({
                "model": request.model,
                "messages": [{"role": "user", "content": user_prompt}],
                "system": system_prompt,
                "stream": false,
                "max_tokens": max_tokens,
            });
            if let Some(thinking) =
                anthropic_thinking_config(request.thinking_depth.as_deref(), max_tokens)
            {
                body["thinking"] = thinking;
            } else {
                body["temperature"] = json!(request.temperature.unwrap_or(0.7));
            }

            let response = client
                .post(&endpoint)
                .header("x-api-key", &request.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("Anthropic 接口请求失败：{} {}", status, body_text));
            }

            let json: Value = response.json().await.map_err(|e| e.to_string())?;
            json.get("content")
                .and_then(|c| c.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("type") == Some(&json!("text")))
                })
                .and_then(|text_block| text_block.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .trim()
                .to_string()
        }
        _ => {
            let endpoint = build_openai_endpoint(&request.base_url);
            let messages = vec![
                json!({"role": "system", "content": system_prompt}),
                json!({"role": "user", "content": user_prompt}),
            ];
            let body = json!({
                "model": request.model,
                "messages": messages,
                "stream": false,
                "temperature": request.temperature.unwrap_or(0.7),
                "max_tokens": max_tokens,
            });

            let response = client
                .post(&endpoint)
                .bearer_auth(&request.api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("OpenAI 兼容接口请求失败：{} {}", status, body_text));
            }

            let json: Value = response.json().await.map_err(|e| e.to_string())?;
            json.get("choices")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|choice| choice.get("message"))
                .and_then(|msg| msg.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .trim()
                .to_string()
        }
    };

    canonical_json_response(raw_content)
}

fn validate_background_text(text: &str) -> Result<(), String> {
    if text.chars().count() > 100_000 {
        return Err("选中文件总字数超过10万字，内容过长可能导致提取失败。建议先在大纲页使用“AI反向分析大纲”功能，再基于精简后的大纲提取设定。".to_string());
    }
    Ok(())
}

fn background_world_book_schema() -> &'static str {
    r#"{
  "worldBooks": [
    {
      "name": "世界设定集名称",
      "fields": {
        "theme": "核心主题",
        "era": "时代背景",
        "techLevel": "科技水平",
        "magicLevel": "魔法水平",
        "geography": "地理格局",
        "keyScenes": "关键场景",
        "culturalFeatures": "文化特色",
        "history": "历史事件",
        "conflict": "核心矛盾"
      }
    }
  ]
}"#
}

fn background_character_card_schema(character_name: &str) -> String {
    format!(
        r#"{{
  "name": "{}",
  "fields": {{
    "age": "年龄",
    "gender": "性别",
    "race": "种族",
    "birthplace": "出生地",
    "occupation": "职业",
    "socialClass": "社会阶层",
    "identityTags": ["身份标签1", "身份标签2"],
    "heightBuild": "身高体型",
    "iconicFeatures": "标志性特征",
    "clothingStyle": "衣着风格",
    "overallVibe": "整体气质",
    "externalPersonality": "外在性格表现",
    "internalPersonality": "真实内在性格本质",
    "coreDesire": "核心欲望与最强驱动力",
    "fearWeakness": "恐惧与弱点软肋",
    "moralValues": "是非对错的道德观念底线",
    "quirk": "怪癖习惯动作",
    "skills": "技能与魔法专长描述",
    "backgroundStory": "角色的身世背景与成长过往经历",
    "relationships": "人际关系网络",
    "speakingStyle": "说话方式与语气口头禅描述",
    "typicalReactions": "典型反应",
    "userRelationType": "与用户关系类型",
    "userInteractionModel": "与用户相处模式详细说明",
    "userRelationBottomLine": "与用户关系相处的底线",
    "keyEvents": "与用户经历的关键事件里程碑"
  }}
}}"#,
        character_name
    )
}

fn limit_background_context_text(text: &str, max_context_tokens: Option<u32>) -> String {
    let Some(max_context_tokens) = max_context_tokens else {
        return text.to_string();
    };
    if max_context_tokens == 0 || approximate_token_count(text) <= max_context_tokens as usize {
        return text.to_string();
    }
    let max_chars = (max_context_tokens as usize).saturating_mul(4).max(1);
    text.chars().take(max_chars).collect()
}

fn build_background_stage_one_prompts(
    text: &str,
    include_character_names: bool,
    system_prompt_override: Option<&str>,
    max_output_tokens: Option<u32>,
    max_context_tokens: Option<u32>,
) -> (String, String, u32) {
    let system_prompt = system_prompt_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("你是一个世界观与人物设定专家。你需要根据用户提供的参考文本，提取结构化世界书；如果任务要求，还要提取适合继续生成角色卡的角色姓名列表。请务必返回严格的纯JSON格式数据，不要包含 Markdown 标记或额外说明。")
        .to_string();
    let character_name_instruction = if include_character_names {
        "\n同时提取需要生成角色卡的角色姓名列表，字段名为 characterNames。角色名只保留姓名或常用称呼，不要附带解释。"
    } else {
        "\n本次仅提取世界书，不要输出 characterNames，也不要输出角色卡。"
    };
    let schema = if include_character_names {
        format!(
            r#"{{
  "worldBooks": {},
  "characterNames": ["角色姓名1", "角色姓名2"]
}}"#,
            background_world_book_schema()
                .trim()
                .trim_start_matches('{')
                .trim_end_matches('}')
                .trim()
        )
    } else {
        background_world_book_schema().to_string()
    };
    let limited_text = limit_background_context_text(text, max_context_tokens);
    let user_prompt = format!(
        "根据以下参考内容，提炼一本结构化世界书。{}\
         \nJSON 必须严格满足以下结构定义：\n{}\n\n\
         重要约束：\n\
         1. 仅返回纯 JSON，不要包含 ```json、前言或后记。\n\n\
         以下是参考内容：\n\
         ===========================\n\
         {}\n\
         ===========================",
        character_name_instruction, schema, limited_text
    );
    (
        system_prompt,
        user_prompt,
        max_output_tokens.unwrap_or(8192),
    )
}

fn build_background_character_card_prompts(
    text: &str,
    character_name: &str,
    world_book_context: Option<&str>,
    system_prompt_override: Option<&str>,
    max_output_tokens: Option<u32>,
    max_context_tokens: Option<u32>,
) -> (String, String, u32) {
    let system_prompt = system_prompt_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("你是一个人物设定专家。你需要根据参考文本为指定角色生成一张结构化角色卡。请务必返回严格的纯JSON格式数据，不要包含 Markdown 标记或额外说明。")
        .to_string();
    let context = world_book_context
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("\n\n已确认的世界书上下文：\n{}\n", value.trim()))
        .unwrap_or_default();
    let limited_text = limit_background_context_text(text, max_context_tokens);
    let user_prompt = format!(
        "请只为角色“{}”生成一张角色卡，不要生成其他角色。{}\n\
         JSON 必须严格满足以下结构定义：\n{}\n\n\
         重要约束：\n\
         1. 如果参考文本没有直接给出字段，请根据上下文谨慎概括，不要编造明显冲突的信息。\n\
         2. 仅返回纯 JSON，不要包含 ```json、前言或后记。\n\n\
         以下是参考内容：\n\
         ===========================\n\
         {}\n\
         ===========================",
        character_name,
        context,
        background_character_card_schema(character_name),
        limited_text
    );
    (
        system_prompt,
        user_prompt,
        max_output_tokens.unwrap_or(8192),
    )
}

fn value_to_background_item(
    value: &Value,
    fallback_name: &str,
) -> Result<GeneratedBackgroundItem, String> {
    let name = value
        .get("name")
        .and_then(|name| name.as_str())
        .unwrap_or(fallback_name)
        .trim()
        .to_string();
    if name.is_empty() {
        return Err("模型返回的背景设定缺少名称".to_string());
    }
    let fields = value
        .get("fields")
        .cloned()
        .filter(|fields| fields.is_object())
        .unwrap_or_else(|| json!({}));
    Ok(GeneratedBackgroundItem { name, fields })
}

fn parse_background_stage_one_response(
    text: String,
    include_character_names: bool,
) -> Result<BackgroundStageOneResponse, String> {
    let canonical = canonical_background_json_response(text)?;
    let parsed: Value = serde_json::from_str(&canonical).map_err(|e| e.to_string())?;
    let world_books_value = parsed
        .get("worldBooks")
        .and_then(|world_books| world_books.as_array())
        .ok_or_else(|| "模型返回的世界书数据格式不正确".to_string())?;
    if world_books_value.is_empty() {
        return Err("模型没有返回可保存的世界书".to_string());
    }
    let world_books = world_books_value
        .iter()
        .map(|item| value_to_background_item(item, "未命名世界书"))
        .collect::<Result<Vec<_>, _>>()?;

    let mut character_names = Vec::new();
    if include_character_names {
        let mut seen = std::collections::HashSet::new();
        if let Some(names) = parsed
            .get("characterNames")
            .and_then(|names| names.as_array())
        {
            for name in names {
                let Some(name) = name.as_str().map(str::trim).filter(|name| !name.is_empty())
                else {
                    continue;
                };
                if seen.insert(name.to_string()) {
                    character_names.push(name.to_string());
                }
            }
        }
    }

    Ok(BackgroundStageOneResponse {
        world_books,
        character_names,
    })
}

fn parse_background_character_card_response(
    text: String,
    expected_name: &str,
) -> Result<GeneratedBackgroundItem, String> {
    let raw_text = text.clone();
    let canonical = canonical_background_json_response(text)?;
    let parsed: Value = serde_json::from_str(&canonical).map_err(|e| e.to_string())?;
    let card_value = parsed.get("characterCard").unwrap_or(&parsed);
    if card_value
        .get("name")
        .and_then(|name| name.as_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .is_none()
    {
        return Err(background_json_error_with_raw(
            &raw_text,
            format!("模型没有返回“{}”的有效角色卡名称", expected_name),
        ));
    }
    let item = value_to_background_item(card_value, "")?;
    if item.name.trim().is_empty() {
        return Err(background_json_error_with_raw(
            &raw_text,
            format!("模型没有返回“{}”的有效角色卡名称", expected_name),
        ));
    }
    if !item.fields.is_object() {
        return Err(background_json_error_with_raw(
            &raw_text,
            format!("模型没有返回“{}”的有效角色卡字段", expected_name),
        ));
    }
    Ok(item)
}

async fn with_cancellation<T, F, E>(cancel_token: &AtomicBool, future: F) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let cancel_check = async {
        loop {
            if cancel_token.load(Ordering::Relaxed) {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    };

    tokio::select! {
        result = future => result.map_err(|e| e.to_string()),
        _ = cancel_check => Err("任务已取消".to_string()),
    }
}

async fn call_background_llm(
    client: &reqwest::Client,
    model_interface: &str,
    base_url: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
    temperature: f32,
    thinking_depth: Option<&str>,
    cancel_token: &AtomicBool,
) -> Result<String, String> {
    match model_interface {
        "Anthropic-compatible" => {
            let endpoint = build_anthropic_endpoint(base_url);
            let mut body = json!({
                "model": model,
                "messages": [{"role": "user", "content": user_prompt}],
                "system": system_prompt,
                "stream": false,
                "max_tokens": max_tokens,
            });
            if let Some(thinking) = anthropic_thinking_config(thinking_depth, max_tokens) {
                body["thinking"] = thinking;
            } else {
                body["temperature"] = json!(temperature);
            }

            let request = client
                .post(&endpoint)
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .build()
                .map_err(|e| e.to_string())?;

            let response = with_cancellation(cancel_token, client.execute(request)).await?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = with_cancellation(cancel_token, response.text()).await?;
                return Err(format!("Anthropic 接口请求失败：{} {}", status, body_text));
            }

            let json: Value = with_cancellation(cancel_token, response.json()).await?;
            let provider_response =
                serde_json::to_string_pretty(&json).unwrap_or_else(|_| json.to_string());
            let content = json
                .get("content")
                .and_then(|c| c.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("type") == Some(&json!("text")))
                })
                .and_then(|text_block| text_block.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if content.is_empty() {
                Ok(provider_response)
            } else {
                Ok(content)
            }
        }
        _ => {
            let endpoint = build_openai_endpoint(base_url);
            let body = build_openai_background_body(
                model,
                system_prompt,
                user_prompt,
                max_tokens,
                temperature,
                thinking_depth,
            );

            let request = client
                .post(&endpoint)
                .bearer_auth(api_key)
                .json(&body)
                .build()
                .map_err(|e| e.to_string())?;

            let response = with_cancellation(cancel_token, client.execute(request)).await?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = with_cancellation(cancel_token, response.text()).await?;
                return Err(format!("OpenAI 兼容接口请求失败：{} {}", status, body_text));
            }

            let json: Value = with_cancellation(cancel_token, response.json()).await?;
            let provider_response =
                serde_json::to_string_pretty(&json).unwrap_or_else(|_| json.to_string());
            let content = json
                .get("choices")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|choice| choice.get("message"))
                .and_then(|msg| msg.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if content.is_empty() {
                Ok(provider_response)
            } else {
                Ok(content)
            }
        }
    }
}

fn build_openai_background_body(
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
    temperature: f32,
    thinking_depth: Option<&str>,
) -> Value {
    let mut body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "stream": false,
        "temperature": temperature,
        "max_tokens": max_tokens,
    });
    let depth = thinking_depth.unwrap_or("").trim();
    if depth.is_empty() || depth == "off" {
        body["enable_thinking"] = json!(false);
    } else {
        body["enable_thinking"] = json!(true);
        body["reasoning_effort"] = json!(depth);
    }
    body
}

#[tauri::command]
pub async fn generate_background_stage_one(
    request: GenerateBackgroundStageOneRequest,
) -> Result<BackgroundStageOneResponse, String> {
    validate_background_text(&request.text)?;
    let cancel_token = register_cancellation_token(request.task_id.clone());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .connect_timeout(std::time::Duration::from_secs(30))
        .http1_only()
        .build()
        .map_err(|e| e.to_string())?;
    let (system_prompt, user_prompt, max_tokens) = build_background_stage_one_prompts(
        &request.text,
        request.include_character_names,
        request.system_prompt.as_deref(),
        request.max_output_tokens,
        request.max_context_tokens,
    );

    let raw_content = call_background_llm(
        &client,
        &request.model_interface,
        &request.base_url,
        &request.api_key,
        &request.model,
        &system_prompt,
        &user_prompt,
        max_tokens,
        request.temperature.unwrap_or(0.0),
        request.thinking_depth.as_deref(),
        &cancel_token,
    )
    .await;

    // 如果是取消，等待 reqwest 底层连接清理
    if let Err(ref e) = raw_content {
        if e == "任务已取消" {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }

    unregister_cancellation_token(&request.task_id);
    let raw_content = raw_content?;
    parse_background_stage_one_response(raw_content, request.include_character_names)
}

#[tauri::command]
pub async fn generate_background_character_card(
    request: GenerateBackgroundCharacterCardRequest,
) -> Result<GeneratedBackgroundItem, String> {
    validate_background_text(&request.text)?;
    let character_name = request.character_name.trim();
    if character_name.is_empty() {
        return Err("角色名不能为空".to_string());
    }
    let cancel_token = register_cancellation_token(request.task_id.clone());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .connect_timeout(std::time::Duration::from_secs(30))
        .http1_only()
        .build()
        .map_err(|e| e.to_string())?;
    let (system_prompt, user_prompt, max_tokens) = build_background_character_card_prompts(
        &request.text,
        character_name,
        request.world_book_context.as_deref(),
        request.system_prompt.as_deref(),
        request.max_output_tokens,
        request.max_context_tokens,
    );

    let raw_content = call_background_llm(
        &client,
        &request.model_interface,
        &request.base_url,
        &request.api_key,
        &request.model,
        &system_prompt,
        &user_prompt,
        max_tokens,
        request.temperature.unwrap_or(0.0),
        request.thinking_depth.as_deref(),
        &cancel_token,
    )
    .await;

    // 如果是取消，等待 reqwest 底层连接清理
    if let Err(ref e) = raw_content {
        if e == "任务已取消" {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }

    unregister_cancellation_token(&request.task_id);
    let raw_content = raw_content?;
    parse_background_character_card_response(raw_content, character_name)
}

#[tauri::command]
pub async fn generate_background_items(
    request: GenerateBackgroundItemsRequest,
) -> Result<String, String> {
    validate_background_text(&request.text)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .connect_timeout(std::time::Duration::from_secs(30))
        .http1_only()
        .build()
        .map_err(|e| e.to_string())?;
    let system_prompt = "你是一个世界观与人物设定专家。你需要根据用户提供的参考文本（作品、大纲、范文内容），总结并提取出这个世界的“世界书”（包含核心主题、地理格局、关键场景、文化特色、历史事件、核心矛盾等基本时代设定）以及涉及的“角色卡”（包括基本信息、外貌气质、性格特征、技能专长、背景故事、人际关系、说话方式和典型反应等）。请务必返回严格的纯JSON格式数据，不要包含 Markdown 标记或任何额外的说明性文本。";
    let user_prompt = format!(
        "根据以下参考内容，分析并提取出这个世界的“世界书”和一个或多个“角色卡”设定。\n\
         如果参考文本包含很多细节，请提炼精简，使其逻辑自洽并符合以下指定的 JSON 格式。\n\
         JSON 必须严格满足以下结构定义：\n\
         {{\n  \
           \"worldBooks\": [\n    \
             {{\n      \
               \"name\": \"世界设定集名称（例如：奥兰魔法大陆设定集）\",\n      \
               \"fields\": {{\n        \
                 \"theme\": \"核心主题（例如：魔法冒险 / 奇幻史诗）\",\n        \
                 \"era\": \"时代背景（例如：中世纪末期 / 魔法工业革命）\",\n        \
                 \"techLevel\": \"科技水平（例如：蒸汽机与简单电气）\",\n        \
                 \"magicLevel\": \"魔法水平（例如：高魔世界 / 以太广泛应用）\",\n        \
                 \"geography\": \"地理格局详细描述，包含主要国家、大陆分布及气候\",\n        \
                 \"keyScenes\": \"关键场景，列出故事的核心场景地标列表，如“魔法学院图书馆”\",\n        \
                 \"culturalFeatures\": \"文化特色，主要描述社会风俗、宗教信仰以及对魔法的社会观念\",\n        \
                 \"history\": \"历史事件，列出本世界深远影响的历史大战或转折点\",\n        \
                 \"conflict\": \"核心矛盾，描述当前世界最激烈的势力矛盾或信仰对立\"\n      \
               }}\n    \
             }}\n  \
           ],\n  \
           \"characterCards\": [\n    \
             {{\n      \
               \"name\": \"角色姓名\",\n      \
               \"fields\": {{\n        \
                 \"age\": \"年龄（例如：18岁）\",\n        \
                 \"gender\": \"性别（例如：男）\",\n        \
                 \"race\": \"种族（例如：人类 / 精灵）\",\n        \
                 \"birthplace\": \"出生地\",\n        \
                 \"occupation\": \"职业\",\n        \
                 \"socialClass\": \"社会阶层（例如：平民出身、贵族子弟）\",\n        \
                 \"identityTags\": [\"身份标签1\", \"身份标签2\"],\n        \
                 \"heightBuild\": \"身高体型\",\n        \
                 \"iconicFeatures\": \"标志性特征（如：手背上有蓝色烙印）\",\n        \
                 \"clothingStyle\": \"衣着风格\",\n        \
                 \"overallVibe\": \"整体气质\",\n        \
                 \"externalPersonality\": \"外在性格表现\",\n        \
                 \"internalPersonality\": \"真实内在性格本质\",\n        \
                 \"coreDesire\": \"核心欲望与最强驱动力\",\n        \
                 \"fearWeakness\": \"恐惧与弱点软肋\",\n        \
                 \"moralValues\": \"是非对错的道德观念底线\",\n        \
                 \"quirk\": \"怪癖习惯动作\",\n        \
                 \"skills\": \"技能与魔法专长描述\",\n        \
                 \"backgroundStory\": \"角色的身世背景与成长过往经历\",\n        \
                 \"relationships\": \"人际关系网络，说明与主角或核心角色的关联\",\n        \
                 \"speakingStyle\": \"说话方式与语气口头禅描述\",\n        \
                 \"typicalReactions\": \"典型反应（如遇到突发危机的反应等）\",\n        \
                 \"userRelationType\": \"与用户关系类型（例如：欢喜冤家、生死之交等）\",\n        \
                 \"userInteractionModel\": \"与用户相处模式详细说明\",\n        \
                 \"userRelationBottomLine\": \"与用户关系相处的底线\",\n        \
                 \"keyEvents\": \"与用户经历的关键事件里程碑\"\n      \
               }}\n    \
             }}\n  \
           ]\n\
         }}\n\n\
         重要约束：\n\
         1. 如果参考文本中角色数量很多，请优先保证 JSON 结构完整。你可以适当精简次要角色的描述字段，或将部分次要角色合并概括，但绝不要截断 JSON 导致结构不完整。\n\
         2. 如果用户明确要求提取所有角色，但你判断全部输出会导致 JSON 截断，请先输出最核心的 10–15 个角色，并确保 JSON 完整闭合。\n\
         3. 所有字符串字段如果内容过多，请提炼到每段 50–100 字以内，不要大段复制原文。\n\n\
         以下是参考内容：\n\
         ===========================\n\
         {}\n\
         ===========================\n\
         请注意：仅返回符合上述 JSON 结构的纯数据，千万不要包含 ```json 这种 Markdown 标记，也不要有任何前言或后记解释。",
        request.text
    );

    let max_tokens = 32000;

    let raw_content = match request.model_interface.as_str() {
        "Anthropic-compatible" => {
            let endpoint = build_anthropic_endpoint(&request.base_url);
            let body = json!({
                "model": request.model,
                "messages": [{"role": "user", "content": user_prompt}],
                "system": system_prompt,
                "stream": false,
                "max_tokens": max_tokens,
                "temperature": 0.3,
            });

            let response = client
                .post(&endpoint)
                .header("x-api-key", &request.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("Anthropic 接口请求失败：{} {}", status, body_text));
            }

            let json: Value = response.json().await.map_err(|e| e.to_string())?;
            json.get("content")
                .and_then(|c| c.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("type") == Some(&json!("text")))
                })
                .and_then(|text_block| text_block.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .trim()
                .to_string()
        }
        _ => {
            let endpoint = build_openai_endpoint(&request.base_url);
            let messages = vec![
                json!({"role": "system", "content": system_prompt}),
                json!({"role": "user", "content": user_prompt}),
            ];
            let body = json!({
                "model": request.model,
                "messages": messages,
                "stream": false,
                "temperature": 0.3,
                "max_tokens": max_tokens,
            });

            let response = client
                .post(&endpoint)
                .bearer_auth(&request.api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("OpenAI 兼容接口请求失败：{} {}", status, body_text));
            }

            let json: Value = response.json().await.map_err(|e| e.to_string())?;
            json.get("choices")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|choice| choice.get("message"))
                .and_then(|msg| msg.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .trim()
                .to_string()
        }
    };

    canonical_json_response(raw_content)
}

#[tauri::command]
pub fn start_generate_background_items_stream(
    app: AppHandle,
    request: GenerateBackgroundItemsRequest,
    _state: tauri::State<'_, ActiveStreams>,
) -> Result<BackgroundExtractionStarted, String> {
    validate_background_text(&request.text)?;
    if request.api_key.trim().is_empty() {
        return Err("API Key 不能为空".to_string());
    }
    if request.model.trim().is_empty() {
        return Err("模型名称不能为空".to_string());
    }
    if request.base_url.trim().is_empty() {
        return Err("接口地址不能为空".to_string());
    }

    let run_id = Uuid::new_v4().to_string();
    let spawned_run_id = run_id.clone();
    let task_app = app.clone();
    let cleanup_app = app.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let result = run_background_items_stream_task(&task_app, &spawned_run_id, request).await;
        match result {
            Ok(content) => {
                let _ = task_app.emit(
                    "background-extraction-stream",
                    BackgroundExtractionEvent {
                        run_id: spawned_run_id.clone(),
                        event_type: "done".to_string(),
                        delta: None,
                        message: Some(content),
                    },
                );
            }
            Err(error) => {
                let _ = task_app.emit(
                    "background-extraction-stream",
                    BackgroundExtractionEvent {
                        run_id: spawned_run_id.clone(),
                        event_type: "error".to_string(),
                        delta: None,
                        message: Some(error),
                    },
                );
            }
        }
        if let Some(active_streams) = cleanup_app.try_state::<ActiveStreams>() {
            if let Ok(mut streams) = active_streams.0.lock() {
                streams.remove(&spawned_run_id);
            }
        }
    });

    if let Some(active_streams) = app.try_state::<ActiveStreams>() {
        if let Ok(mut streams) = active_streams.0.lock() {
            streams.insert(run_id.clone(), handle);
        }
    }

    Ok(BackgroundExtractionStarted { run_id })
}

async fn run_background_items_stream_task(
    app: &AppHandle,
    run_id: &str,
    request: GenerateBackgroundItemsRequest,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let system_prompt = "你是一个世界观与人物设定专家。你需要根据用户提供的参考文本（作品、大纲、范文内容），总结并提取出这个世界的“世界书”（包含核心主题、地理格局、关键场景、文化特色、历史事件、核心矛盾等基本时代设定）以及涉及的“角色卡”（包括基本信息、外貌气质、性格特征、技能专长、背景故事、人际关系、说话方式和典型反应等）。请务必返回严格的纯JSON格式数据，不要包含 Markdown 标记或任何额外的说明性文本。";
    let user_prompt = format!(
        "根据以下参考内容，分析并提取出这个世界的“世界书”和一个或多个“角色卡”设定。\n\
         如果参考文本包含很多细节，请提炼精简，使其逻辑自洽并符合以下指定的 JSON 格式。\n\
         JSON 必须严格满足以下结构定义：\n\
         {{\n  \
           \"worldBooks\": [\n    \
             {{\n      \
               \"name\": \"世界设定集名称（例如：奥兰魔法大陆设定集）\",\n      \
               \"fields\": {{\n        \
                 \"theme\": \"核心主题（例如：魔法冒险 / 奇幻史诗）\",\n        \
                 \"era\": \"时代背景（例如：中世纪末期 / 魔法工业革命）\",\n        \
                 \"techLevel\": \"科技水平（例如：蒸汽机与简单电气）\",\n        \
                 \"magicLevel\": \"魔法水平（例如：高魔世界 / 以太广泛应用）\",\n        \
                 \"geography\": \"地理格局详细描述，包含主要国家、大陆分布及气候\",\n        \
                 \"keyScenes\": \"关键场景，列出故事的核心场景地标列表，如“魔法学院图书馆”\",\n        \
                 \"culturalFeatures\": \"文化特色，主要描述社会风俗、宗教信仰以及对魔法的社会观念\",\n        \
                 \"history\": \"历史事件，列出本世界深远影响的历史大战或转折点\",\n        \
                 \"conflict\": \"核心矛盾，描述当前世界最激烈的势力矛盾或信仰对立\"\n      \
               }}\n    \
             }}\n  \
           ],\n  \
           \"characterCards\": [\n    \
             {{\n      \
               \"name\": \"角色姓名\",\n      \
               \"fields\": {{\n        \
                 \"age\": \"年龄（例如：18岁）\",\n        \
                 \"gender\": \"性别（例如：男）\",\n        \
                 \"race\": \"种族（例如：人类 / 精灵）\",\n        \
                 \"birthplace\": \"出生地\",\n        \
                 \"occupation\": \"职业\",\n        \
                 \"socialClass\": \"社会阶层（例如：平民出身、贵族子弟）\",\n        \
                 \"identityTags\": [\"身份标签1\", \"身份标签2\"],\n        \
                 \"heightBuild\": \"身高体型\",\n        \
                 \"iconicFeatures\": \"标志性特征（如：手背上有蓝色烙印）\",\n        \
                 \"clothingStyle\": \"衣着风格\",\n        \
                 \"overallVibe\": \"整体气质\",\n        \
                 \"externalPersonality\": \"外在性格表现\",\n        \
                 \"internalPersonality\": \"真实内在性格本质\",\n        \
                 \"coreDesire\": \"核心欲望与最强驱动力\",\n        \
                 \"fearWeakness\": \"恐惧与弱点软肋\",\n        \
                 \"moralValues\": \"是非对错的道德观念底线\",\n        \
                 \"quirk\": \"怪癖习惯动作\",\n        \
                 \"skills\": \"技能与魔法专长描述\",\n        \
                 \"backgroundStory\": \"角色的身世背景与成长过往经历\",\n        \
                 \"relationships\": \"人际关系网络，说明与主角或核心角色的关联\",\n        \
                 \"speakingStyle\": \"说话方式与语气口头禅描述\",\n        \
                 \"typicalReactions\": \"典型反应（如遇到突发危机的反应等）\",\n        \
                 \"userRelationType\": \"与用户关系类型（例如：欢喜冤家、生死之交等）\",\n        \
                 \"userInteractionModel\": \"与用户相处模式详细说明\",\n        \
                 \"userRelationBottomLine\": \"与用户关系相处的底线\",\n        \
                 \"keyEvents\": \"与用户经历的关键事件里程碑\"\n      \
               }}\n    \
             }}\n  \
           ]\n\
         }}\n\n\
         重要约束：\n\
         1. 如果参考文本中角色数量很多，请优先保证 JSON 结构完整。你可以适当精简次要角色的描述字段，或将部分次要角色合并概括，但绝不要截断 JSON 导致结构不完整。\n\
         2. 如果用户明确要求提取所有角色，但你判断全部输出会导致 JSON 截断，请先输出最核心的 10–15 个角色，并确保 JSON 完整闭合。\n\
         3. 所有字符串字段如果内容过多，请提炼到每段 50–100 字以内，不要大段复制原文。\n\n\
         以下是参考内容：\n\
         ===========================\n\
         {}\n\
         ===========================\n\
         请注意：仅返回符合上述 JSON 结构的纯数据，千万不要包含 ```json 这种 Markdown 标记，也不要有任何前言或后记解释。",
        request.text
    );

    let max_tokens = 32000;
    let mut full_content = String::new();
    let mut truncated = false;

    match request.model_interface.as_str() {
        "Anthropic-compatible" => {
            let endpoint = build_anthropic_endpoint(&request.base_url);
            let body = json!({
                "model": request.model,
                "messages": [{"role": "user", "content": user_prompt}],
                "system": system_prompt,
                "stream": true,
                "max_tokens": max_tokens,
                "temperature": 0.3,
            });

            let response = client
                .post(&endpoint)
                .header("x-api-key", &request.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await
                .map_err(|e| format_network_error(&e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("Anthropic 接口请求失败：{} {}", status, body_text));
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| format_network_error(&e))?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                process_sse_buffer(&mut buffer, |data| {
                    if let Some(event) = parse_anthropic_stream_event(data) {
                        match event {
                            crate::models::AnthropicStreamEvent::Text(delta) => {
                                full_content.push_str(&delta);
                                let _ = app.emit(
                                    "background-extraction-stream",
                                    BackgroundExtractionEvent {
                                        run_id: run_id.to_string(),
                                        event_type: "delta".to_string(),
                                        delta: Some(delta),
                                        message: None,
                                    },
                                );
                            }
                            crate::models::AnthropicStreamEvent::MessageDelta { stop_reason } => {
                                if stop_reason.as_deref() == Some("max_tokens") {
                                    truncated = true;
                                }
                            }
                            _ => {}
                        }
                    }
                });
            }
        }
        _ => {
            let endpoint = build_openai_endpoint(&request.base_url);
            let messages = vec![
                json!({"role": "system", "content": system_prompt}),
                json!({"role": "user", "content": user_prompt}),
            ];
            let body = json!({
                "model": request.model,
                "messages": messages,
                "stream": true,
                "temperature": 0.3,
                "max_tokens": max_tokens,
            });

            let response = client
                .post(&endpoint)
                .bearer_auth(&request.api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| format_network_error(&e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("OpenAI 兼容接口请求失败：{} {}", status, body_text));
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| format_network_error(&e))?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                process_sse_buffer(&mut buffer, |data| {
                    if data == "[DONE]" {
                        return;
                    }
                    if let Some(event) = parse_openai_stream_event(data) {
                        if event.finish_reason.as_deref() == Some("length") {
                            truncated = true;
                        }
                        if let Some(delta) = event.content {
                            full_content.push_str(&delta);
                            let _ = app.emit(
                                "background-extraction-stream",
                                BackgroundExtractionEvent {
                                    run_id: run_id.to_string(),
                                    event_type: "delta".to_string(),
                                    delta: Some(delta),
                                    message: None,
                                },
                            );
                        }
                    }
                });
            }
        }
    };

    if truncated {
        return Err("模型输出被截断（达到长度上限）。\n\
             建议：1）减少选中文件数量或先用“AI反向分析大纲”精简原文；\n\
             2）改用“仅提取世界书”或减少角色名数量；\n\
             3）更换支持更长输出的模型后重试。"
            .to_string());
    }

    canonical_json_response(full_content)
}

#[tauri::command]
pub async fn optimize_character_memories(
    request: OptimizeCharacterMemoriesRequest,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let system_prompt = "你是一个专门负责人物记忆分析与优化的专家。你需要读取用户角色现有的关键事件记录（这可能是由于多轮对话沉淀下来或由用户自行记录的共同记忆），将其浓缩成更简单明了、逻辑条理清晰的条目，并且智能分析并消除原本内容中记忆之间的任何逻辑矛盾。请仅返回优化后的关键事件，以纯文本形式返回即可，不要带有任何 JSON 包装或 Markdown 的 ``` 等多余前缀。";
    let user_prompt = format!(
        "请读取并优化以下这名角色的“关键事件”记录。\n\
         任务要求：\n\
         1. 精简浓缩冗长的叙述，用清晰的条目或时间线来重新呈现。\n\
         2. 仔细检查其中的逻辑，如果发现记忆条目在时间线、人设立场、经历等方面存在矛盾，以更合乎逻辑的、更积极深化两方感情/利益关联的版本进行消解和重写。\n\
         3. 请以清晰、有条理且精炼的中文文笔返回全部内容。仅返回优化后的记忆文本，不要包含任何包装或多余废话。\n\n\
         以下是需要优化的记忆记录：\n\
         ===========================\n\
         {}\n\
         ===========================\n",
        request.text
    );

    let max_tokens = 4096;

    let raw_content = match request.model_interface.as_str() {
        "Anthropic-compatible" => {
            let endpoint = build_anthropic_endpoint(&request.base_url);
            let body = json!({
                "model": request.model,
                "messages": [{"role": "user", "content": user_prompt}],
                "system": system_prompt,
                "stream": false,
                "max_tokens": max_tokens,
                "temperature": 0.5,
            });

            let response = client
                .post(&endpoint)
                .header("x-api-key", &request.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("Anthropic 接口请求失败：{} {}", status, body_text));
            }

            let json: Value = response.json().await.map_err(|e| e.to_string())?;
            json.get("content")
                .and_then(|c| c.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("type") == Some(&json!("text")))
                })
                .and_then(|text_block| text_block.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .trim()
                .to_string()
        }
        _ => {
            let endpoint = build_openai_endpoint(&request.base_url);
            let messages = vec![
                json!({"role": "system", "content": system_prompt}),
                json!({"role": "user", "content": user_prompt}),
            ];
            let body = json!({
                "model": request.model,
                "messages": messages,
                "stream": false,
                "temperature": 0.5,
                "max_tokens": max_tokens,
            });

            let response = client
                .post(&endpoint)
                .bearer_auth(&request.api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("OpenAI 兼容接口请求失败：{} {}", status, body_text));
            }

            let json: Value = response.json().await.map_err(|e| e.to_string())?;
            json.get("choices")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|choice| choice.get("message"))
                .and_then(|msg| msg.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .trim()
                .to_string()
        }
    };

    Ok(raw_content)
}

#[tauri::command]
pub async fn test_llm_connection(request: TestConnectionRequest) -> Result<String, String> {
    if request.api_key.trim().is_empty() {
        return Err(String::from("API Key 不能为空"));
    }
    if request.model.trim().is_empty() {
        return Err(String::from("模型名称不能为空"));
    }
    if request.base_url.trim().is_empty() {
        return Err(String::from("接口地址不能为空"));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let user_prompt = "ping";
    let max_tokens = 5;

    match request.model_interface.as_str() {
        "Anthropic-compatible" => {
            let endpoint = build_anthropic_endpoint(&request.base_url);
            let body = json!({
                "model": request.model,
                "messages": [{"role": "user", "content": user_prompt}],
                "stream": false,
                "max_tokens": max_tokens,
            });

            let response = client
                .post(&endpoint)
                .header("x-api-key", &request.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("无法连接到服务器：{}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("接口请求失败 (Status {}): {}", status, body_text));
            }

            let body = response.bytes().await.map_err(|error| {
                format_response_read_error("读取 Anthropic 兼容响应失败", &error)
            })?;
            let value: Value = serde_json::from_slice(&body)
                .map_err(|error| format!("Anthropic 兼容接口返回了无效响应：{}", error))?;
            let valid_message = value.get("type").and_then(Value::as_str) == Some("message")
                && value
                    .get("content")
                    .and_then(Value::as_array)
                    .map(|content| !content.is_empty())
                    .unwrap_or(false);
            if !valid_message {
                return Err(String::from("Anthropic 兼容接口返回了无效响应"));
            }

            Ok("连接成功".to_string())
        }
        _ => {
            let endpoint = build_openai_endpoint(&request.base_url);
            let messages = vec![json!({"role": "user", "content": user_prompt})];
            let body = json!({
                "model": request.model,
                "messages": messages,
                "stream": true,
                "max_tokens": max_tokens,
            });

            let response = client
                .post(&endpoint)
                .bearer_auth(&request.api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("无法连接到服务器：{}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("接口请求失败 (Status {}): {}", status, body_text));
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            let mut received_valid_event = false;
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|error| {
                    format_response_read_error("读取 OpenAI 兼容流式响应失败", &error)
                })?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                process_sse_buffer(&mut buffer, |data| {
                    if data == "[DONE]" || parse_openai_stream_event(data).is_some() {
                        received_valid_event = true;
                    }
                });
            }
            if !received_valid_event {
                return Err(String::from("OpenAI 兼容接口返回了无效流式响应"));
            }

            Ok("连接成功".to_string())
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ReverseOutlineSourceDoc {
    title: String,
    path: PathBuf,
    content: String,
    char_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ReverseOutlineSegment {
    title: String,
    content: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ReverseOutlineSummaryBatch {
    index: usize,
    range: String,
    items: Vec<ReverseOutlineSegment>,
}

fn reverse_outline_roots(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let doc_dir = resolve_document_dir(app)?;
    let museai_dir = doc_dir.join("MuseAI");
    let articles_dir = museai_dir.join("articles");
    let references_dir = museai_dir.join("references");
    let outline_dir = museai_dir.join("outline");
    fs::create_dir_all(&articles_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&references_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&outline_dir).map_err(|e| e.to_string())?;
    Ok((
        articles_dir.canonicalize().map_err(|e| e.to_string())?,
        references_dir.canonicalize().map_err(|e| e.to_string())?,
        outline_dir.canonicalize().map_err(|e| e.to_string())?,
    ))
}

fn title_from_path(path: &Path) -> Result<String, String> {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| stem.trim().to_string())
        .filter(|title| !title.is_empty())
        .ok_or_else(|| "文件标题不合法".to_string())
}

fn reverse_outline_char_count(content: &str) -> usize {
    content.chars().count()
}

fn is_reverse_outline_text_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("md" | "txt")
    )
}

fn sort_reverse_outline_docs(docs: &mut [ReverseOutlineSourceDoc]) {
    docs.sort_by(|a, b| {
        a.title
            .to_lowercase()
            .cmp(&b.title.to_lowercase())
            .then(a.title.cmp(&b.title))
            .then(a.path.cmp(&b.path))
    });
}

fn resolve_reverse_outline_sources(
    file_paths: &[String],
    articles_dir: &Path,
    references_dir: &Path,
) -> Result<Vec<ReverseOutlineSourceDoc>, String> {
    if file_paths.is_empty() {
        return Err("请先选择文章".to_string());
    }

    let mut docs = Vec::new();
    for file_path in file_paths {
        let path = Path::new(file_path);
        if !path.exists() {
            return Err("选择的文章不存在".to_string());
        }
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        if !canonical.starts_with(articles_dir) && !canonical.starts_with(references_dir) {
            return Err("只能选择作品目录或范文目录内的文章".to_string());
        }
        if canonical.is_file() && !is_reverse_outline_text_file(&canonical) {
            return Err("仅支持 Markdown 或 TXT 文本文件".to_string());
        }
        collect_reverse_outline_source_docs(&canonical, &mut docs)?;
    }
    sort_reverse_outline_docs(&mut docs);
    if docs.is_empty() {
        return Err("选择的目录中没有 Markdown 或 TXT 文本文件".to_string());
    }
    Ok(docs)
}

fn collect_reverse_outline_source_docs(
    path: &Path,
    docs: &mut Vec<ReverseOutlineSourceDoc>,
) -> Result<(), String> {
    if path.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let entry_path = entry.path();
            let name = entry
                .file_name()
                .into_string()
                .unwrap_or_else(|_| String::from("unknown"));
            if name.starts_with('.') {
                continue;
            }
            collect_reverse_outline_source_docs(&entry_path, docs)?;
        }
        return Ok(());
    }
    if !path.is_file() {
        return Ok(());
    }
    if !is_reverse_outline_text_file(path) {
        return Ok(());
    }
    let title = title_from_path(path)?;
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let char_count = reverse_outline_char_count(&content);
    docs.push(ReverseOutlineSourceDoc {
        title,
        path: path.to_path_buf(),
        content,
        char_count,
    });
    Ok(())
}

fn build_short_reverse_outline_text(docs: &[ReverseOutlineSourceDoc]) -> Result<String, String> {
    let total_chars: usize = docs.iter().map(|doc| doc.char_count).sum();
    if total_chars > 50_000 {
        return Err("短篇反向分析最多支持5万字，请选择文章类型为长篇".to_string());
    }
    Ok(docs
        .iter()
        .map(|doc| format!("# {}\n\n{}", doc.title, doc.content.trim()))
        .collect::<Vec<_>>()
        .join("\n\n"))
}

fn split_content_by_char_limit(content: &str, limit: usize) -> Vec<String> {
    if content.is_empty() {
        return vec![String::new()];
    }
    let chars: Vec<char> = content.chars().collect();
    chars
        .chunks(limit)
        .map(|chunk| chunk.iter().collect::<String>())
        .collect()
}

fn build_long_reverse_outline_segments(
    docs: &[ReverseOutlineSourceDoc],
) -> Vec<ReverseOutlineSegment> {
    let mut segments = Vec::new();
    for doc in docs {
        if doc.char_count <= 5_000 {
            segments.push(ReverseOutlineSegment {
                title: doc.title.clone(),
                content: doc.content.clone(),
            });
            continue;
        }
        for (index, part) in split_content_by_char_limit(&doc.content, 5_000)
            .into_iter()
            .enumerate()
        {
            segments.push(ReverseOutlineSegment {
                title: format!("{}（第{}段）", doc.title, index + 1),
                content: part,
            });
        }
    }
    segments
}

fn build_long_reverse_outline_batches(
    segments: &[ReverseOutlineSegment],
) -> Vec<ReverseOutlineSummaryBatch> {
    segments
        .chunks(10)
        .enumerate()
        .map(|(index, chunk)| {
            let start = index * 10 + 1;
            let end = start + chunk.len() - 1;
            ReverseOutlineSummaryBatch {
                index,
                range: format!("{}-{}", start, end),
                items: chunk.to_vec(),
            }
        })
        .collect()
}

fn sanitize_reverse_outline_title(title: &str) -> Result<String, String> {
    let sanitized = title
        .trim()
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            _ => ch,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if sanitized.is_empty() {
        return Err("请填写大纲标题".to_string());
    }
    Ok(sanitized)
}

fn unique_reverse_outline_path(outline_dir: &Path, title: &str) -> Result<PathBuf, String> {
    let safe_title = sanitize_reverse_outline_title(title)?;
    let mut candidate = outline_dir.join(format!("{}.md", safe_title));
    if !candidate.exists() {
        return Ok(candidate);
    }
    for index in 2..1000 {
        candidate = outline_dir.join(format!("{} {}.md", safe_title, index));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("无法生成可用的大纲文件名".to_string())
}

fn save_reverse_outline_for_root(
    outline_dir: &Path,
    title: &str,
    content: &str,
) -> Result<PathBuf, String> {
    if content.trim().is_empty() {
        return Err("请填写大纲内容".to_string());
    }
    fs::create_dir_all(outline_dir).map_err(|e| e.to_string())?;
    let canonical_outline = outline_dir.canonicalize().map_err(|e| e.to_string())?;
    let path = unique_reverse_outline_path(&canonical_outline, title)?;
    if path.parent() != Some(canonical_outline.as_path()) {
        return Err("只能保存到大纲根目录".to_string());
    }
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path)
}

fn reverse_outline_request_for_stage(
    request: &ReverseOutlineAnalysisRequest,
    stage_config: Option<&ReverseOutlineStageConfig>,
) -> ReverseOutlineAnalysisRequest {
    let Some(config) = stage_config else {
        return request.clone();
    };
    ReverseOutlineAnalysisRequest {
        model_interface: config.model_interface.clone(),
        base_url: config.base_url.clone(),
        api_key: config.api_key.clone(),
        model: config.model.clone(),
        article_type: request.article_type.clone(),
        file_paths: request.file_paths.clone(),
        temperature: config.temperature,
        max_output_tokens: config.max_output_tokens,
        max_context_tokens: config.max_context_tokens,
        thinking_depth: config.thinking_depth.clone(),
        system_prompt: config.system_prompt.clone(),
        concurrency: request.concurrency,
        short_config: None,
        long_summary_config: None,
        long_final_config: None,
    }
}

fn reverse_outline_retry_request_for_stage(
    request: &ReverseOutlineRetryRequest,
    stage_config: Option<&ReverseOutlineStageConfig>,
) -> ReverseOutlineAnalysisRequest {
    let fallback = ReverseOutlineStageConfig {
        model_interface: request.model_interface.clone(),
        base_url: request.base_url.clone(),
        api_key: request.api_key.clone(),
        model: request.model.clone(),
        temperature: request.temperature,
        max_output_tokens: request.max_output_tokens,
        max_context_tokens: request.max_context_tokens,
        thinking_depth: request.thinking_depth.clone(),
        system_prompt: request.system_prompt.clone(),
    };
    let config = stage_config.unwrap_or(&fallback);
    ReverseOutlineAnalysisRequest {
        model_interface: config.model_interface.clone(),
        base_url: config.base_url.clone(),
        api_key: config.api_key.clone(),
        model: config.model.clone(),
        article_type: "long".to_string(),
        file_paths: request.file_paths.clone(),
        temperature: config.temperature,
        max_output_tokens: config.max_output_tokens,
        max_context_tokens: config.max_context_tokens,
        thinking_depth: config.thinking_depth.clone(),
        system_prompt: config.system_prompt.clone(),
        concurrency: request.concurrency,
        short_config: None,
        long_summary_config: None,
        long_final_config: None,
    }
}

fn build_openai_reverse_outline_body(
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
    temperature: f32,
    thinking_depth: Option<&str>,
    stream: bool,
) -> Value {
    let messages = vec![
        json!({"role": "system", "content": system_prompt}),
        json!({"role": "user", "content": user_prompt}),
    ];
    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": stream,
        "temperature": temperature,
        "max_tokens": max_tokens,
    });
    let depth = thinking_depth.unwrap_or("").trim();
    if depth.is_empty() || depth == "off" {
        body["enable_thinking"] = json!(false);
    } else {
        body["enable_thinking"] = json!(true);
        body["reasoning_effort"] = json!(depth);
    }
    body
}

async fn call_reverse_outline_llm(
    client: &reqwest::Client,
    request: &ReverseOutlineAnalysisRequest,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let temperature = request.temperature.unwrap_or(0.3);
    let thinking_depth = request.thinking_depth.as_deref();
    match request.model_interface.as_str() {
        "Anthropic-compatible" => {
            let endpoint = build_anthropic_endpoint(&request.base_url);
            let mut body = json!({
                "model": request.model,
                "messages": [{"role": "user", "content": user_prompt}],
                "system": system_prompt,
                "stream": false,
                "temperature": temperature,
                "max_tokens": max_tokens,
            });
            let depth = thinking_depth.unwrap_or("").trim();
            if !depth.is_empty() && depth != "off" {
                body["thinking"] = json!({"type": "enabled", "budget_tokens": 16000});
            }

            let response = client
                .post(&endpoint)
                .header("x-api-key", &request.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await
                .map_err(|e| format_reverse_outline_send_error("Anthropic", &endpoint, &e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("Anthropic 接口请求失败：{} {}", status, body_text));
            }

            let json: Value = response.json().await.map_err(|e| e.to_string())?;
            Ok(json
                .get("content")
                .and_then(|c| c.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("type") == Some(&json!("text")))
                })
                .and_then(|text_block| text_block.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .trim()
                .to_string())
        }
        _ => {
            let endpoint = build_openai_endpoint(&request.base_url);
            let body = build_openai_reverse_outline_body(
                &request.model,
                system_prompt,
                user_prompt,
                max_tokens,
                temperature,
                thinking_depth,
                false,
            );

            let response = client
                .post(&endpoint)
                .bearer_auth(&request.api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| format_reverse_outline_send_error("OpenAI 兼容", &endpoint, &e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!(
                    "OpenAI 兼容接口请求失败：{} {}（请求地址：{}，模型：{}）",
                    status, body_text, endpoint, request.model
                ));
            }

            let json: Value = response.json().await.map_err(|e| e.to_string())?;
            Ok(json
                .get("choices")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|choice| choice.get("message"))
                .and_then(|msg| msg.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .trim()
                .to_string())
        }
    }
}

fn format_reverse_outline_send_error(
    interface_label: &str,
    endpoint: &str,
    error: &reqwest::Error,
) -> String {
    format!(
        "{}接口请求发送失败：{}（请求地址：{}。请检查设置中的接口类型、API 地址、模型是否匹配。）",
        interface_label, error, endpoint
    )
}

async fn call_reverse_outline_llm_stream(
    app: &AppHandle,
    run_id: &str,
    client: &reqwest::Client,
    request: &ReverseOutlineAnalysisRequest,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let temperature = request.temperature.unwrap_or(0.3);
    let thinking_depth = request.thinking_depth.as_deref();
    let mut full_content = String::new();

    match request.model_interface.as_str() {
        "Anthropic-compatible" => {
            let endpoint = build_anthropic_endpoint(&request.base_url);
            let mut body = json!({
                "model": request.model,
                "messages": [{"role": "user", "content": user_prompt}],
                "system": system_prompt,
                "stream": true,
                "temperature": temperature,
                "max_tokens": max_tokens,
            });
            let depth = thinking_depth.unwrap_or("").trim();
            if !depth.is_empty() && depth != "off" {
                body["thinking"] = json!({"type": "enabled", "budget_tokens": 16000});
            }

            let response = client
                .post(&endpoint)
                .header("x-api-key", &request.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await
                .map_err(|e| format_reverse_outline_send_error("Anthropic", &endpoint, &e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("Anthropic 接口请求失败：{} {}", status, body_text));
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(chunk) => {
                        buffer.push_str(&String::from_utf8_lossy(&chunk));
                        process_sse_buffer(&mut buffer, |data| {
                            if let Some(crate::models::AnthropicStreamEvent::Text(delta)) =
                                parse_anthropic_stream_event(data)
                            {
                                full_content.push_str(&delta);
                                let _ = app.emit(
                                    "reverse-outline-stream",
                                    ReverseOutlineStreamEvent {
                                        run_id: run_id.to_string(),
                                        delta,
                                    },
                                );
                            }
                        });
                    }
                    Err(e) => {
                        if !full_content.is_empty() {
                            break;
                        }
                        return Err(format_reverse_outline_send_error(
                            "Anthropic",
                            &endpoint,
                            &e,
                        ));
                    }
                }
            }
        }
        _ => {
            let endpoint = build_openai_endpoint(&request.base_url);
            let body = build_openai_reverse_outline_body(
                &request.model,
                system_prompt,
                user_prompt,
                max_tokens,
                temperature,
                thinking_depth,
                true,
            );

            let response = client
                .post(&endpoint)
                .bearer_auth(&request.api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| format_reverse_outline_send_error("OpenAI 兼容", &endpoint, &e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!(
                    "OpenAI 兼容接口请求失败：{} {}（请求地址：{}，模型：{}）",
                    status, body_text, endpoint, request.model
                ));
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(chunk) => {
                        buffer.push_str(&String::from_utf8_lossy(&chunk));
                        process_sse_buffer(&mut buffer, |data| {
                            if data == "[DONE]" {
                                return;
                            }
                            if let Some(event) = parse_openai_stream_event(data) {
                                if let Some(delta) = event.content {
                                    full_content.push_str(&delta);
                                    let _ = app.emit(
                                        "reverse-outline-stream",
                                        ReverseOutlineStreamEvent {
                                            run_id: run_id.to_string(),
                                            delta,
                                        },
                                    );
                                }
                            }
                        });
                    }
                    Err(e) => {
                        if !full_content.is_empty() {
                            break;
                        }
                        return Err(format_reverse_outline_send_error(
                            "OpenAI 兼容",
                            &endpoint,
                            &e,
                        ));
                    }
                }
            }
        }
    }

    Ok(full_content.trim().to_string())
}

fn short_reverse_outline_prompt(
    text: &str,
    system_prompt_override: Option<&str>,
) -> (String, String) {
    let system_prompt = system_prompt_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("你是一个小说结构分析专家，负责从用户提供的完整短篇文本中反向提炼大纲。请只输出 Markdown 大纲，不要输出解释。")
        .to_string();
    let user_prompt = format!(
        "请根据以下按标题排序后的文章标题和正文，生成反向大纲。\n\
         以下是文章内容：\n{}\n",
        text
    );
    (system_prompt, user_prompt)
}

fn long_summary_prompt(
    batch: &ReverseOutlineSummaryBatch,
    system_prompt_override: Option<&str>,
) -> Result<(String, String), String> {
    let system_prompt = system_prompt_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("你是小说剧情摘要助手。你只需要总结用户提供的章节内容，返回纯文本剧情概要，不要输出 JSON、Markdown 标题或解释。")
        .to_string();
    let items = batch
        .items
        .iter()
        .map(|item| json!({"标题": item.title, "正文": item.content}))
        .collect::<Vec<_>>();
    let input = serde_json::to_string(&items).map_err(|e| e.to_string())?;
    let user_prompt = format!(
        "请总结以下章节的剧情概要，只返回纯文本。\n段落序号：{}\n章节 JSON：{}",
        batch.range, input
    );
    Ok((system_prompt, user_prompt))
}

fn long_final_prompt(
    summaries: &[Value],
    system_prompt_override: Option<&str>,
) -> Result<(String, String), String> {
    let system_prompt = system_prompt_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("你是长篇小说结构分析专家，负责根据分布式剧情概要反向整理完整大纲。请只输出 Markdown 大纲，不要输出解释。")
        .to_string();
    let summary_json = serde_json::to_string_pretty(summaries).map_err(|e| e.to_string())?;
    let user_prompt = format!(
        "请根据以下分段剧情概要生成长篇反向大纲。\n\
         分段剧情概要 JSON：\n{}",
        summary_json
    );
    Ok((system_prompt, user_prompt))
}

fn default_reverse_outline_title(article_type: &str) -> String {
    match article_type {
        "long" => "长篇反向大纲".to_string(),
        _ => "短篇反向大纲".to_string(),
    }
}

#[tauri::command]
pub fn preview_reverse_outline_chapters(
    app: AppHandle,
    file_paths: Vec<String>,
) -> Result<Vec<ReverseOutlineChapterPreview>, String> {
    let (articles_dir, references_dir, _) = reverse_outline_roots(&app)?;
    let docs = resolve_reverse_outline_sources(&file_paths, &articles_dir, &references_dir)?;
    Ok(docs
        .into_iter()
        .map(|doc| ReverseOutlineChapterPreview {
            title: doc.title,
            path: doc.path.to_string_lossy().into_owned(),
            char_count: doc.char_count,
        })
        .collect())
}

#[tauri::command]
pub fn save_reverse_outline(
    app: AppHandle,
    request: ReverseOutlineSaveRequest,
) -> Result<ReverseOutlineSaveResult, String> {
    let (_, _, outline_dir) = reverse_outline_roots(&app)?;
    let path = save_reverse_outline_for_root(&outline_dir, &request.title, &request.content)?;
    let _ = app.emit("workspace-changed", ());
    Ok(ReverseOutlineSaveResult {
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn start_reverse_outline_analysis(
    app: AppHandle,
    request: ReverseOutlineAnalysisRequest,
    _state: tauri::State<'_, ActiveStreams>,
) -> Result<ReverseOutlineAnalysisStarted, String> {
    if request.api_key.trim().is_empty() {
        return Err("API Key 不能为空".to_string());
    }
    if request.model.trim().is_empty() {
        return Err("模型名称不能为空".to_string());
    }
    if request.base_url.trim().is_empty() {
        return Err("接口地址不能为空".to_string());
    }
    if request.article_type != "short" && request.article_type != "long" {
        return Err("请选择文章类型".to_string());
    }

    let (articles_dir, references_dir, _) = reverse_outline_roots(&app)?;
    let docs =
        resolve_reverse_outline_sources(&request.file_paths, &articles_dir, &references_dir)?;
    if request.article_type == "short" {
        build_short_reverse_outline_text(&docs)?;
    }

    let run_id = Uuid::new_v4().to_string();
    let spawned_run_id = run_id.clone();
    let task_app = app.clone();
    let cleanup_app = app.clone();
    let result_article_type = request.article_type.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let outcome =
            run_reverse_outline_analysis_task(&task_app, &spawned_run_id, request, docs).await;
        match outcome {
            ReverseOutlineOutcome::Success(content) => {
                let _ = task_app.emit(
                    "reverse-outline-result",
                    ReverseOutlineResultEvent {
                        run_id: spawned_run_id.clone(),
                        title: Some(default_reverse_outline_title(&result_article_type)),
                        content: Some(content),
                        error: None,
                        failed_batch_indices: None,
                        failed_batch_errors: None,
                        partial_summaries: None,
                    },
                );
            }
            ReverseOutlineOutcome::PartialFailure {
                error,
                failed_batch_indices,
                failed_batch_errors,
                partial_summaries,
            } => {
                let _ = task_app.emit(
                    "reverse-outline-result",
                    ReverseOutlineResultEvent {
                        run_id: spawned_run_id.clone(),
                        title: None,
                        content: None,
                        error: Some(error),
                        failed_batch_indices: Some(failed_batch_indices),
                        failed_batch_errors: Some(failed_batch_errors),
                        partial_summaries: Some(partial_summaries),
                    },
                );
            }
        }
        if let Some(active_streams) = cleanup_app.try_state::<ActiveStreams>() {
            if let Ok(mut streams) = active_streams.0.lock() {
                streams.remove(&spawned_run_id);
            }
        }
    });

    if let Some(active_streams) = app.try_state::<ActiveStreams>() {
        if let Ok(mut streams) = active_streams.0.lock() {
            streams.insert(run_id.clone(), handle);
        }
    }

    Ok(ReverseOutlineAnalysisStarted { run_id })
}

#[tauri::command]
pub fn retry_and_finalize_reverse_outline(
    app: AppHandle,
    request: ReverseOutlineRetryRequest,
    _state: tauri::State<'_, ActiveStreams>,
) -> Result<ReverseOutlineAnalysisStarted, String> {
    if request.api_key.trim().is_empty() {
        return Err("API Key 不能为空".to_string());
    }
    if request.model.trim().is_empty() {
        return Err("模型名称不能为空".to_string());
    }
    if request.base_url.trim().is_empty() {
        return Err("接口地址不能为空".to_string());
    }

    let (articles_dir, references_dir, _) = reverse_outline_roots(&app)?;
    let docs =
        resolve_reverse_outline_sources(&request.file_paths, &articles_dir, &references_dir)?;

    let run_id = Uuid::new_v4().to_string();
    let spawned_run_id = run_id.clone();
    let task_app = app.clone();
    let failed_indices = request.failed_batch_indices.clone();
    let partial_summaries = request.partial_summaries.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let segments = build_long_reverse_outline_segments(&docs);
        let batches = build_long_reverse_outline_batches(&segments);
        let retry_batches: Vec<ReverseOutlineSummaryBatch> = batches
            .into_iter()
            .filter(|b| failed_indices.contains(&b.index))
            .collect();

        let mut new_successes: Vec<(usize, Value)> = Vec::new();
        let mut still_failed: Vec<ReverseOutlineBatchError> = Vec::new();

        if !retry_batches.is_empty() {
            let client = match reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(180))
                .build()
            {
                Ok(c) => c,
                Err(e) => {
                    let _ = task_app.emit(
                        "reverse-outline-result",
                        ReverseOutlineResultEvent {
                            run_id: spawned_run_id.clone(),
                            title: None,
                            content: None,
                            error: Some(format!("客户端构建失败: {}", e)),
                            failed_batch_indices: Some(failed_indices),
                            failed_batch_errors: None,
                            partial_summaries: Some(partial_summaries),
                        },
                    );
                    return;
                }
            };

            let request_for_batches = request.clone();
            let client_for_batches = client.clone();
            let concurrency = request.concurrency.unwrap_or(5).clamp(1, 20) as usize;
            let stream = futures_util::stream::iter(retry_batches.into_iter().map(|batch| {
                let request = request_for_batches.clone();
                let client = client_for_batches.clone();
                async move {
                    let summary_request = reverse_outline_retry_request_for_stage(
                        &request,
                        request.long_summary_config.as_ref(),
                    );
                    let (system_prompt, user_prompt) =
                        long_summary_prompt(&batch, summary_request.system_prompt.as_deref())
                            .map_err(|error| ReverseOutlineBatchError {
                                index: batch.index,
                                range: batch.range.clone(),
                                error,
                            })?;
                    let max_tokens = summary_request.max_output_tokens.unwrap_or(2048);
                    let summary = call_reverse_outline_llm(
                        &client,
                        &summary_request,
                        &system_prompt,
                        &user_prompt,
                        max_tokens,
                    )
                    .await
                    .map_err(|error| ReverseOutlineBatchError {
                        index: batch.index,
                        range: batch.range.clone(),
                        error,
                    })?;
                    Ok::<(usize, Value), ReverseOutlineBatchError>((
                        batch.index,
                        json!({
                            "段落序号": batch.range,
                            "剧情概要": summary,
                        }),
                    ))
                }
            }))
            .buffer_unordered(concurrency);

            futures_util::pin_mut!(stream);
            while let Some(result) = stream.next().await {
                match result {
                    Ok((index, mut v)) => {
                        v["batchIndex"] = json!(index);
                        new_successes.push((index, v));
                    }
                    Err(error) => still_failed.push(error),
                }
            }

            let success_set: std::collections::HashSet<usize> =
                new_successes.iter().map(|(i, _)| *i).collect();
            for i in &failed_indices {
                if !success_set.contains(i)
                    && !still_failed.iter().any(|failure| failure.index == *i)
                {
                    still_failed.push(ReverseOutlineBatchError {
                        index: *i,
                        range: format!("{}-{}", i * 10 + 1, i * 10 + 10),
                        error: "未返回失败原因".to_string(),
                    });
                }
            }
        }

        // 合并旧结果和新结果
        let mut merged: Vec<Value> = partial_summaries;
        // 移除旧结果中成功重试的批次
        merged.retain(|v| {
            v.get("batchIndex")
                .and_then(|b| b.as_u64())
                .map(|idx| !new_successes.iter().any(|(ni, _)| *ni == idx as usize))
                .unwrap_or(true)
        });
        for (_, v) in new_successes {
            merged.push(v);
        }

        if !still_failed.is_empty() {
            let still_failed_indices = still_failed
                .iter()
                .map(|failure| failure.index)
                .collect::<Vec<_>>();
            let _ = task_app.emit(
                "reverse-outline-result",
                ReverseOutlineResultEvent {
                    run_id: spawned_run_id.clone(),
                    title: None,
                    content: None,
                    error: Some("部分段落分析仍失败".to_string()),
                    failed_batch_indices: Some(still_failed_indices),
                    failed_batch_errors: Some(still_failed),
                    partial_summaries: Some(merged),
                },
            );
            return;
        }

        // 全部成功，进入 final 汇总
        let mut ordered: Vec<(usize, Value)> = merged
            .into_iter()
            .filter_map(|mut v| {
                let idx = v.get("batchIndex")?.as_u64()? as usize;
                v.as_object_mut()?.remove("batchIndex");
                Some((idx, v))
            })
            .collect();
        ordered.sort_by_key(|(index, _)| *index);

        let final_result = run_reverse_outline_final(
            &task_app,
            &spawned_run_id,
            &reverse_outline_retry_request_for_stage(&request, request.long_final_config.as_ref()),
            &ordered,
        )
        .await;

        match final_result {
            Ok(content) => {
                let _ = task_app.emit(
                    "reverse-outline-result",
                    ReverseOutlineResultEvent {
                        run_id: spawned_run_id.clone(),
                        title: Some("长篇反向大纲".to_string()),
                        content: Some(content),
                        error: None,
                        failed_batch_indices: None,
                        failed_batch_errors: None,
                        partial_summaries: None,
                    },
                );
            }
            Err(error) => {
                let _ = task_app.emit(
                    "reverse-outline-result",
                    ReverseOutlineResultEvent {
                        run_id: spawned_run_id.clone(),
                        title: None,
                        content: None,
                        error: Some(error),
                        failed_batch_indices: None,
                        failed_batch_errors: None,
                        partial_summaries: None,
                    },
                );
            }
        }
    });

    if let Some(active_streams) = app.try_state::<ActiveStreams>() {
        if let Ok(mut streams) = active_streams.0.lock() {
            streams.insert(run_id.clone(), handle);
        }
    }

    Ok(ReverseOutlineAnalysisStarted { run_id })
}

async fn run_reverse_outline_distributed(
    app: &AppHandle,
    run_id: &str,
    request: &ReverseOutlineAnalysisRequest,
    docs: &[ReverseOutlineSourceDoc],
) -> (Vec<(usize, Value)>, Vec<ReverseOutlineBatchError>) {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
    {
        Ok(c) => c,
        Err(_) => return (Vec::new(), Vec::new()),
    };
    let segments = build_long_reverse_outline_segments(docs);
    let batches = build_long_reverse_outline_batches(&segments);
    let total_chapters = batches.len();
    let _ = app.emit(
        "reverse-outline-progress",
        ReverseOutlineProgressEvent {
            run_id: run_id.to_string(),
            phase: "distributed".to_string(),
            total_chapters,
            success_chapters: 0,
            failed_chapters: 0,
            message: Some("正在分布式分析章节".to_string()),
        },
    );

    let mut success_count = 0usize;
    let mut failed_count = 0usize;
    let app_for_progress = app.clone();
    let run_id_for_progress = run_id.to_string();
    let summary_request =
        reverse_outline_request_for_stage(request, request.long_summary_config.as_ref());
    let request_for_batches = summary_request;
    let client_for_batches = client.clone();
    let concurrency = request.concurrency.unwrap_or(5).clamp(1, 20) as usize;
    let stream = futures_util::stream::iter(batches.into_iter().map(|batch| {
        let request = request_for_batches.clone();
        let client = client_for_batches.clone();
        async move {
            let (system_prompt, user_prompt) =
                long_summary_prompt(&batch, request.system_prompt.as_deref()).map_err(|error| {
                    ReverseOutlineBatchError {
                        index: batch.index,
                        range: batch.range.clone(),
                        error,
                    }
                })?;
            let max_tokens = request.max_output_tokens.unwrap_or(2048);
            let summary = call_reverse_outline_llm(
                &client,
                &request,
                &system_prompt,
                &user_prompt,
                max_tokens,
            )
            .await
            .map_err(|error| ReverseOutlineBatchError {
                index: batch.index,
                range: batch.range.clone(),
                error,
            })?;
            Ok::<(usize, Value), ReverseOutlineBatchError>((
                batch.index,
                json!({
                    "段落序号": batch.range,
                    "剧情概要": summary,
                }),
            ))
        }
    }))
    .buffer_unordered(concurrency);

    futures_util::pin_mut!(stream);
    let mut wrapped_summaries = Vec::new();
    let mut failed_indices = Vec::new();
    while let Some(result) = stream.next().await {
        match result {
            Ok(summary) => {
                success_count += 1;
                wrapped_summaries.push(summary);
            }
            Err(error) => {
                failed_count += 1;
                failed_indices.push(error);
            }
        }
        let _ = app_for_progress.emit(
            "reverse-outline-progress",
            ReverseOutlineProgressEvent {
                run_id: run_id_for_progress.clone(),
                phase: "distributed".to_string(),
                total_chapters,
                success_chapters: success_count,
                failed_chapters: failed_count,
                message: None,
            },
        );
    }

    // 记录异常结束但没有返回具体错误的批次索引（基于所有批次总数）
    let success_set: std::collections::HashSet<usize> =
        wrapped_summaries.iter().map(|(i, _)| *i).collect();
    for i in 0..total_chapters {
        if !success_set.contains(&i) && !failed_indices.iter().any(|failure| failure.index == i) {
            failed_indices.push(ReverseOutlineBatchError {
                index: i,
                range: format!("{}-{}", i * 10 + 1, i * 10 + 10),
                error: "未返回失败原因".to_string(),
            });
        }
    }

    (wrapped_summaries, failed_indices)
}

async fn run_reverse_outline_final(
    app: &AppHandle,
    run_id: &str,
    request: &ReverseOutlineAnalysisRequest,
    summaries: &[(usize, Value)],
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let total_chapters = summaries.len();
    let _ = app.emit(
        "reverse-outline-progress",
        ReverseOutlineProgressEvent {
            run_id: run_id.to_string(),
            phase: "final".to_string(),
            total_chapters,
            success_chapters: total_chapters,
            failed_chapters: 0,
            message: Some("正在汇总生成长篇反向大纲".to_string()),
        },
    );
    let mut ordered = summaries.to_vec();
    ordered.sort_by_key(|(index, _)| *index);
    let ordered_summaries = ordered.into_iter().map(|(_, s)| s).collect::<Vec<_>>();
    let final_request =
        reverse_outline_request_for_stage(request, request.long_final_config.as_ref());
    let system_prompt_override = final_request.system_prompt.as_deref();
    let (system_prompt, user_prompt) =
        long_final_prompt(&ordered_summaries, system_prompt_override)?;
    let max_tokens = final_request.max_output_tokens.unwrap_or(8192);
    call_reverse_outline_llm_stream(
        app,
        run_id,
        &client,
        &final_request,
        &system_prompt,
        &user_prompt,
        max_tokens,
    )
    .await
}

enum ReverseOutlineOutcome {
    Success(String),
    PartialFailure {
        error: String,
        failed_batch_indices: Vec<usize>,
        failed_batch_errors: Vec<ReverseOutlineBatchError>,
        partial_summaries: Vec<Value>,
    },
}

async fn run_reverse_outline_analysis_task(
    app: &AppHandle,
    run_id: &str,
    request: ReverseOutlineAnalysisRequest,
    docs: Vec<ReverseOutlineSourceDoc>,
) -> ReverseOutlineOutcome {
    if request.article_type == "short" {
        let short_request =
            reverse_outline_request_for_stage(&request, request.short_config.as_ref());
        let system_prompt_override = short_request.system_prompt.as_deref();
        let client = match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(180))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                return ReverseOutlineOutcome::Success(format!("客户端构建失败: {}", e));
            }
        };
        let text = match build_short_reverse_outline_text(&docs) {
            Ok(t) => t,
            Err(e) => return ReverseOutlineOutcome::Success(e),
        };
        let _ = app.emit(
            "reverse-outline-progress",
            ReverseOutlineProgressEvent {
                run_id: run_id.to_string(),
                phase: "short".to_string(),
                total_chapters: docs.len(),
                success_chapters: 0,
                failed_chapters: 0,
                message: Some("正在生成短篇反向大纲".to_string()),
            },
        );
        let (system_prompt, user_prompt) =
            short_reverse_outline_prompt(&text, system_prompt_override);
        let max_tokens = short_request.max_output_tokens.unwrap_or(4096);
        match call_reverse_outline_llm(
            &client,
            &short_request,
            &system_prompt,
            &user_prompt,
            max_tokens,
        )
        .await
        {
            Ok(content) => ReverseOutlineOutcome::Success(content),
            Err(e) => ReverseOutlineOutcome::Success(e),
        }
    } else {
        let (wrapped_summaries, failed_batch_errors) =
            run_reverse_outline_distributed(app, run_id, &request, &docs).await;

        if !failed_batch_errors.is_empty() {
            let partial: Vec<Value> = wrapped_summaries
                .into_iter()
                .map(|(index, mut v)| {
                    v["batchIndex"] = json!(index);
                    v
                })
                .collect();
            let failed_batch_indices = failed_batch_errors
                .iter()
                .map(|failure| failure.index)
                .collect::<Vec<_>>();
            return ReverseOutlineOutcome::PartialFailure {
                error: "部分段落分析失败".to_string(),
                failed_batch_indices,
                failed_batch_errors,
                partial_summaries: partial,
            };
        }

        match run_reverse_outline_final(app, run_id, &request, &wrapped_summaries).await {
            Ok(content) => ReverseOutlineOutcome::Success(content),
            Err(e) => ReverseOutlineOutcome::Success(e),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::{
        append_agent_run_error_log, build_analyze_memory_user_prompt,
        build_background_character_card_prompts, build_background_stage_one_prompts,
        build_long_reverse_outline_batches, build_long_reverse_outline_segments,
        build_openai_background_body, build_openai_reverse_outline_body,
        build_short_reverse_outline_text, canonical_json_response, clean_json_response,
        format_reverse_outline_send_error, long_final_prompt, long_summary_prompt,
        parse_background_character_card_response, parse_background_stage_one_response,
        resolve_reverse_outline_sources, reverse_outline_char_count,
        sanitize_reverse_outline_title, save_reverse_outline_for_root,
        short_reverse_outline_prompt, ReverseOutlineSegment, ReverseOutlineSourceDoc,
        ReverseOutlineSummaryBatch,
    };
    use crate::models::{AnalyzeMemoryRequest, TestConnectionRequest};
    use serde_json::Value;
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::time::SystemTime;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn spawn_connection_test_server(
        response: Vec<u8>,
    ) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test server should bind");
        let address = listener.local_addr().expect("test address should exist");
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("request should connect");
            let mut request = Vec::new();
            let mut buffer = [0u8; 4096];
            loop {
                let read = socket
                    .read(&mut buffer)
                    .await
                    .expect("request should be readable");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n")
                else {
                    continue;
                };
                let headers = String::from_utf8_lossy(&request[..header_end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                if request.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            socket
                .write_all(&response)
                .await
                .expect("response should be written");
            String::from_utf8_lossy(&request).into_owned()
        });
        (format!("http://{}", address), handle)
    }

    fn complete_http_response(content_type: &str, body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            content_type,
            body.len(),
            body
        )
        .into_bytes()
    }

    fn connection_request(model_interface: &str, base_url: String) -> TestConnectionRequest {
        TestConnectionRequest {
            model_interface: model_interface.to_string(),
            base_url,
            api_key: "test-key".to_string(),
            model: "test-model".to_string(),
        }
    }

    fn temp_museai_dir(name: &str) -> std::path::PathBuf {
        let millis = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time should be after epoch")
            .as_millis();
        env::temp_dir().join(format!("museai_agent_log_test_{}_{}", millis, name))
    }

    #[test]
    fn append_agent_run_error_log_writes_jsonl_under_logs_dir() {
        let dir = temp_museai_dir("error");

        append_agent_run_error_log(&dir, Some("run-123"), "模型请求失败", 12345)
            .expect("log should be written");

        let log_path = dir.join(".logs").join("agent-runs.log");
        let text = fs::read_to_string(&log_path).expect("log file should exist");
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 1);
        let entry: Value = serde_json::from_str(lines[0]).expect("log line should be json");
        assert_eq!(entry["timestamp"], 12345);
        assert_eq!(entry["runId"], "run-123");
        assert_eq!(entry["event"], "error");
        assert_eq!(entry["message"], "模型请求失败");

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn test_llm_connection_reads_valid_openai_stream() {
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"pong\"}}]}\n\ndata: [DONE]\n\n";
        let (base_url, request_handle) =
            spawn_connection_test_server(complete_http_response("text/event-stream", body)).await;

        let result =
            super::test_llm_connection(connection_request("OpenAI-compatible", base_url)).await;
        let raw_request = request_handle.await.expect("server task should finish");
        let request_body = raw_request
            .split_once("\r\n\r\n")
            .map(|(_, body)| body)
            .expect("request body should exist");
        let json: Value = serde_json::from_str(request_body).expect("request should contain json");

        assert_eq!(result.as_deref(), Ok("连接成功"));
        assert_eq!(json["stream"], true);
        assert_eq!(json["max_tokens"], 5);
        assert!(json.get("tools").is_none());
        assert!(json.get("tool_choice").is_none());
    }

    #[tokio::test]
    async fn test_llm_connection_rejects_openai_stream_that_breaks_after_200() {
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 200\r\nConnection: close\r\n\r\ndata: {\"choices\":".to_vec();
        let (base_url, request_handle) = spawn_connection_test_server(response).await;

        let error = super::test_llm_connection(connection_request("OpenAI-compatible", base_url))
            .await
            .expect_err("truncated stream should fail");
        request_handle.await.expect("server task should finish");

        assert!(error.contains("读取 OpenAI 兼容流式响应失败"));
        assert!(error.contains("error decoding response body"));
    }

    #[tokio::test]
    async fn test_llm_connection_reads_valid_anthropic_body() {
        let body =
            r#"{"id":"msg_test","type":"message","content":[{"type":"text","text":"pong"}]}"#;
        let (base_url, request_handle) =
            spawn_connection_test_server(complete_http_response("application/json", body)).await;

        let result =
            super::test_llm_connection(connection_request("Anthropic-compatible", base_url)).await;
        request_handle.await.expect("server task should finish");

        assert_eq!(result.as_deref(), Ok("连接成功"));
    }

    #[tokio::test]
    async fn test_llm_connection_rejects_invalid_anthropic_body_after_200() {
        let (base_url, request_handle) = spawn_connection_test_server(complete_http_response(
            "application/json",
            r#"{"type":"message","content":[]}"#,
        ))
        .await;

        let error =
            super::test_llm_connection(connection_request("Anthropic-compatible", base_url))
                .await
                .expect_err("invalid Anthropic response should fail");
        request_handle.await.expect("server task should finish");

        assert!(error.contains("Anthropic 兼容接口返回了无效响应"));
    }

    #[tokio::test]
    async fn test_llm_connection_keeps_http_status_and_provider_body() {
        let body = r#"{"error":{"message":"invalid api key"}}"#;
        let response = format!(
            "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .into_bytes();
        let (base_url, request_handle) = spawn_connection_test_server(response).await;

        let error = super::test_llm_connection(connection_request("OpenAI-compatible", base_url))
            .await
            .expect_err("HTTP failure should remain visible");
        request_handle.await.expect("server task should finish");

        assert!(error.contains("401 Unauthorized"));
        assert!(error.contains("invalid api key"));
    }

    #[test]
    fn clean_json_response_extracts_json_object() {
        let input = r#"Some text before {"key": "value"} some text after"#.to_string();
        assert_eq!(clean_json_response(input), r#"{"key": "value"}"#);
    }

    #[test]
    fn clean_json_response_extracts_json_array() {
        let input = r#"Here is the result: [1, 2, 3] Done."#.to_string();
        assert_eq!(clean_json_response(input), r#"[1, 2, 3]"#);
    }

    #[test]
    fn clean_json_response_strips_json_code_block() {
        let input = r#"```json
{"key": "value"}
```"#
            .to_string();
        assert_eq!(clean_json_response(input), r#"{"key": "value"}"#);
    }

    #[test]
    fn clean_json_response_strips_plain_code_block() {
        let input = r#"```
{"key": "value"}
```"#
            .to_string();
        assert_eq!(clean_json_response(input), r#"{"key": "value"}"#);
    }

    #[test]
    fn clean_json_response_prefers_braces_over_code_block() {
        // When braces exist, they take precedence over code block stripping
        let input = r#"Text {"nested": {"a": 1}} more"#.to_string();
        assert_eq!(clean_json_response(input), r#"{"nested": {"a": 1}}"#);
    }

    #[test]
    fn clean_json_response_no_braces_fallback() {
        let input = r#"```json
plain text
```"#
            .to_string();
        assert_eq!(clean_json_response(input), "plain text");
    }

    #[test]
    fn clean_json_response_no_braces_no_code_block() {
        let input = r#"just plain text"#.to_string();
        assert_eq!(clean_json_response(input), "just plain text");
    }

    #[test]
    fn canonical_json_response_returns_parseable_json() {
        let input = r#"```json
{"sessionTitle": "归档标题", "keyEvents": "共同完成一次对话"}
```"#
            .to_string();
        let output = canonical_json_response(input).expect("valid json should be canonicalized");
        let parsed: Value = serde_json::from_str(&output).expect("output should parse");
        assert_eq!(parsed["sessionTitle"], "归档标题");
        assert_eq!(parsed["keyEvents"], "共同完成一次对话");
    }

    #[test]
    fn canonical_json_response_rejects_invalid_json() {
        let input = r#"{sessionTitle: "归档标题"}"#.to_string();
        let err = canonical_json_response(input).expect_err("invalid json should be rejected");
        assert!(err.contains("模型没有返回合法 JSON"));
    }

    #[test]
    fn canonical_json_response_eof_shows_truncation_hint() {
        let input = r##"{"worldBooks":[],"characterCards":[{"name":"A","fields":{"age":"18"}},{"name":"B","fields":{"age":""##.to_string();
        let err = canonical_json_response(input).expect_err("truncated json should be rejected");
        assert_eq!(err, "模型返回的 JSON 被截断了（输出超长）。");
    }

    #[test]
    fn parse_background_stage_one_world_book_only_ignores_character_names() {
        let input = r#"{
          "worldBooks": [{"name":"奥兰魔法大陆","fields":{"theme":"魔法冒险"}}],
          "characterNames": ["林逸"]
        }"#;

        let output = parse_background_stage_one_response(input.to_string(), false)
            .expect("stage one world-book-only response should parse");

        assert_eq!(output.world_books.len(), 1);
        assert_eq!(output.world_books[0].name, "奥兰魔法大陆");
        assert!(output.character_names.is_empty());
    }

    #[test]
    fn parse_background_stage_one_full_keeps_character_names() {
        let input = r#"{
          "worldBooks": [{"name":"奥兰魔法大陆","fields":{"theme":"魔法冒险"}}],
          "characterNames": ["林逸", "陆雪莹", "林逸", ""]
        }"#;

        let output = parse_background_stage_one_response(input.to_string(), true)
            .expect("full stage one response should parse");

        assert_eq!(output.world_books[0].name, "奥兰魔法大陆");
        assert_eq!(
            output.character_names,
            vec!["林逸".to_string(), "陆雪莹".to_string()]
        );
    }

    #[test]
    fn parse_background_character_card_accepts_single_card() {
        let input = r#"{"name":"陆雪莹","fields":{"age":"18岁","gender":"女"}}"#;

        let output = parse_background_character_card_response(input.to_string(), "陆雪莹")
            .expect("character card response should parse");

        assert_eq!(output.name, "陆雪莹");
        assert_eq!(output.fields["age"], "18岁");
    }

    #[test]
    fn parse_background_character_card_repairs_unclosed_json() {
        let input = r#"{"name":"陆雪莹","fields":{"age":"18岁","gender":"女""#;

        let output = parse_background_character_card_response(input.to_string(), "陆雪莹")
            .expect("repairable character card response should parse");

        assert_eq!(output.name, "陆雪莹");
        assert_eq!(output.fields["gender"], "女");
    }

    #[test]
    fn parse_background_character_card_repairs_inner_quotes_in_string() {
        let input = r#"{"name":"陆雪莹","fields":{"speakingStyle":"常说"别怕，我在"来安慰同伴","age":"18岁"}}"#;

        let output = parse_background_character_card_response(input.to_string(), "陆雪莹")
            .expect("inner quotes should be repaired");

        assert_eq!(output.name, "陆雪莹");
        assert!(output.fields["speakingStyle"]
            .as_str()
            .unwrap()
            .contains("别怕"));
    }

    #[test]
    fn parse_background_character_card_error_includes_raw_output() {
        let input = r#"{"name":"陆雪莹","fields":{"speakingStyle":"常说"别怕"#;

        let err = parse_background_character_card_response(input.to_string(), "陆雪莹")
            .expect_err("unrepairable response should fail with raw output");

        let parsed: Value = serde_json::from_str(&err).expect("error should be structured JSON");
        assert!(parsed["message"]
            .as_str()
            .unwrap()
            .contains("模型没有返回合法 JSON"));
        assert!(parsed["rawOutput"].as_str().unwrap().contains("陆雪莹"));
    }

    #[test]
    fn parse_background_character_card_error_keeps_provider_response_when_content_empty() {
        let input = r#"{
          "id": "chatcmpl-test",
          "choices": [
            {
              "finish_reason": "length",
              "message": { "role": "assistant", "content": null }
            }
          ]
        }"#;

        let err = parse_background_character_card_response(input.to_string(), "莱姆斯")
            .expect_err("provider envelope should fail as a character card");
        let parsed: Value = serde_json::from_str(&err).expect("error should be structured JSON");

        assert_eq!(
            parsed["message"].as_str().unwrap(),
            "模型没有返回合法 JSON，请重新分析：模型没有返回“莱姆斯”的有效角色卡名称"
        );
        assert!(parsed["rawOutput"]
            .as_str()
            .unwrap()
            .contains("chatcmpl-test"));
        assert!(parsed["rawOutput"]
            .as_str()
            .unwrap()
            .contains("finish_reason"));
    }

    #[test]
    fn parse_background_character_card_rejects_invalid_data() {
        let err = parse_background_character_card_response(
            r#"{"fields":{"age":"18岁"}}"#.to_string(),
            "陆雪莹",
        )
        .expect_err("missing name should fail");

        assert!(err.contains("角色卡"));
    }

    #[test]
    fn background_full_extraction_prompts_do_not_include_field_length_rules() {
        let (_, stage_one_prompt, _) =
            build_background_stage_one_prompts("参考正文", true, None, None, None);
        let (_, character_prompt, _) =
            build_background_character_card_prompts("参考正文", "陆雪莹", None, None, None, None);

        assert!(!stage_one_prompt.contains("50–100"));
        assert!(!stage_one_prompt.contains("字以内"));
        assert!(!character_prompt.contains("50–100"));
        assert!(!character_prompt.contains("字以内"));
    }

    #[test]
    fn background_prompts_use_custom_system_prompt_and_model_limits() {
        let (system_prompt, user_prompt, max_tokens) = build_background_stage_one_prompts(
            "一二三四五六七八九十",
            true,
            Some("自定义世界书系统提示词"),
            Some(1234),
            Some(1),
        );

        assert_eq!(system_prompt, "自定义世界书系统提示词");
        assert_eq!(max_tokens, 1234);
        assert!(user_prompt.contains("一二三四"));
        assert!(!user_prompt.contains("五六七八九十"));

        let (character_system_prompt, _, character_max_tokens) =
            build_background_character_card_prompts(
                "参考正文",
                "陆雪莹",
                None,
                Some("自定义角色卡系统提示词"),
                Some(2345),
                None,
            );
        assert_eq!(character_system_prompt, "自定义角色卡系统提示词");
        assert_eq!(character_max_tokens, 2345);
    }

    #[test]
    fn background_openai_body_disables_thinking_when_depth_is_off() {
        let body = build_openai_background_body(
            "model",
            "系统提示词",
            "用户提示词",
            8192,
            0.0,
            Some("off"),
        );

        assert_eq!(body["enable_thinking"], Value::Bool(false));
        assert!(body.get("reasoning_effort").is_none());
    }

    #[test]
    fn background_openai_body_enables_reasoning_effort_when_depth_is_set() {
        let body = build_openai_background_body(
            "model",
            "系统提示词",
            "用户提示词",
            8192,
            0.0,
            Some("medium"),
        );

        assert_eq!(body["enable_thinking"], Value::Bool(true));
        assert_eq!(
            body["reasoning_effort"],
            Value::String("medium".to_string())
        );
    }

    #[test]
    fn reverse_outline_openai_body_disables_thinking_when_depth_is_off() {
        let body = build_openai_reverse_outline_body(
            "model",
            "系统提示词",
            "用户提示词",
            4096,
            0.3,
            Some("off"),
            false,
        );

        assert_eq!(body["enable_thinking"], Value::Bool(false));
        assert!(body.get("reasoning_effort").is_none());
    }

    #[test]
    fn reverse_outline_openai_body_enables_reasoning_effort_when_depth_is_set() {
        let body = build_openai_reverse_outline_body(
            "model",
            "系统提示词",
            "用户提示词",
            4096,
            0.3,
            Some("high"),
            false,
        );

        assert_eq!(body["enable_thinking"], Value::Bool(true));
        assert_eq!(body["reasoning_effort"], Value::String("high".to_string()));
    }

    #[test]
    fn analyze_memory_prompt_scopes_updates_to_target_character() {
        let request = AnalyzeMemoryRequest {
            model_interface: "OpenAI".to_string(),
            base_url: "http://localhost".to_string(),
            api_key: "key".to_string(),
            model: "model".to_string(),
            temperature: Some(0.7),
            max_output_tokens: Some(4096),
            thinking_depth: Some("off".to_string()),
            chat_history: "我: 你好\n\n角色B: 我会保护你".to_string(),
            target_character_name: Some("角色A".to_string()),
            target_character_content: Some("# 角色卡：角色A".to_string()),
            current_user_relation_type: "朋友".to_string(),
            current_user_interaction_model: "互相信任".to_string(),
            current_user_relation_bottom_line: "保持坦诚".to_string(),
            current_events: "暂无".to_string(),
            system_prompt: None,
        };

        let prompt = build_analyze_memory_user_prompt(&request);

        assert!(prompt.contains("目标角色**：角色A"));
        assert!(prompt.contains("只分析并输出“目标角色”与用户之间的关系"));
        assert!(prompt.contains("严禁把其他角色与用户的关系"));
        assert!(prompt.contains("\"userRelationType\" 不要超过50字"));
        assert!(prompt
            .contains("\"userInteractionModel\" 和 \"userRelationBottomLine\" 各不要超过100字"));
        assert!(prompt
            .contains("\"keyEvents\" 必须保留原有关键事件内容，只能在原本基础上最多增加100字"));
        assert!(prompt.contains("新增部分前面必须空一行"));
        assert!(prompt.contains("【事件名】事件详情"));
    }

    fn reverse_doc(title: &str, content: &str) -> ReverseOutlineSourceDoc {
        ReverseOutlineSourceDoc {
            title: title.to_string(),
            path: PathBuf::from(format!("/tmp/{}.md", title)),
            content: content.to_string(),
            char_count: reverse_outline_char_count(content),
        }
    }

    #[test]
    fn reverse_outline_sources_sort_and_filter_text_files() {
        let root = temp_museai_dir("reverse_sources");
        let articles = root.join("articles");
        let references = root.join("references");
        fs::create_dir_all(&articles).expect("create articles");
        fs::create_dir_all(&references).expect("create references");
        let alpha = articles.join("b章.md");
        let beta = references.join("A章.txt");
        let image = articles.join("图.png");
        fs::write(&alpha, "正文B").expect("write alpha");
        fs::write(&beta, "正文A").expect("write beta");
        fs::write(&image, "image").expect("write image");
        let canonical_articles = articles.canonicalize().expect("canonical articles");
        let canonical_references = references.canonicalize().expect("canonical refs");

        let docs = resolve_reverse_outline_sources(
            &[
                alpha.to_string_lossy().into_owned(),
                beta.to_string_lossy().into_owned(),
            ],
            &canonical_articles,
            &canonical_references,
        )
        .expect("resolve text docs");

        assert_eq!(
            docs.iter()
                .map(|doc| doc.title.as_str())
                .collect::<Vec<_>>(),
            vec!["A章", "b章"]
        );
        assert_eq!(docs[0].char_count, 3);

        let nested = references.join("合集");
        fs::create_dir_all(&nested).expect("create nested");
        fs::write(nested.join("002_第二章.md"), "第二章").expect("write nested second");
        fs::write(nested.join("001_第一章.txt"), "第一章").expect("write nested first");
        fs::write(nested.join(".隐藏.md"), "隐藏").expect("write hidden");
        fs::write(nested.join("封面.png"), "image").expect("write nested image");

        let nested_docs = resolve_reverse_outline_sources(
            &[nested.to_string_lossy().into_owned()],
            &canonical_articles,
            &canonical_references,
        )
        .expect("resolve nested directory");
        assert_eq!(
            nested_docs
                .iter()
                .map(|doc| doc.title.as_str())
                .collect::<Vec<_>>(),
            vec!["001_第一章", "002_第二章"]
        );

        let err = resolve_reverse_outline_sources(
            &[image.to_string_lossy().into_owned()],
            &canonical_articles,
            &canonical_references,
        )
        .expect_err("image should be rejected");
        assert!(err.contains("Markdown 或 TXT"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn short_reverse_outline_text_enforces_limit_and_concatenates_titles() {
        let docs = vec![reverse_doc("B", "第二篇"), reverse_doc("A", "第一篇")];
        let text = build_short_reverse_outline_text(&docs).expect("short text");
        assert!(text.contains("# B\n\n第二篇"));
        assert!(text.contains("# A\n\n第一篇"));

        let too_long = vec![reverse_doc("长文", &"字".repeat(50_001))];
        let err = build_short_reverse_outline_text(&too_long).expect_err("too long");
        assert!(err.contains("5万字"));
    }

    #[test]
    fn short_reverse_outline_prompt_uses_custom_system_prompt() {
        let (default_prompt, _) = short_reverse_outline_prompt("参考正文", None);
        assert!(default_prompt.contains("完整短篇文本"));

        let (custom_prompt, user_prompt) =
            short_reverse_outline_prompt("参考正文", Some("自定义短篇提示词"));
        assert_eq!(custom_prompt, "自定义短篇提示词");
        assert!(user_prompt.contains("参考正文"));
    }

    #[test]
    fn long_reverse_outline_segments_split_over_5000_chars() {
        let docs = vec![
            reverse_doc("短章", "短正文"),
            reverse_doc("长章", &"长".repeat(10_001)),
        ];

        let segments = build_long_reverse_outline_segments(&docs);

        assert_eq!(segments.len(), 4);
        assert_eq!(segments[0].title, "短章");
        assert_eq!(segments[1].title, "长章（第1段）");
        assert_eq!(segments[1].content.chars().count(), 5_000);
        assert_eq!(segments[3].content.chars().count(), 1);
    }

    #[test]
    fn long_reverse_outline_batches_use_ten_segments() {
        let segments = (0..21)
            .map(|index| ReverseOutlineSegment {
                title: format!("第{}段", index + 1),
                content: "正文".to_string(),
            })
            .collect::<Vec<_>>();

        let batches = build_long_reverse_outline_batches(&segments);

        assert_eq!(batches.len(), 3);
        assert_eq!(batches[0].range, "1-10");
        assert_eq!(batches[1].range, "11-20");
        assert_eq!(batches[2].range, "21-21");
    }

    #[test]
    fn long_summary_prompt_uses_custom_system_prompt() {
        let batch = ReverseOutlineSummaryBatch {
            index: 0,
            range: "1-1".to_string(),
            items: vec![ReverseOutlineSegment {
                title: "第一段".to_string(),
                content: "正文".to_string(),
            }],
        };

        let (default_prompt, _) = long_summary_prompt(&batch, None).unwrap();
        assert!(default_prompt.contains("剧情摘要助手"));

        let (custom_prompt, _) = long_summary_prompt(&batch, Some("自定义摘要提示词")).unwrap();
        assert_eq!(custom_prompt, "自定义摘要提示词");
    }

    #[test]
    fn reverse_outline_send_error_includes_interface_and_endpoint() {
        let client = reqwest::Client::new();
        let error = client
            .get("http://[::1")
            .build()
            .expect_err("invalid url should fail");
        let message = format_reverse_outline_send_error(
            "Anthropic",
            "https://api.kimi.com/coding/v1/messages",
            &error,
        );

        assert!(message.contains("Anthropic接口请求发送失败"));
        assert!(message.contains("https://api.kimi.com/coding/v1/messages"));
        assert!(message.contains("接口类型、API 地址、模型是否匹配"));
    }

    #[test]
    fn reverse_outline_save_sanitizes_and_deduplicates_titles() {
        let root = temp_museai_dir("reverse_save");
        fs::create_dir_all(&root).expect("create root");

        let first = save_reverse_outline_for_root(&root, "坏/标题?", "正文").expect("first save");
        let second =
            save_reverse_outline_for_root(&root, "坏/标题?", "正文2").expect("second save");

        assert_eq!(first.file_name().unwrap().to_string_lossy(), "坏 标题.md");
        assert_eq!(
            second.file_name().unwrap().to_string_lossy(),
            "坏 标题 2.md"
        );
        assert!(fs::read_to_string(first).unwrap().contains("正文"));
        let err = save_reverse_outline_for_root(&root, "空", "   ").expect_err("empty content");
        assert!(err.contains("大纲内容"));
        assert!(sanitize_reverse_outline_title(" / ").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn long_final_prompt_uses_custom_system_prompt() {
        let summaries = vec![serde_json::json!({"段落序号": "1-10", "剧情概要": "测试"})];
        let (default_prompt, _) = long_final_prompt(&summaries, None).unwrap();
        assert!(default_prompt.contains("长篇小说结构分析专家"));

        let (custom_prompt, _) = long_final_prompt(&summaries, Some("自定义提示词")).unwrap();
        assert_eq!(custom_prompt, "自定义提示词");
    }
}
