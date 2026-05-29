use serde_json::{json, Value};
use std::fs;
use tauri::AppHandle;
use uuid::Uuid;

use super::*;
use crate::llm::*;
use crate::models::*;
use crate::utils::*;
use crate::ActiveStreams;

#[tauri::command]
pub fn list_agent_sessions(app: AppHandle) -> Result<Vec<AgentSessionSummary>, String> {
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
        summaries.push(AgentSessionSummary {
            id: record.id,
            title: record.title,
            saved_at: record.saved_at,
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
    })
}
#[tauri::command]
pub async fn summarize_text(request: SummarizeRequest) -> Result<String, String> {
    let client = reqwest::Client::new();
    let system_prompt =
        "请用不超过8个字的简短标题概括用户提供的文本，只返回标题本身，不要加引号、标点或其他格式。";
    let max_tokens = request.max_output_tokens.unwrap_or(64).min(128);

    match request.model_interface.as_str() {
        "Anthropic-compatible" => {
            let endpoint = build_anthropic_endpoint(&request.base_url);
            let body = json!({
                "model": request.model,
                "messages": [{"role": "user", "content": request.text}],
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
                .map_err(|e| e.to_string())?;

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
                json!({"role": "user", "content": request.text}),
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
                .map_err(|e| e.to_string())?;

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
    })
}
#[tauri::command]
pub fn start_chat_completion_stream(
    app: AppHandle,
    mut request: ChatStreamRequest,
    state: tauri::State<'_, ActiveStreams>,
) -> Result<String, String> {
    if request.api_key.trim().is_empty() {
        return Err(String::from("API Key 不能为空"));
    }
    if request.model.trim().is_empty() {
        return Err(String::from("模型名称不能为空"));
    }
    if request.base_url.trim().is_empty() {
        return Err(String::from("接口地址不能为空"));
    }
    if request.messages.is_empty() {
        return Err(String::from("消息不能为空"));
    }

    let reference_context = build_reference_context(&request);
    if !reference_context.is_empty() {
        if let Some(last_msg) = request.messages.last_mut() {
            last_msg.content.push_str(&reference_context);
        }
    }

    let run_id = Uuid::new_v4().to_string();
    let spawned_run_id = run_id.clone();
    let state_app = app.clone();

    let handle = tauri::async_runtime::spawn(async move {
        emit_chat_event(
            &app,
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
                run_anthropic_agent_loop(&app, &spawned_run_id, &request, options).await
            }
            _ => run_openai_agent_loop(&app, &spawned_run_id, &request, options).await,
        };

        match result {
            Ok(_) => emit_chat_event(
                &app,
                &spawned_run_id,
                "done",
                None,
                None,
                &AgentRunOptions::parent(),
            ),
            Err(error) => emit_chat_event(
                &app,
                &spawned_run_id,
                "error",
                None,
                Some(error),
                &AgentRunOptions::parent(),
            ),
        }

        if let Some(active_streams) = state_app.try_state::<ActiveStreams>() {
            let mut streams = active_streams.0.lock().unwrap();
            streams.remove(&spawned_run_id);
        }
    });

    state.0.lock().unwrap().insert(run_id.clone(), handle);

    Ok(run_id)
}
#[tauri::command]
pub fn stop_chat_stream(
    run_id: String,
    state: tauri::State<'_, ActiveStreams>,
) -> Result<(), String> {
    if let Some(handle) = state.0.lock().unwrap().remove(&run_id) {
        handle.abort();
    }
    Ok(())
}
