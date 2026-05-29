#[macro_use]
pub mod sessions;

use std::process::Command;

use chrono::Local;
use futures_util::{future::BoxFuture, StreamExt};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::skills::discover_skills;
use crate::llm::*;
use crate::models::*;
use crate::tools::*;
use crate::utils::*;

pub async fn run_openai_agent_loop(
    app: &AppHandle,
    run_id: &str,
    request: &ChatStreamRequest,
    options: AgentRunOptions,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let endpoint = build_openai_endpoint(&request.base_url);
    let system_prompt = assemble_system_prompt(Some(app), request)?;
    let history = trim_history_to_context_budget(
        &system_prompt,
        &request.messages,
        request.max_context_tokens,
    );
    let mut messages = openai_history_messages(&system_prompt, &history);
    let tools = openai_tool_definitions(&options);

    for round in 0..=options.max_tool_rounds {
        let mut body = json!({
            "model": request.model,
            "messages": messages,
            "stream": true,
            "temperature": request.temperature.unwrap_or(0.7),
            "max_tokens": request.max_output_tokens.unwrap_or(4096),
            "tools": tools,
            "tool_choice": "auto",
        });
        body["stream_options"] = json!({ "include_usage": true });

        let response = client
            .post(&endpoint)
            .bearer_auth(&request.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("OpenAI 兼容接口请求失败：{} {}", status, body));
        }

        let stream_result = stream_openai_round(app, run_id, response, &options).await?;
        if stream_result.tool_calls.is_empty() {
            return Ok(stream_result.content);
        }
        if round >= options.max_tool_rounds {
            return Err(format!(
                "Agent 工具调用轮次超过上限（{} 轮），已停止继续执行。",
                options.max_tool_rounds
            ));
        }

        let assistant_tool_calls: Vec<Value> = stream_result
            .tool_calls
            .iter()
            .map(|call| {
                json!({
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": call.arguments,
                    }
                })
            })
            .collect();
        messages.push(json!({
            "role": "assistant",
            "content": stream_result.content,
            "tool_calls": assistant_tool_calls,
        }));

        for call in stream_result.tool_calls {
            let result = execute_agent_tool(
                app,
                run_id,
                request,
                options.clone(),
                &call.id,
                &call.name,
                &call.arguments,
            )
            .await;
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call.id,
                "content": result.model_output,
            }));
        }
    }

    Err(String::from("Agent 工具循环异常结束"))
}
async fn stream_openai_round(
    app: &AppHandle,
    run_id: &str,
    response: reqwest::Response,
    options: &AgentRunOptions,
) -> Result<OpenAiRoundResult, String> {
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut result = OpenAiRoundResult::default();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        process_sse_buffer(&mut buffer, |data| {
            if data == "[DONE]" {
                return;
            }
            if let Some(event) = parse_openai_stream_event(data) {
                if let Some(reasoning) = event.reasoning_content {
                    if options.emit_events {
                        emit_chat_event(
                            app,
                            run_id,
                            "thinking_delta",
                            Some(reasoning),
                            None,
                            options,
                        );
                    }
                }
                if let Some(delta) = event.content {
                    result.content.push_str(&delta);
                    if options.emit_events {
                        emit_chat_event(app, run_id, "delta", Some(delta), None, options);
                    }
                }
                for chunk in event.tool_call_chunks {
                    result.apply_tool_call_chunk(chunk);
                }
            }
        });
    }
    Ok(result)
}
pub async fn run_anthropic_agent_loop(
    app: &AppHandle,
    run_id: &str,
    request: &ChatStreamRequest,
    options: AgentRunOptions,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let endpoint = build_anthropic_endpoint(&request.base_url);
    let system_prompt = assemble_system_prompt(Some(app), request)?;
    let history = trim_history_to_context_budget(
        &system_prompt,
        &request.messages,
        request.max_context_tokens,
    );
    let mut messages = anthropic_history_messages(&history);
    let tools = anthropic_tool_definitions(&options);

    for round in 0..=options.max_tool_rounds {
        let max_tokens = request.max_output_tokens.unwrap_or(4096);
        let mut body = json!({
            "model": request.model,
            "messages": messages,
            "system": system_prompt,
            "stream": true,
            "max_tokens": max_tokens,
            "tools": tools,
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
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic 兼容接口请求失败：{} {}", status, body));
        }

        let stream_result = stream_anthropic_round(app, run_id, response, &options).await?;
        if stream_result.tool_calls.is_empty() {
            return Ok(stream_result.content);
        }
        if round >= options.max_tool_rounds {
            return Err(format!(
                "Agent 工具调用轮次超过上限（{} 轮），已停止继续执行。",
                options.max_tool_rounds
            ));
        }

        let mut assistant_content = Vec::new();
        assistant_content.extend(stream_result.finalized_thinking_blocks());
        if !stream_result.content.trim().is_empty() {
            assistant_content.push(json!({ "type": "text", "text": stream_result.content }));
        }
        for call in &stream_result.tool_calls {
            assistant_content.push(json!({
                "type": "tool_use",
                "id": call.id,
                "name": call.name,
                "input": parse_tool_arguments(&call.arguments),
            }));
        }
        messages.push(json!({
            "role": "assistant",
            "content": assistant_content,
        }));

        let mut tool_results = Vec::new();
        for call in stream_result.tool_calls {
            let result = execute_agent_tool(
                app,
                run_id,
                request,
                options.clone(),
                &call.id,
                &call.name,
                &call.arguments,
            )
            .await;
            tool_results.push(json!({
                "type": "tool_result",
                "tool_use_id": call.id,
                "content": result.model_output,
                "is_error": !result.success,
            }));
        }
        messages.push(json!({
            "role": "user",
            "content": tool_results,
        }));
    }

    Err(String::from("Agent 工具循环异常结束"))
}
async fn stream_anthropic_round(
    app: &AppHandle,
    run_id: &str,
    response: reqwest::Response,
    options: &AgentRunOptions,
) -> Result<AnthropicRoundResult, String> {
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut result = AnthropicRoundResult::default();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        process_sse_buffer(&mut buffer, |data| {
            if let Some(event) = parse_anthropic_stream_event(data) {
                match event {
                    AnthropicStreamEvent::Text(delta) => {
                        result.content.push_str(&delta);
                        if options.emit_events {
                            emit_chat_event(app, run_id, "delta", Some(delta), None, options);
                        }
                    }
                    AnthropicStreamEvent::ThinkingStart { index } => {
                        result.start_thinking_block(index);
                    }
                    AnthropicStreamEvent::ThinkingDelta { index, thinking } => {
                        result.push_thinking_delta(index, &thinking);
                        if options.emit_events {
                            emit_chat_event(
                                app,
                                run_id,
                                "thinking_delta",
                                Some(thinking),
                                None,
                                options,
                            );
                        }
                    }
                    AnthropicStreamEvent::ThinkingSignature { index, signature } => {
                        result.set_thinking_signature(index, signature);
                    }
                    AnthropicStreamEvent::RedactedThinking { index, data } => {
                        result.push_redacted_thinking(index, data);
                    }
                    AnthropicStreamEvent::ToolStart { index, id, name } => {
                        result.start_tool_call(index, id, name);
                    }
                    AnthropicStreamEvent::ToolInputDelta {
                        index,
                        partial_json,
                    } => {
                        result.push_tool_arguments(index, &partial_json);
                    }
                }
            }
        });
    }
    Ok(result)
}
pub fn emit_chat_event(
    app: &AppHandle,
    run_id: &str,
    event_type: &str,
    delta: Option<String>,
    message: Option<String>,
    options: &AgentRunOptions,
) {
    if !options.emit_events {
        return;
    }
    if let Some(parent_id) = &options.parent_tool_call_id {
        if event_type == "delta" || event_type == "thinking_delta" || event_type == "error" {
            let mut output_delta = delta.clone().unwrap_or_default();
            if event_type == "error" {
                output_delta = format!("\n[Agent出错: {}]\n", message.clone().unwrap_or_default());
            }
            let _ = app.emit(
                "agent-chat-stream",
                ChatStreamEvent {
                    run_id: run_id.to_string(),
                    event_type: "tool_output".to_string(),
                    delta: Some(output_delta),
                    message: None,
                    tool_call_id: Some(parent_id.to_string()),
                    tool_name: Some("subagent".to_string()),
                    tool_status: Some("running".to_string()),
                    tool_arguments: None,
                    todos: None,
                },
            );
        }
        return;
    }

    let _ = app.emit(
        "agent-chat-stream",
        ChatStreamEvent {
            run_id: run_id.to_string(),
            event_type: event_type.to_string(),
            delta,
            message,
            tool_call_id: None,
            tool_name: None,
            tool_status: None,
            tool_arguments: None,
            todos: None,
        },
    );
}
pub fn emit_tool_event(
    app: &AppHandle,
    run_id: &str,
    event_type: &str,
    tool_call_id: &str,
    tool_name: &str,
    tool_status: Option<&str>,
    tool_arguments: Option<&str>,
    message: Option<String>,
    options: &AgentRunOptions,
) {
    if !options.emit_events {
        return;
    }
    if let Some(parent_id) = &options.parent_tool_call_id {
        let mut delta = String::new();
        if event_type == "tool_start" {
            let args = tool_arguments.unwrap_or("{}");
            delta = format!("\n[调用子工具 {} ({})]\n", tool_name, args);
        } else if event_type == "tool_end" {
            delta = format!(
                "\n[子工具 {} 执行完毕: {}]\n",
                tool_name,
                message.clone().unwrap_or_default()
            );
        }

        if !delta.is_empty() {
            let _ = app.emit(
                "agent-chat-stream",
                ChatStreamEvent {
                    run_id: run_id.to_string(),
                    event_type: "tool_output".to_string(),
                    delta: Some(delta),
                    message: None,
                    tool_call_id: Some(parent_id.to_string()),
                    tool_name: Some("subagent".to_string()),
                    tool_status: Some("running".to_string()),
                    tool_arguments: None,
                    todos: None,
                },
            );
        }
        return;
    }

    let _ = app.emit(
        "agent-chat-stream",
        ChatStreamEvent {
            run_id: run_id.to_string(),
            event_type: event_type.to_string(),
            delta: None,
            message,
            tool_call_id: Some(tool_call_id.to_string()),
            tool_name: Some(tool_name.to_string()),
            tool_status: tool_status.map(String::from),
            tool_arguments: tool_arguments.map(String::from),
            todos: None,
        },
    );
}
fn emit_todo_update(app: &AppHandle, run_id: &str, todos: Vec<AgentSessionTodo>) {
    let _ = app.emit(
        "agent-chat-stream",
        ChatStreamEvent {
            run_id: run_id.to_string(),
            event_type: String::from("todo_update"),
            delta: None,
            message: None,
            tool_call_id: None,
            tool_name: None,
            tool_status: None,
            tool_arguments: None,
            todos: Some(todos),
        },
    );
}
async fn execute_agent_tool(
    app: &AppHandle,
    run_id: &str,
    request: &ChatStreamRequest,
    options: AgentRunOptions,
    tool_call_id: &str,
    tool_name: &str,
    arguments: &str,
) -> AgentToolExecution {
    if options.emit_events {
        emit_tool_event(
            app,
            run_id,
            "tool_start",
            tool_call_id,
            tool_name,
            Some("running"),
            Some(arguments),
            Some(String::from("正在执行工具")),
            &options,
        );
    }

    let parsed = serde_json::from_str::<Value>(arguments).unwrap_or_else(|_| json!({}));
    let execution = match execute_agent_tool_inner(
        app,
        run_id,
        request,
        options.clone(),
        tool_call_id,
        tool_name,
        &parsed,
    )
    .await
    {
        Ok((output, todos)) => {
            if options.emit_todo_updates {
                if let Some(todos) = todos {
                    emit_todo_update(app, run_id, todos);
                }
            }
            AgentToolExecution {
                success: true,
                model_output: normalize_agent_tool_output(true, &output),
            }
        }
        Err(output) => AgentToolExecution {
            success: false,
            model_output: normalize_agent_tool_output(false, &output),
        },
    };

    if options.emit_events {
        emit_tool_event(
            app,
            run_id,
            "tool_output",
            tool_call_id,
            tool_name,
            Some(if execution.success {
                "success"
            } else {
                "error"
            }),
            None,
            Some(execution.model_output.clone()),
            &options,
        );
        emit_tool_event(
            app,
            run_id,
            "tool_end",
            tool_call_id,
            tool_name,
            Some(if execution.success {
                "success"
            } else {
                "error"
            }),
            None,
            Some(execution.model_output.clone()),
            &options,
        );
    }
    execution
}
async fn execute_agent_tool_inner(
    app: &AppHandle,
    run_id: &str,
    request: &ChatStreamRequest,
    options: AgentRunOptions,
    tool_call_id: &str,
    tool_name: &str,
    input: &Value,
) -> Result<(String, Option<Vec<AgentSessionTodo>>), String> {
    if !options.allows_tool(tool_name) {
        return Err(format!(
            "Error: tool \"{}\" is not available in this Agent run",
            tool_name
        ));
    }

    match tool_name {
        "read" => {
            let file_path = required_string(input, "file_path")?;
            ensure_read_path_allowed(app, request.workspace_path.as_deref(), &file_path)?;
            let result = tool_read(
                file_path,
                optional_usize(input, "offset"),
                optional_usize(input, "limit"),
                request.workspace_path.clone(),
            );
            result_to_agent_execution(result).map(|output| (output, None))
        }
        "write" => {
            let file_path = required_string(input, "file_path")?;
            ensure_write_path_allowed(request, &file_path)?;
            let result = tool_write(
                app.clone(),
                file_path,
                required_string(input, "content")?,
                request.workspace_path.clone(),
            );
            result_to_agent_execution(result).map(|output| (output, None))
        }
        "edit" => {
            let file_path = required_string(input, "file_path")?;
            ensure_write_path_allowed(request, &file_path)?;
            let result = tool_edit(
                app.clone(),
                file_path,
                required_string(input, "old_string")?,
                required_string(input, "new_string")?,
                request.workspace_path.clone(),
            );
            result_to_agent_execution(result).map(|output| (output, None))
        }
        "bash" => {
            let result = tool_bash(
                app.clone(),
                required_string(input, "command")?,
                optional_string(input, "cwd"),
                optional_u64(input, "timeout_secs"),
                request.workspace_path.clone(),
            )
            .await;
            bash_result_to_agent_execution(result).map(|output| (output, None))
        }
        "grep" => {
            let path = optional_string(input, "path");
            if let Some(ref p) = path {
                ensure_read_path_allowed(app, request.workspace_path.as_deref(), p)?;
            }
            let result = tool_grep(
                required_string(input, "pattern")?,
                path,
                optional_string(input, "include"),
                request.workspace_path.clone(),
            );
            result_to_agent_execution(result).map(|output| (output, None))
        }
        "glob" => {
            let path = optional_string(input, "path");
            if let Some(ref p) = path {
                ensure_read_path_allowed(app, request.workspace_path.as_deref(), p)?;
            }
            let result = tool_glob(
                required_string(input, "pattern")?,
                path,
                request.workspace_path.clone(),
            );
            result_to_agent_execution(result).map(|output| (output, None))
        }
        "skill" => {
            let result = tool_skill(
                app.clone(),
                required_string(input, "skill")?,
                optional_string(input, "task"),
                optional_string(input, "args"),
            );
            result_to_agent_execution(result).map(|output| (output, None))
        }
        "subagent" => {
            let task = required_string(input, "task")?;
            let output =
                run_subagent_agent_loop(app, run_id, request, task, tool_call_id.to_string())
                    .await?;
            Ok((output, None))
        }
        "todo" => {
            let todos = parse_todos(input)?;
            let result = tool_todo(todos.clone());
            result_to_agent_execution(result).map(|output| {
                let ui_todos = todos
                    .into_iter()
                    .map(|todo| AgentSessionTodo {
                        content: todo.content,
                        status: todo.status,
                    })
                    .collect();
                (output, Some(ui_todos))
            })
        }
        _ => Err(format!("Error: unknown tool \"{}\"", tool_name)),
    }
}
fn run_subagent_agent_loop<'a>(
    app: &'a AppHandle,
    run_id: &'a str,
    parent_request: &'a ChatStreamRequest,
    task: String,
    parent_tool_call_id: String,
) -> BoxFuture<'a, Result<String, String>> {
    Box::pin(async move {
        let mut child_request = parent_request.clone();
        child_request.system_prompt = append_subagent_system_prompt(&child_request.system_prompt);
        child_request.messages = vec![ChatMessage {
            role: "user".to_string(),
            content: task,
            tool_call_id: None,
            tool_calls: None,
        }];

        let result = match child_request.model_interface.as_str() {
            "Anthropic-compatible" => {
                run_anthropic_agent_loop(
                    app,
                    run_id,
                    &child_request,
                    AgentRunOptions::subagent(Some(parent_tool_call_id)),
                )
                .await
            }
            _ => {
                run_openai_agent_loop(
                    app,
                    run_id,
                    &child_request,
                    AgentRunOptions::subagent(Some(parent_tool_call_id)),
                )
                .await
            }
        };

        match result {
            Ok(output) => Ok(format_subagent_success_output(&output)),
            Err(error) => Err(format_subagent_error_output(&error)),
        }
    })
}
pub fn format_subagent_success_output(output: &str) -> String {
    let output = if output.trim().is_empty() {
        String::from("（子 Agent 未返回内容）")
    } else {
        output.to_string()
    };
    format!(
        "[Sub-agent completed]\n{}",
        truncate_chars(&output, MAX_SUBAGENT_OUTPUT_CHARS)
    )
}
pub fn format_subagent_error_output(error: &str) -> String {
    format!("Sub-agent error: {}", error)
}
pub fn append_subagent_system_prompt(system_prompt: &str) -> String {
    let mut prompt = system_prompt.trim().to_string();
    if !prompt.is_empty() {
        prompt.push_str("\n\n");
    }
    prompt.push_str(
        "## 子 Agent 模式\n你正在作为一个独立的子 Agent 执行父 Agent 交给你的子任务。请只围绕子任务工作，必要时使用可用工具，并在完成后返回清晰、简洁的结果。你不能再调用 subagent。",
    );
    prompt
}
pub fn result_to_agent_execution(result: ToolResult) -> Result<String, String> {
    if result.success {
        Ok(result.output)
    } else {
        Err(result.output)
    }
}
pub fn bash_result_to_agent_execution(result: BashToolResult) -> Result<String, String> {
    let output = format!(
        "exit_code: {}\ntimed_out: {}\nstdout:\n{}\nstderr:\n{}",
        result
            .exit_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| String::from("none")),
        result.timed_out,
        result.stdout,
        result.stderr
    );
    if result.success {
        Ok(output)
    } else {
        Err(output)
    }
}
pub fn normalize_agent_tool_output(success: bool, output: &str) -> String {
    let status = if success { "success" } else { "error" };
    let normalized = truncate_chars(output, MAX_AGENT_TOOL_OUTPUT_CHARS);
    format!("status: {}\n{}", status, normalized)
}
pub fn parse_tool_arguments(arguments: &str) -> Value {
    serde_json::from_str(arguments).unwrap_or_else(|_| json!({}))
}
pub fn required_string(input: &Value, key: &str) -> Result<String, String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(String::from)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Error: {} is required", key))
}

pub fn optional_string(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(String::from)
        .filter(|value| !value.trim().is_empty())
}

pub fn optional_usize(input: &Value, key: &str) -> Option<usize> {
    input
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
}

pub fn optional_u64(input: &Value, key: &str) -> Option<u64> {
    input.get(key).and_then(Value::as_u64)
}

pub fn parse_todos(input: &Value) -> Result<Vec<TodoItem>, String> {
    let todos = input
        .get("todos")
        .cloned()
        .ok_or_else(|| String::from("Error: todos is required"))?;
    serde_json::from_value(todos).map_err(|error| format!("Error: invalid todos: {}", error))
}
pub fn assemble_system_prompt(
    app: Option<&AppHandle>,
    request: &ChatStreamRequest,
) -> Result<String, String> {
    let mut prompt = request.system_prompt.trim().to_string();
    let workspace_context = build_workspace_context(request);

    if !workspace_context.is_empty() {
        if !prompt.is_empty() {
            prompt.push_str("\n\n");
        }
        prompt.push_str(&workspace_context);
    }

    let current_time = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    prompt.push_str(&format!(
        "\n\n## 系统信息\n- **当前时间**：{}\n- **操作系统**：{}\n- **Python 环境**：{}\n- **可用 Skills**：\n",
        current_time,
        operating_system_info(),
        get_python_info()
    ));

    let skills = discover_skills(app);
    if skills.is_empty() {
        prompt.push_str("  （无可用 skill）\n");
    } else {
        for skill in skills {
            prompt.push_str(&format!(
                "  - `{}`: {}（路径：{}）\n",
                skill.name,
                skill.description,
                skill.path.display()
            ));
        }
    }

    Ok(prompt)
}

fn operating_system_info() -> String {
    #[cfg(target_os = "macos")]
    {
        let product = Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let build = Command::new("sw_vers")
            .arg("-buildVersion")
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if let Some(product) = product {
            return match build {
                Some(build) => format!("macOS {} ({})", product, build),
                None => format!("macOS {}", product),
            };
        }
    }

    let release = Command::new("uname")
        .arg("-r")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    match release {
        Some(release) => format!("{} {}", std::env::consts::OS, release),
        None => std::env::consts::OS.to_string(),
    }
}
pub fn build_workspace_context(request: &ChatStreamRequest) -> String {
    let mut lines = Vec::new();
    lines.push(String::from("## 当前环境"));
    if let Some(path) = request
        .workspace_path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
    {
        lines.push(format!("当前工作空间路径：{}", path.trim()));
    } else {
        lines.push(String::from("当前工作空间路径：未选择"));
    }

    lines.join("\n")
}
pub fn build_reference_context(request: &ChatStreamRequest) -> String {
    let mut lines = Vec::new();
    if let Some(files) = &request.selected_reference_files {
        if !files.is_empty() {
            lines.push(String::from("\n\n## 范文参考"));
            lines.push(String::from("用户为你指定了以下范文作为写作参考。你可以使用工具来读取这些文件并提取其风格和结构："));
            for file_path in files {
                let resolved_path = expand_path(request.workspace_path.as_deref(), file_path);
                lines.push(format!("- {}", resolved_path.display()));
            }
        }
    }
    lines.join("\n")
}
