use serde_json::{json, Value};

use crate::agent::parse_tool_arguments;
use crate::models::*;

pub fn approximate_token_count(text: &str) -> usize {
    (text.chars().count() + 3) / 4
}

pub fn chat_message_token_estimate(message: &ChatMessage) -> usize {
    let tool_call_tokens = message
        .tool_calls
        .as_ref()
        .map(|calls| {
            calls
                .iter()
                .map(|call| {
                    approximate_token_count(&call.id)
                        + approximate_token_count(&call.name)
                        + approximate_token_count(&call.arguments)
                })
                .sum::<usize>()
        })
        .unwrap_or(0);
    let tool_call_id_tokens = message
        .tool_call_id
        .as_deref()
        .map(approximate_token_count)
        .unwrap_or(0);

    approximate_token_count(&message.role)
        + approximate_token_count(&message.content)
        + tool_call_tokens
        + tool_call_id_tokens
        + 8
}

pub fn trim_history_to_context_budget(
    system_prompt: &str,
    history: &[ChatMessage],
    max_context_tokens: Option<u32>,
) -> Vec<ChatMessage> {
    let Some(max_context_tokens) = max_context_tokens else {
        return history.to_vec();
    };
    let budget =
        (max_context_tokens as usize).saturating_sub(approximate_token_count(system_prompt));
    if budget == 0 {
        return Vec::new();
    }

    let mut selected = Vec::new();
    let mut total = 0usize;
    for message in history.iter().rev() {
        let cost = chat_message_token_estimate(message);
        if !selected.is_empty() && total + cost > budget {
            break;
        }
        if selected.is_empty() && cost > budget {
            selected.push(message.clone());
            break;
        }
        total += cost;
        selected.push(message.clone());
    }
    selected.reverse();
    while selected
        .first()
        .map(|message| message.role.as_str() == "tool")
        .unwrap_or(false)
    {
        selected.remove(0);
    }
    selected
}
pub fn openai_history_messages(system_prompt: &str, history: &[ChatMessage]) -> Vec<Value> {
    let mut messages = vec![json!({ "role": "system", "content": system_prompt })];
    for message in history {
        match message.role.as_str() {
            "user" => messages.push(json!({
                "role": "user",
                "content": message.content,
            })),
            "assistant" => {
                if let Some(tool_calls) = message
                    .tool_calls
                    .as_deref()
                    .filter(|calls| !calls.is_empty())
                {
                    messages.push(json!({
                        "role": "assistant",
                        "content": if message.content.trim().is_empty() {
                            Value::Null
                        } else {
                            Value::String(message.content.clone())
                        },
                        "tool_calls": tool_calls.iter().map(|call| {
                            json!({
                                "id": call.id,
                                "type": "function",
                                "function": {
                                    "name": call.name,
                                    "arguments": call.arguments,
                                },
                            })
                        }).collect::<Vec<_>>(),
                    }));
                } else {
                    messages.push(json!({
                        "role": "assistant",
                        "content": message.content,
                    }));
                }
            }
            "tool" => {
                if let Some(tool_call_id) =
                    message.tool_call_id.as_deref().filter(|id| !id.is_empty())
                {
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": message.content,
                    }));
                }
            }
            _ => {}
        }
    }
    messages
}
pub fn anthropic_history_messages(history: &[ChatMessage]) -> Vec<Value> {
    let mut messages = Vec::new();
    for message in history {
        match message.role.as_str() {
            "user" => messages.push(json!({
                "role": "user",
                "content": message.content,
            })),
            "assistant" => {
                let has_tool_calls = message
                    .tool_calls
                    .as_deref()
                    .map(|calls| !calls.is_empty())
                    .unwrap_or(false);
                let has_thinking = message
                    .thinking_blocks
                    .as_deref()
                    .map(|blocks| !blocks.is_empty())
                    .unwrap_or(false);

                if has_tool_calls || has_thinking {
                    let mut content = Vec::new();
                    if let Some(blocks) = message.thinking_blocks.as_deref() {
                        for block in blocks {
                            if let Some(obj) = block.as_object() {
                                if obj.get("type").and_then(Value::as_str) == Some("redacted_thinking") {
                                    content.push(block.clone());
                                } else {
                                    let mut thinking_block = serde_json::Map::new();
                                    thinking_block.insert("type".to_string(), json!("thinking"));
                                    if let Some(thinking) = obj.get("content")
                                        .or_else(|| obj.get("thinking"))
                                        .and_then(Value::as_str)
                                    {
                                        thinking_block.insert("thinking".to_string(), json!(thinking));
                                    }
                                    if let Some(signature) = obj.get("signature").and_then(Value::as_str) {
                                        thinking_block.insert("signature".to_string(), json!(signature));
                                    }
                                    content.push(Value::Object(thinking_block));
                                }
                            } else {
                                content.push(block.clone());
                            }
                        }
                    }
                    if !message.content.trim().is_empty() {
                        content.push(json!({
                            "type": "text",
                            "text": message.content,
                        }));
                    }
                    if let Some(tool_calls) = message.tool_calls.as_deref() {
                        for call in tool_calls {
                            content.push(json!({
                                "type": "tool_use",
                                "id": call.id,
                                "name": call.name,
                                "input": parse_tool_arguments(&call.arguments),
                            }));
                        }
                    }
                    messages.push(json!({
                        "role": "assistant",
                        "content": content,
                    }));
                } else {
                    messages.push(json!({
                        "role": "assistant",
                        "content": message.content,
                    }));
                }
            }
            "tool" => {
                if let Some(tool_call_id) =
                    message.tool_call_id.as_deref().filter(|id| !id.is_empty())
                {
                    messages.push(json!({
                        "role": "user",
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": tool_call_id,
                            "content": message.content,
                        }],
                    }));
                }
            }
            _ => {}
        }
    }
    messages
}
pub fn build_openai_endpoint(base_url: &str) -> String {
    build_endpoint(base_url, "v1/chat/completions", "chat/completions")
}

pub fn build_anthropic_endpoint(base_url: &str) -> String {
    build_endpoint(base_url, "v1/messages", "messages")
}

pub fn anthropic_thinking_config(thinking_depth: Option<&str>, max_tokens: u32) -> Option<Value> {
    let depth = thinking_depth?.trim();
    if depth.is_empty() || depth == "off" || max_tokens <= 1024 {
        return None;
    }

    let requested_budget = match depth {
        "low" => 1024,
        "medium" => 2048,
        "high" => 4096,
        _ => return None,
    };
    let budget_tokens = requested_budget.min(max_tokens.saturating_sub(1)).max(1024);

    Some(json!({
        "type": "enabled",
        "budget_tokens": budget_tokens,
    }))
}

pub fn build_endpoint(base_url: &str, default_path: &str, terminal_path: &str) -> String {
    let trimmed_base = base_url.trim().trim_end_matches('/');
    if trimmed_base.ends_with(terminal_path) {
        return trimmed_base.to_string();
    }
    if trimmed_base.ends_with("/v1") {
        return format!("{}/{}", trimmed_base, terminal_path);
    }
    format!("{}/{}", trimmed_base, default_path)
}

pub fn process_sse_buffer(buffer: &mut String, mut handle_data: impl FnMut(&str)) {
    while let Some(index) = buffer.find("\n\n") {
        let frame = buffer[..index].to_string();
        *buffer = buffer[index + 2..].to_string();
        for line in frame.lines() {
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            handle_data(data.trim());
        }
    }
}
pub fn parse_openai_stream_event(data: &str) -> Option<OpenAiStreamEvent> {
    let value: Value = serde_json::from_str(data).ok()?;
    let choice = value.get("choices")?.get(0)?;
    let delta = choice.get("delta")?;
    let content = delta
        .get("content")
        .and_then(Value::as_str)
        .map(String::from);
    let reasoning_content = delta
        .get("reasoning_content")
        .and_then(Value::as_str)
        .map(String::from);
    let mut tool_call_chunks = Vec::new();
    if let Some(chunks) = delta.get("tool_calls").and_then(Value::as_array) {
        for chunk in chunks {
            let index = chunk.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let function = chunk.get("function").unwrap_or(&Value::Null);
            tool_call_chunks.push(OpenAiToolCallChunk {
                index,
                id: chunk.get("id").and_then(Value::as_str).map(String::from),
                name: function
                    .get("name")
                    .and_then(Value::as_str)
                    .map(String::from),
                arguments: function
                    .get("arguments")
                    .and_then(Value::as_str)
                    .map(String::from),
            });
        }
    }
    Some(OpenAiStreamEvent {
        content,
        reasoning_content,
        tool_call_chunks,
    })
}
pub fn parse_anthropic_stream_event(data: &str) -> Option<AnthropicStreamEvent> {
    let value: Value = serde_json::from_str(data).ok()?;
    match value.get("type")?.as_str()? {
        "content_block_start" => {
            let index = value.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let block = value.get("content_block")?;
            match block.get("type")?.as_str()? {
                "thinking" => Some(AnthropicStreamEvent::ThinkingStart { index }),
                "redacted_thinking" => block.get("data").and_then(Value::as_str).map(|data| {
                    AnthropicStreamEvent::RedactedThinking {
                        index,
                        data: data.to_string(),
                    }
                }),
                "tool_use" => Some(AnthropicStreamEvent::ToolStart {
                    index,
                    id: block.get("id")?.as_str()?.to_string(),
                    name: block.get("name")?.as_str()?.to_string(),
                }),
                _ => None,
            }
        }
        "content_block_delta" => {
            let index = value.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let delta = value.get("delta")?;
            match delta.get("type").and_then(Value::as_str) {
                Some("text_delta") => delta
                    .get("text")
                    .and_then(Value::as_str)
                    .map(|text| AnthropicStreamEvent::Text(text.to_string())),
                Some("thinking_delta") => {
                    delta
                        .get("thinking")
                        .and_then(Value::as_str)
                        .map(|thinking| AnthropicStreamEvent::ThinkingDelta {
                            index,
                            thinking: thinking.to_string(),
                        })
                }
                Some("signature_delta") => {
                    delta
                        .get("signature")
                        .and_then(Value::as_str)
                        .map(|signature| AnthropicStreamEvent::ThinkingSignature {
                            index,
                            signature: signature.to_string(),
                        })
                }
                Some("input_json_delta") => {
                    delta
                        .get("partial_json")
                        .and_then(Value::as_str)
                        .map(|partial_json| AnthropicStreamEvent::ToolInputDelta {
                            index,
                            partial_json: partial_json.to_string(),
                        })
                }
                _ => None,
            }
        }
        _ => None,
    }
}
