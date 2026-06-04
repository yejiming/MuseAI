use serde_json::{Value, json};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use tauri::AppHandle;
use uuid::Uuid;

use super::*;
use crate::ActiveStreams;
use crate::llm::*;
use crate::models::*;
use crate::utils::*;

#[tauri::command]
pub fn list_agent_sessions(
    app: AppHandle,
    prefix: Option<String>,
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
        if (record.id.starts_with("partner-session-") || record.id.starts_with("story-session-"))
            && record.is_archived != Some(true)
        {
            continue;
        }
        summaries.push(AgentSessionSummary {
            id: record.id,
            title: record.title,
            saved_at: record.saved_at,
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
    let Ok(doc_dir) = app.path().document_dir() else {
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

fn canonical_json_response(text: String) -> Result<String, String> {
    let cleaned = clean_json_response(text);
    let parsed: Value = serde_json::from_str(&cleaned)
        .map_err(|e| format!("模型没有返回合法 JSON，请重新分析：{}", e))?;
    serde_json::to_string(&parsed).map_err(|e| e.to_string())
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
    let system_prompt = "你是一个专门负责伴侣角色记忆管理的AI。你需要基于本次对话记录，以及原有的与用户关系设定（包括关系类型、相处模式、关系底线）和关键事件，来分析两者的改变，并输出本次会话的建议标题。请务必严格按照JSON格式返回。";
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

#[tauri::command]
pub async fn generate_background_items(
    request: GenerateBackgroundItemsRequest,
) -> Result<String, String> {
    let client = reqwest::Client::new();
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
         以下是参考内容：\n\
         ===========================\n\
         {}\n\
         ===========================\n\
         请注意：仅返回符合上述 JSON 结构的纯数据，千万不要包含 ```json 这种 Markdown 标记，也不要有任何前言或后记解释。",
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

    Ok(clean_json_response(raw_content))
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

            Ok("连接成功".to_string())
        }
        _ => {
            let endpoint = build_openai_endpoint(&request.base_url);
            let messages = vec![json!({"role": "user", "content": user_prompt})];
            let body = json!({
                "model": request.model,
                "messages": messages,
                "stream": false,
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

            Ok("连接成功".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        append_agent_run_error_log, build_analyze_memory_user_prompt, canonical_json_response,
        clean_json_response,
    };
    use crate::models::AnalyzeMemoryRequest;
    use serde_json::Value;
    use std::env;
    use std::fs;
    use std::time::SystemTime;

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
        };

        let prompt = build_analyze_memory_user_prompt(&request);

        assert!(prompt.contains("目标角色**：角色A"));
        assert!(prompt.contains("只分析并输出“目标角色”与用户之间的关系"));
        assert!(prompt.contains("严禁把其他角色与用户的关系"));
        assert!(prompt.contains("\"userRelationType\" 不要超过50字"));
        assert!(
            prompt
                .contains("\"userInteractionModel\" 和 \"userRelationBottomLine\" 各不要超过100字")
        );
        assert!(
            prompt
                .contains("\"keyEvents\" 必须保留原有关键事件内容，只能在原本基础上最多增加100字")
        );
        assert!(prompt.contains("新增部分前面必须空一行"));
        assert!(prompt.contains("【事件名】事件详情"));
    }
}
