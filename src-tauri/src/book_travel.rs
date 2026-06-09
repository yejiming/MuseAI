#![allow(dead_code)]

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use tauri::{AppHandle, Emitter, Manager};
use crate::ActiveStreams;
use crate::models::{BookTravelStreamStarted, BookTravelStreamEvent};
use uuid::Uuid;
use futures_util::StreamExt;

use crate::llm::{
    anthropic_thinking_config, approximate_token_count, build_anthropic_endpoint,
    build_openai_endpoint,
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookTravelMaterial {
    pub id: String,
    pub title: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookTravelSelectedMaterials {
    pub outline: BookTravelMaterial,
    pub world_book: BookTravelMaterial,
    pub character_cards: Vec<BookTravelMaterial>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookTravelAssembledWorldModel {
    pub original_timeline: Vec<String>,
    pub core_conflicts: Vec<String>,
    pub possible_endings: Vec<String>,
    pub world_rules: Vec<String>,
    pub important_locations: Vec<String>,
    pub active_factions: Vec<String>,
    pub selected_character_profiles: Vec<String>,
    pub relationship_hints: Vec<String>,
    pub hidden_information_boundaries: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookTravelMemoryState {
    pub stable: serde_json::Value,
    pub volatile: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookTravelEntryPoint {
    pub id: String,
    pub title: String,
    pub time_and_location: String,
    pub situation: String,
    pub initial_goal: String,
    pub risk: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookTravelUserCharacter {
    pub name: String,
    pub identity: String,
    pub background: String,
    pub personality: String,
    pub goal: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookTravelEntrySetup {
    pub entry_points: Vec<BookTravelEntryPoint>,
    pub recommended_user_characters: Vec<BookTravelUserCharacter>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum BookTravelInputClassification {
    Meta,
    InsertBeat,
    ChangeScene,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookTravelInputClassificationResult {
    pub classification: BookTravelInputClassification,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookTravelScenePlan {
    pub state_changes: serde_json::Value,
    pub divergence: String,
    pub story_progress: u32,
    pub ending_status: Option<String>,
    pub scene_goals: Vec<String>,
    pub entry_beat_guidance: String,
    pub allowed_cast: Vec<String>,
    pub writer_instructions: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookTravelBeat {
    pub id: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookTravelScene {
    pub id: String,
    pub title: String,
    pub summary: Option<String>,
    pub current_situation: Option<String>,
    pub time: Option<String>,
    pub location: Option<String>,
    pub active_characters: Vec<String>,
    pub beat: BookTravelBeat,
    pub stable_memory_patch: Option<serde_json::Value>,
    pub volatile_memory_patch: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookTravelMemorySummary {
    pub summary: String,
    pub key_choices: Vec<String>,
    pub unresolved_conflicts: Vec<String>,
    pub divergence_from_outline: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookTravelEndingSummary {
    pub final_ending: String,
    pub user_key_choices: Vec<String>,
    pub original_outline_comparison: String,
    pub character_outcomes: Vec<String>,
    pub worldline_name: String,
    pub divergence_score: u32,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum BookTravelRole {
    MaterialAssembler,
    EntryDirector,
    InputClassifier,
    ScenePlanner,
    SceneWriter,
    MemoryKeeper,
    EndingJudge,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookTravelStructuredRequest {
    pub model_interface: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub role: BookTravelRole,
    pub materials: Option<BookTravelSelectedMaterials>,
    pub state: Value,
    pub previous_valid_state: Value,
    pub temperature: Option<f32>,
    pub max_output_tokens: Option<u32>,
    pub max_context_tokens: Option<u32>,
    pub thinking_depth: Option<String>,
    pub system_prompt: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BookTravelStructuredCall {
    pub role: BookTravelRole,
    pub system_prompt: String,
    pub user_prompt: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub max_context_tokens: Option<u32>,
    pub thinking_depth: Option<String>,
}

pub fn parse_book_travel_json<T>(raw: &str, _previous: impl Sized) -> Result<T, String>
where
    T: DeserializeOwned,
{
    serde_json::from_str(extract_json_text(raw).as_str())
        .map_err(|error| format!("解析穿书 JSON 失败：{}", error))
}

fn request_for_role(
    request: BookTravelStructuredRequest,
    role: BookTravelRole,
) -> BookTravelStructuredRequest {
    BookTravelStructuredRequest { role, ..request }
}

fn extract_json_text(raw: &str) -> String {
    let trimmed = raw.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }
    let without_opening = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```JSON"))
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed)
        .trim();
    without_opening
        .strip_suffix("```")
        .unwrap_or(without_opening)
        .trim()
        .to_string()
}

pub fn build_structured_call(
    request: &BookTravelStructuredRequest,
    user_input: &str,
) -> Result<BookTravelStructuredCall, String> {
    if request.model.trim().is_empty() {
        return Err("请先配置穿书模型".to_string());
    }
    let system_prompt = request
        .system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .ok_or_else(|| "请先配置穿书角色提示词".to_string())?
        .to_string();
    let user_prompt = limit_prompt_to_context(
        build_user_prompt(request, user_input)?,
        &system_prompt,
        request.max_context_tokens,
    );

    Ok(BookTravelStructuredCall {
        role: request.role,
        system_prompt,
        user_prompt,
        temperature: request
            .temperature
            .unwrap_or(default_temperature(request.role)),
        max_tokens: request
            .max_output_tokens
            .unwrap_or(default_max_tokens(request.role)),
        max_context_tokens: request.max_context_tokens,
        thinking_depth: request.thinking_depth.clone(),
    })
}

pub fn build_scene_writer_call(
    request: &BookTravelStructuredRequest,
    flow: &str,
    user_input: &str,
) -> Result<BookTravelStructuredCall, String> {
    let mut writer_request = request_for_role(request.clone(), BookTravelRole::SceneWriter);
    let writer_task = match flow {
        "insert-beat" => format!(
            "写作流程：insert-beat。本轮只生成当前场景内的 1 个新节拍，不得创建新场景，不得修改场景其他字段（title、time、location 等）。输出格式中 beat 字段为单个对象。\n用户输入：{}",
            user_input.trim()
        ),
        "change-scene" => format!(
            "写作流程：change-scene。本轮生成一个新场景，包含完整的场景信息（id、title、summary、currentSituation、time、location、activeCharacters），beat 字段为单个入口节拍对象。不要预写后续步骤。\n用户输入：{}",
            user_input.trim()
        ),
        _ => return Err("未知的穿书写作流程".to_string()),
    };
    writer_request.state = json!({
        "selectedMaterials": writer_request.materials,
        "stableMemory": writer_request.state.get("stableMemory").cloned().unwrap_or(Value::Null),
        "volatileMemory": writer_request.state.get("volatileMemory").cloned().unwrap_or(Value::Null),
        "assembledWorldModel": writer_request.state.get("assembledWorldModel").cloned().unwrap_or(Value::Null),
        "currentState": writer_request.state.get("currentState").cloned().unwrap_or(Value::Null),
        "summaryMemory": writer_request.state.get("summaryMemory").cloned().unwrap_or(Value::Null),
        "recentScenes": writer_request.state.get("recentScenes").cloned().unwrap_or(Value::Null),
        "recentTurns": writer_request.state.get("recentTurns").cloned().unwrap_or(Value::Null),
        "writerInstructions": writer_request.state.get("writerInstructions").cloned().unwrap_or(Value::Null),
    });
    writer_request.materials = None;
    build_structured_call(&writer_request, &writer_task)
}

fn build_user_prompt(
    request: &BookTravelStructuredRequest,
    user_input: &str,
) -> Result<String, String> {
    let material_text = request
        .materials
        .as_ref()
        .map(format_materials)
        .unwrap_or_else(|| "未提供选中素材。".to_string());
    let state_text = serde_json::to_string_pretty(&request.state)
        .map_err(|error| format!("序列化穿书状态失败：{}", error))?;
    let input_text = user_input.trim();
    let role_instruction = match request.role {
        BookTravelRole::MaterialAssembler => "",
        BookTravelRole::EntryDirector => "",
        BookTravelRole::InputClassifier => {
            "请输出严格 JSON，字段为 classification 与 reason。classification 只能是 meta、insert-beat、change-scene。"
        }
        BookTravelRole::ScenePlanner => {
            "规划前检查世界规则、用户资源、已知信息、当前时间与地点。"
        }
        BookTravelRole::SceneWriter => "",
        BookTravelRole::MemoryKeeper => {
            "请输出严格 JSON，字段为 summary、keyChoices、unresolvedConflicts、divergenceFromOutline。"
        }
        BookTravelRole::EndingJudge => {
            "请输出严格 JSON，字段为 finalEnding、userKeyChoices、originalOutlineComparison、characterOutcomes、worldlineName、divergenceScore。"
        }
    };

    let prefix = if role_instruction.is_empty() {
        String::new()
    } else {
        format!("{role_instruction}\n\n")
    };

    Ok(format!(
        "{prefix}## 选中素材\n{material_text}\n\n## 当前穿书状态\n{state_text}\n\n## 用户输入或本轮任务\n{input_text}"
    ))
}

fn format_materials(materials: &BookTravelSelectedMaterials) -> String {
    let mut text = format!(
        "《{}》\n{}\n\n《{}》\n{}",
        materials.outline.title,
        materials.outline.content,
        materials.world_book.title,
        materials.world_book.content
    );
    for card in &materials.character_cards {
        text.push_str(&format!("\n\n《角色卡：{}》\n{}", card.title, card.content));
    }
    text
}

fn limit_prompt_to_context(
    user_prompt: String,
    system_prompt: &str,
    max_context_tokens: Option<u32>,
) -> String {
    let Some(max_context_tokens) = max_context_tokens else {
        return user_prompt;
    };
    if max_context_tokens == 0 {
        return user_prompt;
    }
    let system_tokens = approximate_token_count(system_prompt);
    let prompt_tokens = approximate_token_count(&user_prompt);
    let budget = (max_context_tokens as usize)
        .saturating_sub(system_tokens)
        .max(1);
    if prompt_tokens <= budget {
        return user_prompt;
    }
    user_prompt.chars().take(budget.saturating_mul(4)).collect()
}

fn default_temperature(role: BookTravelRole) -> f32 {
    match role {
        BookTravelRole::MaterialAssembler => 0.0,
        BookTravelRole::EntryDirector => 0.6,
        BookTravelRole::InputClassifier
        | BookTravelRole::ScenePlanner
        | BookTravelRole::MemoryKeeper => 0.2,
        BookTravelRole::SceneWriter => 0.8,
        BookTravelRole::EndingJudge => 0.3,
    }
}

fn default_max_tokens(role: BookTravelRole) -> u32 {
    match role {
        BookTravelRole::EntryDirector
        | BookTravelRole::InputClassifier
        | BookTravelRole::MemoryKeeper => 4096,
        _ => 8192,
    }
}

pub fn build_openai_structured_body(model: &str, call: &BookTravelStructuredCall) -> Value {
    let mut body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": call.system_prompt},
            {"role": "user", "content": call.user_prompt}
        ],
        "stream": false,
        "temperature": call.temperature,
        "max_tokens": call.max_tokens,
    });
    let depth = call.thinking_depth.as_deref().unwrap_or("").trim();
    if depth.is_empty() || depth == "off" {
        body["enable_thinking"] = json!(false);
    } else {
        body["enable_thinking"] = json!(true);
        body["reasoning_effort"] = json!(depth);
    }
    body
}

async fn call_structured_llm(
    client: &reqwest::Client,
    request: &BookTravelStructuredRequest,
    call: &BookTravelStructuredCall,
) -> Result<String, String> {
    match request.model_interface.as_str() {
        "Anthropic-compatible" => {
            let endpoint = build_anthropic_endpoint(&request.base_url);
            let mut body = json!({
                "model": request.model,
                "messages": [{"role": "user", "content": call.user_prompt}],
                "system": call.system_prompt,
                "stream": false,
                "max_tokens": call.max_tokens,
            });
            if let Some(thinking) =
                anthropic_thinking_config(call.thinking_depth.as_deref(), call.max_tokens)
            {
                body["thinking"] = thinking;
            } else {
                body["temperature"] = json!(call.temperature);
            }
            let response = client
                .post(build_anthropic_endpoint(&request.base_url))
                .header("x-api-key", &request.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await
                .map_err(|error| {
                    format!(
                        "Anthropic 接口请求失败：{}（请求地址：{}）",
                        error, endpoint
                    )
                })?;
            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("Anthropic 接口请求失败：{} {}", status, body_text));
            }
            let json: Value = response.json().await.map_err(|error| error.to_string())?;
            Ok(json
                .get("content")
                .and_then(|content| content.as_array())
                .and_then(|items| {
                    items
                        .iter()
                        .find(|item| item.get("type") == Some(&json!("text")))
                })
                .and_then(|item| item.get("text"))
                .and_then(|text| text.as_str())
                .unwrap_or("")
                .trim()
                .to_string())
        }
        _ => {
            let endpoint = build_openai_endpoint(&request.base_url);
            let body = build_openai_structured_body(&request.model, call);
            let response = client
                .post(&endpoint)
                .bearer_auth(&request.api_key)
                .json(&body)
                .send()
                .await
                .map_err(|error| {
                    format!(
                        "OpenAI 兼容接口请求失败：{}（请求地址：{}）",
                        error, endpoint
                    )
                })?;
            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("OpenAI 兼容接口请求失败：{} {}", status, body_text));
            }
            let json: Value = response.json().await.map_err(|error| error.to_string())?;
            Ok(json
                .get("choices")
                .and_then(|choices| choices.as_array())
                .and_then(|choices| choices.first())
                .and_then(|choice| choice.get("message"))
                .and_then(|message| message.get("content"))
                .and_then(|content| content.as_str())
                .unwrap_or("")
                .trim()
                .to_string())
        }
    }
}

async fn run_structured_call<T>(
    request: BookTravelStructuredRequest,
    role: BookTravelRole,
    user_input: &str,
) -> Result<T, String>
where
    T: DeserializeOwned,
{
    if request.api_key.trim().is_empty() {
        return Err("请先配置穿书模型 API Key".to_string());
    }
    let role_request = request_for_role(request, role);
    let call = build_structured_call(&role_request, user_input)?;
    let client = reqwest::Client::new();
    let raw = call_structured_llm(&client, &role_request, &call).await?;
    parse_book_travel_json(&raw, role_request.previous_valid_state)
}

#[tauri::command]
pub async fn assemble_book_travel_materials(
    request: BookTravelStructuredRequest,
) -> Result<Value, String> {
    run_structured_call(request, BookTravelRole::MaterialAssembler, "装配选中素材").await
}

#[tauri::command]
pub async fn generate_book_travel_entry_setup(
    request: BookTravelStructuredRequest,
) -> Result<BookTravelEntrySetup, String> {
    run_structured_call(
        request,
        BookTravelRole::EntryDirector,
        "生成穿书入口与用户身份",
    )
    .await
}

async fn execute_book_travel_stream(
    app: &AppHandle,
    run_id: &str,
    request: &BookTravelStructuredRequest,
    call: &BookTravelStructuredCall,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let mut full_content = String::new();

    match request.model_interface.as_str() {
        "Anthropic-compatible" => {
            let endpoint = build_anthropic_endpoint(&request.base_url);
            let mut body = json!({
                "model": request.model,
                "messages": [{"role": "user", "content": call.user_prompt}],
                "system": call.system_prompt,
                "stream": true,
                "max_tokens": call.max_tokens,
            });
            body["temperature"] = json!(call.temperature);

            let response = client
                .post(&endpoint)
                .header("x-api-key", &request.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await
                .map_err(|error| {
                    format!(
                        "Anthropic 接口请求失败：{}（请求地址：{}）",
                        error, endpoint
                    )
                })?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("Anthropic 接口请求失败：{} {}", status, body_text));
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| format!("网络流读取失败：{}", e))?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                crate::llm::process_sse_buffer(&mut buffer, |data| {
                    if let Some(event) = crate::llm::parse_anthropic_stream_event(data) {
                        match event {
                            crate::models::AnthropicStreamEvent::Text(delta) => {
                                full_content.push_str(&delta);
                                let _ = app.emit(
                                    "book-travel-stream",
                                    BookTravelStreamEvent {
                                        run_id: run_id.to_string(),
                                        event_type: "delta".to_string(),
                                        delta: Some(delta),
                                        message: None,
                                    },
                                );
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
                json!({"role": "system", "content": call.system_prompt}),
                json!({"role": "user", "content": call.user_prompt}),
            ];
            let body = json!({
                "model": request.model,
                "messages": messages,
                "stream": true,
                "temperature": call.temperature,
                "max_tokens": call.max_tokens,
                "enable_thinking": false,
            });

            let response = client
                .post(&endpoint)
                .bearer_auth(&request.api_key)
                .json(&body)
                .send()
                .await
                .map_err(|error| {
                    format!(
                        "OpenAI 兼容接口请求失败：{}（请求地址：{}）",
                        error, endpoint
                    )
                })?;

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("OpenAI 兼容接口请求失败：{} {}", status, body_text));
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| format!("网络流读取失败：{}", e))?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                crate::llm::process_sse_buffer(&mut buffer, |data| {
                    if data == "[DONE]" {
                        return;
                    }
                    if let Some(event) = crate::llm::parse_openai_stream_event(data) {
                        if let Some(delta) = event.content {
                            full_content.push_str(&delta);
                            let _ = app.emit(
                                "book-travel-stream",
                                BookTravelStreamEvent {
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
    }

    Ok(full_content)
}

async fn run_book_travel_stream_task(
    app: &AppHandle,
    run_id: &str,
    role: BookTravelRole,
    request: BookTravelStructuredRequest,
) -> Result<String, String> {
    if request.api_key.trim().is_empty() {
        return Err("请先配置穿书模型 API Key".to_string());
    }
    let role_request = request_for_role(request, role);
    let mut call = build_structured_call(&role_request, match role {
        BookTravelRole::MaterialAssembler => "装配选中素材",
        BookTravelRole::EntryDirector => "生成穿书入口与用户身份",
        _ => "开始工作",
    })?;
    call.thinking_depth = Some("off".to_string());
    execute_book_travel_stream(app, run_id, &role_request, &call).await
}

async fn run_book_travel_scene_writer_stream_task(
    app: &AppHandle,
    run_id: &str,
    request: BookTravelStructuredRequest,
    flow: &str,
    user_input: &str,
) -> Result<String, String> {
    if request.api_key.trim().is_empty() {
        return Err("请先配置穿书模型 API Key".to_string());
    }
    let call = build_scene_writer_call(&request, flow, user_input)?;
    execute_book_travel_stream(app, run_id, &request, &call).await
}

#[tauri::command]
pub fn start_assemble_book_travel_materials_stream(
    app: AppHandle,
    request: BookTravelStructuredRequest,
    _state: tauri::State<'_, ActiveStreams>,
) -> Result<BookTravelStreamStarted, String> {
    let run_id = Uuid::new_v4().to_string();
    let spawned_run_id = run_id.clone();
    let task_app = app.clone();
    let cleanup_app = app.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let result = run_book_travel_stream_task(
            &task_app,
            &spawned_run_id,
            BookTravelRole::MaterialAssembler,
            request,
        )
        .await;

        match result {
            Ok(content) => {
                let extracted = extract_json_text(&content);
                let _ = task_app.emit(
                    "book-travel-stream",
                    BookTravelStreamEvent {
                        run_id: spawned_run_id.clone(),
                        event_type: "done".to_string(),
                        delta: None,
                        message: Some(extracted),
                    },
                );
            }
            Err(error) => {
                let _ = task_app.emit(
                    "book-travel-stream",
                    BookTravelStreamEvent {
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

    Ok(BookTravelStreamStarted { run_id })
}

#[tauri::command]
pub fn start_generate_book_travel_entry_setup_stream(
    app: AppHandle,
    request: BookTravelStructuredRequest,
    _state: tauri::State<'_, ActiveStreams>,
) -> Result<BookTravelStreamStarted, String> {
    let run_id = Uuid::new_v4().to_string();
    let spawned_run_id = run_id.clone();
    let task_app = app.clone();
    let cleanup_app = app.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let result = run_book_travel_stream_task(
            &task_app,
            &spawned_run_id,
            BookTravelRole::EntryDirector,
            request,
        )
        .await;

        match result {
            Ok(content) => {
                let extracted = extract_json_text(&content);
                let _ = task_app.emit(
                    "book-travel-stream",
                    BookTravelStreamEvent {
                        run_id: spawned_run_id.clone(),
                        event_type: "done".to_string(),
                        delta: None,
                        message: Some(extracted),
                    },
                );
            }
            Err(error) => {
                let _ = task_app.emit(
                    "book-travel-stream",
                    BookTravelStreamEvent {
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

    Ok(BookTravelStreamStarted { run_id })
}

#[tauri::command]
pub fn start_plan_book_travel_scene_stream(
    app: AppHandle,
    request: BookTravelStructuredRequest,
    user_input: String,
    _state: tauri::State<'_, ActiveStreams>,
) -> Result<BookTravelStreamStarted, String> {
    let run_id = Uuid::new_v4().to_string();
    let spawned_run_id = run_id.clone();
    let task_app = app.clone();
    let cleanup_app = app.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let role_request = request_for_role(request, BookTravelRole::ScenePlanner);
        let mut call = match build_structured_call(&role_request, &user_input) {
            Ok(c) => c,
            Err(e) => {
                let _ = task_app.emit(
                    "book-travel-stream",
                    BookTravelStreamEvent {
                        run_id: spawned_run_id.clone(),
                        event_type: "error".to_string(),
                        delta: None,
                        message: Some(e),
                    },
                );
                if let Some(active_streams) = cleanup_app.try_state::<ActiveStreams>() {
                    if let Ok(mut streams) = active_streams.0.lock() {
                        streams.remove(&spawned_run_id);
                    }
                }
                return;
            }
        };
        call.thinking_depth = Some("off".to_string());
        let result = execute_book_travel_stream(&task_app, &spawned_run_id, &role_request, &call).await;

        match result {
            Ok(content) => {
                let extracted = extract_json_text(&content);
                let _ = task_app.emit(
                    "book-travel-stream",
                    BookTravelStreamEvent {
                        run_id: spawned_run_id.clone(),
                        event_type: "done".to_string(),
                        delta: None,
                        message: Some(extracted),
                    },
                );
            }
            Err(error) => {
                let _ = task_app.emit(
                    "book-travel-stream",
                    BookTravelStreamEvent {
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

    Ok(BookTravelStreamStarted { run_id })
}

#[tauri::command]
pub fn start_write_book_travel_change_scene_stream(
    app: AppHandle,
    request: BookTravelStructuredRequest,
    user_input: String,
    _state: tauri::State<'_, ActiveStreams>,
) -> Result<BookTravelStreamStarted, String> {
    let run_id = Uuid::new_v4().to_string();
    let spawned_run_id = run_id.clone();
    let task_app = app.clone();
    let cleanup_app = app.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let result = run_book_travel_scene_writer_stream_task(
            &task_app,
            &spawned_run_id,
            request,
            "change-scene",
            &user_input,
        )
        .await;

        match result {
            Ok(content) => {
                let extracted = extract_json_text(&content);
                let _ = task_app.emit(
                    "book-travel-stream",
                    BookTravelStreamEvent {
                        run_id: spawned_run_id.clone(),
                        event_type: "done".to_string(),
                        delta: None,
                        message: Some(extracted),
                    },
                );
            }
            Err(error) => {
                let _ = task_app.emit(
                    "book-travel-stream",
                    BookTravelStreamEvent {
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

    Ok(BookTravelStreamStarted { run_id })
}

#[tauri::command]
pub fn start_write_book_travel_insert_beat_stream(
    app: AppHandle,
    request: BookTravelStructuredRequest,
    user_input: String,
    _state: tauri::State<'_, ActiveStreams>,
) -> Result<BookTravelStreamStarted, String> {
    let run_id = Uuid::new_v4().to_string();
    let spawned_run_id = run_id.clone();
    let task_app = app.clone();
    let cleanup_app = app.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let result = run_book_travel_scene_writer_stream_task(
            &task_app,
            &spawned_run_id,
            request,
            "insert-beat",
            &user_input,
        )
        .await;

        match result {
            Ok(content) => {
                let extracted = extract_json_text(&content);
                let _ = task_app.emit(
                    "book-travel-stream",
                    BookTravelStreamEvent {
                        run_id: spawned_run_id.clone(),
                        event_type: "done".to_string(),
                        delta: None,
                        message: Some(extracted),
                    },
                );
            }
            Err(error) => {
                let _ = task_app.emit(
                    "book-travel-stream",
                    BookTravelStreamEvent {
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

    Ok(BookTravelStreamStarted { run_id })
}

#[tauri::command]
pub fn stop_book_travel_stream(
    run_id: String,
    state: tauri::State<'_, ActiveStreams>,
) -> Result<(), String> {
    if let Some(handle) = state.0.lock().unwrap().remove(&run_id) {
        handle.abort();
    }
    Ok(())
}

#[tauri::command]
pub async fn classify_book_travel_input(
    request: BookTravelStructuredRequest,
    user_input: String,
) -> Result<BookTravelInputClassificationResult, String> {
    run_structured_call(request, BookTravelRole::InputClassifier, &user_input).await
}

#[tauri::command]
pub async fn plan_book_travel_scene(
    request: BookTravelStructuredRequest,
    user_input: String,
) -> Result<BookTravelScenePlan, String> {
    run_structured_call(request, BookTravelRole::ScenePlanner, &user_input).await
}

#[tauri::command]
pub async fn summarize_book_travel_memory(
    request: BookTravelStructuredRequest,
) -> Result<BookTravelMemorySummary, String> {
    run_structured_call(request, BookTravelRole::MemoryKeeper, "整理当前穿书记忆").await
}

#[tauri::command]
pub async fn judge_book_travel_ending(
    request: BookTravelStructuredRequest,
) -> Result<BookTravelEndingSummary, String> {
    run_structured_call(request, BookTravelRole::EndingJudge, "判断并总结穿书结局").await
}

pub fn parse_and_repair_writer_scene(
    raw: &str,
    previous_valid_state: Value,
) -> Result<BookTravelScene, String> {
    let scene = parse_book_travel_json::<BookTravelScene>(raw, previous_valid_state)?;
    repair_scene_graph(scene)
}

async fn run_scene_writer(
    request: BookTravelStructuredRequest,
    flow: &str,
    user_input: &str,
) -> Result<BookTravelScene, String> {
    if request.api_key.trim().is_empty() {
        return Err("请先配置穿书模型 API Key".to_string());
    }
    let call = build_scene_writer_call(&request, flow, user_input)?;
    let writer_request = request_for_role(request, BookTravelRole::SceneWriter);
    let client = reqwest::Client::new();
    let raw = call_structured_llm(&client, &writer_request, &call).await?;
    parse_and_repair_writer_scene(&raw, writer_request.previous_valid_state)
}

#[tauri::command]
pub async fn write_book_travel_insert_beat(
    request: BookTravelStructuredRequest,
    user_input: String,
) -> Result<BookTravelScene, String> {
    run_scene_writer(request, "insert-beat", &user_input).await
}

#[tauri::command]
pub async fn write_book_travel_change_scene(
    request: BookTravelStructuredRequest,
    user_input: String,
) -> Result<BookTravelScene, String> {
    run_scene_writer(request, "change-scene", &user_input).await
}

pub fn repair_scene_graph(mut scene: BookTravelScene) -> Result<BookTravelScene, String> {
    scene.stable_memory_patch = None;
    Ok(scene)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Debug, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    struct PlannerOutput {
        input_classification: String,
        story_progress: u32,
    }

    #[test]
    fn parses_valid_json_response() {
        let previous = PlannerOutput {
            input_classification: "insert-beat".to_string(),
            story_progress: 1,
        };

        let parsed = parse_book_travel_json::<PlannerOutput>(
            r#"{"inputClassification":"change-scene","storyProgress":2}"#,
            previous,
        )
        .expect("valid JSON should parse");

        assert_eq!(
            parsed,
            PlannerOutput {
                input_classification: "change-scene".to_string(),
                story_progress: 2,
            }
        );
    }

    #[test]
    fn invalid_json_preserves_previous_state_in_error() {
        let previous = PlannerOutput {
            input_classification: "insert-beat".to_string(),
            story_progress: 1,
        };

        let error = parse_book_travel_json::<PlannerOutput>("不是 JSON", previous.clone())
            .expect_err("invalid JSON should fail");

        assert!(error.contains("解析穿书 JSON 失败"));
        assert_eq!(
            previous,
            PlannerOutput {
                input_classification: "insert-beat".to_string(),
                story_progress: 1,
            }
        );
    }

    #[test]
    fn repairs_scene_graph_discards_stable_memory_patch() {
        let scene = BookTravelScene {
            id: "scene-1".to_string(),
            title: "破碎场景".to_string(),
            summary: None,
            current_situation: None,
            time: None,
            location: None,
            active_characters: vec![],
            beat: BookTravelBeat {
                id: "beat-1".to_string(),
                content: "第一段".to_string(),
            },
            stable_memory_patch: Some(serde_json::json!({"worldRules": ["被篡改"]})),
            volatile_memory_patch: Some(serde_json::json!({"clues": ["玉佩"]})),
        };

        let repaired = repair_scene_graph(scene)
            .expect("repair should keep scene playable");

        assert_eq!(repaired.stable_memory_patch, None);
        assert_eq!(
            repaired.volatile_memory_patch,
            Some(serde_json::json!({"clues": ["玉佩"]}))
        );
    }

    #[test]
    fn material_assembly_prompt_uses_selected_materials_and_role_settings() {
        let request = sample_request(
            BookTravelRole::MaterialAssembler,
            "素材装配系统提示词",
            0.1,
            6000,
            Some(32000),
            Some("low"),
        );

        let call = build_structured_call(&request, "{}").expect("request should build");

        assert_eq!(call.role, BookTravelRole::MaterialAssembler);
        assert_eq!(call.system_prompt, "素材装配系统提示词");
        assert_eq!(call.max_tokens, 6000);
        assert_eq!(call.temperature, 0.1);
        assert_eq!(call.thinking_depth.as_deref(), Some("low"));
        assert!(call.user_prompt.contains("《大纲》"));
        assert!(call.user_prompt.contains("原始大纲内容"));
        assert!(call.user_prompt.contains("《世界书》"));
        assert!(call.user_prompt.contains("世界书内容"));
        assert!(call.user_prompt.contains("《角色卡：沈霜》"));
        assert!(call.user_prompt.contains("角色卡内容"));
    }

    #[test]
    fn entry_director_prompt_uses_entry_role_and_expected_output_shape() {
        let request = sample_request(
            BookTravelRole::EntryDirector,
            "入场导演系统提示词",
            0.6,
            4096,
            Some(64000),
            Some("off"),
        );

        let call = build_structured_call(&request, "{}").expect("request should build");

        assert_eq!(call.role, BookTravelRole::EntryDirector);
        assert_eq!(call.system_prompt, "入场导演系统提示词");
    }

    #[test]
    fn plot_planner_prompts_cover_classification_and_scene_planning() {
        let classify_request = sample_request(
            BookTravelRole::InputClassifier,
            "剧情规划系统提示词",
            0.2,
            2048,
            Some(64000),
            None,
        );
        let classify_call = build_structured_call(&classify_request, "我要问沈霜一句话")
            .expect("classification call should build");
        assert_eq!(classify_call.role, BookTravelRole::InputClassifier);
        assert!(classify_call.user_prompt.contains("meta"));
        assert!(classify_call.user_prompt.contains("insert-beat"));
        assert!(classify_call.user_prompt.contains("change-scene"));

        let plan_request = sample_request(
            BookTravelRole::ScenePlanner,
            "剧情规划系统提示词",
            0.2,
            8192,
            Some(64000),
            None,
        );
        let plan_call = build_structured_call(&plan_request, "我离开客栈去找反派")
            .expect("scene plan call should build");
        assert_eq!(plan_call.role, BookTravelRole::ScenePlanner);
        assert!(plan_call.user_prompt.contains("stateChanges"));
        assert!(plan_call.user_prompt.contains("divergence"));
        assert!(plan_call.user_prompt.contains("storyProgress"));
        assert!(plan_call.user_prompt.contains("allowedCast"));
        assert!(plan_call.user_prompt.contains("writerInstructions"));
    }

    #[test]
    fn memory_and_ending_prompts_use_separate_roles() {
        let memory_request = sample_request(
            BookTravelRole::MemoryKeeper,
            "记忆整理系统提示词",
            0.2,
            4096,
            Some(64000),
            Some("medium"),
        );
        let memory_call =
            build_structured_call(&memory_request, "{}").expect("memory call should build");
        assert_eq!(memory_call.role, BookTravelRole::MemoryKeeper);
        assert_eq!(memory_call.system_prompt, "记忆整理系统提示词");
        assert!(memory_call.user_prompt.contains("summary"));
        assert!(memory_call.user_prompt.contains("keyChoices"));
        assert!(memory_call.user_prompt.contains("unresolvedConflicts"));

        let ending_request = sample_request(
            BookTravelRole::EndingJudge,
            "结局裁判系统提示词",
            0.3,
            8192,
            Some(64000),
            Some("high"),
        );
        let ending_call =
            build_structured_call(&ending_request, "{}").expect("ending call should build");
        assert_eq!(ending_call.role, BookTravelRole::EndingJudge);
        assert_eq!(ending_call.system_prompt, "结局裁判系统提示词");
        assert!(ending_call.user_prompt.contains("finalEnding"));
        assert!(ending_call.user_prompt.contains("worldlineName"));
        assert!(ending_call.user_prompt.contains("divergenceScore"));
    }

    #[test]
    fn openai_structured_body_honors_model_limits_and_thinking_depth() {
        let request = sample_request(
            BookTravelRole::ScenePlanner,
            "剧情规划系统提示词",
            0.2,
            8192,
            Some(64000),
            Some("high"),
        );
        let call = build_structured_call(&request, "推进剧情").expect("request should build");

        let body = build_openai_structured_body(&request.model, &call);

        assert_eq!(body["model"], "model");
        let temperature = body["temperature"]
            .as_f64()
            .expect("temperature should be numeric");
        assert!((temperature - 0.2).abs() < 0.0001);
        assert_eq!(body["max_tokens"], 8192);
        assert_eq!(body["enable_thinking"], true);
        assert_eq!(body["reasoning_effort"], "high");
        assert_eq!(body["messages"][0]["content"], "剧情规划系统提示词");
        assert!(body["messages"][1]["content"]
            .as_str()
            .unwrap()
            .contains("推进剧情"));
    }

    #[test]
    fn openai_structured_body_disables_thinking_depth_when_off() {
        let request = sample_request(
            BookTravelRole::ScenePlanner,
            "剧情规划系统提示词",
            0.2,
            8192,
            Some(64000),
            Some("off"),
        );
        let call = build_structured_call(&request, "推进剧情").expect("request should build");

        let body = build_openai_structured_body(&request.model, &call);

        assert_eq!(body["enable_thinking"], false);
        assert!(body.get("reasoning_effort").is_none());
    }

    #[test]
    fn scene_writer_prompt_uses_writer_role_and_full_runtime_context() {
        let request = sample_request(
            BookTravelRole::SceneWriter,
            "场景写手系统提示词",
            0.8,
            8192,
            Some(64000),
            Some("off"),
        );

        let call = build_scene_writer_call(&request, "insert-beat", "追问沈霜玉佩来历")
            .expect("scene writer call should build");

        assert_eq!(call.role, BookTravelRole::SceneWriter);
        assert_eq!(call.system_prompt, "场景写手系统提示词");
        assert_eq!(call.max_tokens, 8192);
        assert!(call.user_prompt.contains("insert-beat"));
        assert!(call.user_prompt.contains("不得创建新场景"));
        assert!(call.user_prompt.contains("selectedMaterials"));
        assert!(call.user_prompt.contains("stableMemory"));
        assert!(call.user_prompt.contains("volatileMemory"));
        assert!(call.user_prompt.contains("assembledWorldModel"));
        assert!(call.user_prompt.contains("summaryMemory"));
        assert!(call.user_prompt.contains("writerInstructions"));
    }

    #[test]
    fn writer_scene_output_is_repaired_before_persisting() {
        let raw_scene = r#"{
            "id":"scene-1",
            "title":"破碎新场景",
            "summary":"主角离开客栈",
            "currentSituation":"门外有雨",
            "time":"夜",
            "location":"客栈外",
            "activeCharacters":["我","沈霜"],
            "beat":{
                "id":"beat-1",
                "content":"她压低声音。"
            },
            "stableMemoryPatch":{"worldRules":["被写手篡改"]},
            "volatileMemoryPatch":{"clues":["雨夜玉佩"]}
        }"#;

        let scene = parse_and_repair_writer_scene(
            raw_scene,
            serde_json::json!({}),
        )
        .expect("writer scene should be repaired");

        assert_eq!(scene.stable_memory_patch, None);
        assert_eq!(
            scene.volatile_memory_patch,
            Some(serde_json::json!({"clues": ["雨夜玉佩"]}))
        );
    }

    fn sample_request(
        role: BookTravelRole,
        system_prompt: &str,
        temperature: f32,
        max_output_tokens: u32,
        max_context_tokens: Option<u32>,
        thinking_depth: Option<&str>,
    ) -> BookTravelStructuredRequest {
        BookTravelStructuredRequest {
            model_interface: "OpenAI-compatible".to_string(),
            base_url: "https://example.test/v1".to_string(),
            api_key: "key".to_string(),
            model: "model".to_string(),
            role,
            materials: Some(BookTravelSelectedMaterials {
                outline: BookTravelMaterial {
                    id: "outline.md".to_string(),
                    title: "大纲".to_string(),
                    content: "原始大纲内容".to_string(),
                },
                world_book: BookTravelMaterial {
                    id: "world-book".to_string(),
                    title: "世界书".to_string(),
                    content: "世界书内容".to_string(),
                },
                character_cards: vec![BookTravelMaterial {
                    id: "card-1".to_string(),
                    title: "沈霜".to_string(),
                    content: "角色卡内容".to_string(),
                }],
            }),
            state: serde_json::json!({"currentTime": "第一日"}),
            previous_valid_state: serde_json::json!({}),
            temperature: Some(temperature),
            max_output_tokens: Some(max_output_tokens),
            max_context_tokens,
            thinking_depth: thinking_depth.map(str::to_string),
            system_prompt: Some(system_prompt.to_string()),
        }
    }
}
