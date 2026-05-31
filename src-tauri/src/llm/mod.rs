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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approximate_token_count_basic() {
        assert_eq!(approximate_token_count(""), 0);
        assert_eq!(approximate_token_count("a"), 1);
        assert_eq!(approximate_token_count("abcd"), 1);
        assert_eq!(approximate_token_count("abcde"), 2);
        assert_eq!(approximate_token_count("abcdefgh"), 2);
        assert_eq!(approximate_token_count("中文测试"), 1); // 4 chars -> (4+3)/4 = 1
    }

    #[test]
    fn chat_message_token_estimate_basic() {
        let msg = ChatMessage {
            role: "user".to_string(),
            content: "hello world".to_string(),
            tool_call_id: None,
            tool_calls: None,
            thinking_blocks: None,
        };
        // role (4 chars -> 1) + content (11 chars -> 3) + 8 overhead = 12
        assert_eq!(chat_message_token_estimate(&msg), 12);
    }

    #[test]
    fn chat_message_token_estimate_with_tool_calls() {
        let msg = ChatMessage {
            role: "assistant".to_string(),
            content: "ok".to_string(),
            tool_call_id: None,
            tool_calls: Some(vec![
                ChatToolCall {
                    id: "call_1".to_string(),
                    name: "read".to_string(),
                    arguments: "{\"file_path\": \"test.md\"}".to_string(),
                },
            ]),
            thinking_blocks: None,
        };
        let estimate = chat_message_token_estimate(&msg);
        // role (9->3) + content (2->1) + tool_call_id(0) + tool_calls(call_1(6->2) + read(4->1) + args(24->6)) + 8 = 3+1+0+2+1+6+8 = 21
        assert_eq!(estimate, 21);
    }

    #[test]
    fn trim_history_to_context_budget_no_budget() {
        let history = vec![
            ChatMessage { role: "user".to_string(), content: "hi".to_string(), tool_call_id: None, tool_calls: None, thinking_blocks: None },
        ];
        let result = trim_history_to_context_budget("system", &history, None);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn trim_history_to_context_budget_zero() {
        let history = vec![
            ChatMessage { role: "user".to_string(), content: "hi".to_string(), tool_call_id: None, tool_calls: None, thinking_blocks: None },
        ];
        let result = trim_history_to_context_budget("system", &history, Some(1));
        assert!(result.is_empty());
    }

    #[test]
    fn trim_history_to_context_budget_trims() {
        let history = vec![
            ChatMessage { role: "user".to_string(), content: "message one".to_string(), tool_call_id: None, tool_calls: None, thinking_blocks: None },
            ChatMessage { role: "assistant".to_string(), content: "message two".to_string(), tool_call_id: None, tool_calls: None, thinking_blocks: None },
        ];
        // System prompt is "sys" (3 chars -> 0 tokens after (3+3)/4=1)
        // Budget = 10 - 1 = 9
        // First message from end: assistant "message two" (11 chars -> 2) + role (9->2) + 8 = 12 > 9, but it's the first so it gets pushed anyway
        let result = trim_history_to_context_budget("sys", &history, Some(10));
        // With budget 10, only the last message should fit (first one gets pushed even if over budget)
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].content, "message two");
    }

    #[test]
    fn trim_history_to_context_budget_strips_leading_tool() {
        let history = vec![
            ChatMessage { role: "tool".to_string(), content: "result".to_string(), tool_call_id: Some("id".to_string()), tool_calls: None, thinking_blocks: None },
            ChatMessage { role: "user".to_string(), content: "hi".to_string(), tool_call_id: None, tool_calls: None, thinking_blocks: None },
        ];
        let result = trim_history_to_context_budget("sys", &history, Some(1000));
        // Leading tool messages should be stripped
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].role, "user");
    }

    #[test]
    fn build_endpoint_openai() {
        assert_eq!(build_endpoint("https://api.openai.com", "v1/chat/completions", "chat/completions"), "https://api.openai.com/v1/chat/completions");
        assert_eq!(build_endpoint("https://api.openai.com/", "v1/chat/completions", "chat/completions"), "https://api.openai.com/v1/chat/completions");
        assert_eq!(build_endpoint("https://api.openai.com/v1", "v1/chat/completions", "chat/completions"), "https://api.openai.com/v1/chat/completions");
        assert_eq!(build_endpoint("https://api.openai.com/v1/chat/completions", "v1/chat/completions", "chat/completions"), "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    fn build_endpoint_anthropic() {
        assert_eq!(build_endpoint("https://api.anthropic.com", "v1/messages", "messages"), "https://api.anthropic.com/v1/messages");
        assert_eq!(build_endpoint("https://api.anthropic.com/v1", "v1/messages", "messages"), "https://api.anthropic.com/v1/messages");
    }

    #[test]
    fn anthropic_thinking_config_variants() {
        assert!(anthropic_thinking_config(Some("off"), 4096).is_none());
        assert!(anthropic_thinking_config(None, 4096).is_none());
        assert!(anthropic_thinking_config(Some("low"), 1024).is_none()); // max_tokens <= 1024
        assert!(anthropic_thinking_config(Some("invalid"), 4096).is_none());

        let low = anthropic_thinking_config(Some("low"), 4096).unwrap();
        assert_eq!(low["type"], "enabled");
        assert_eq!(low["budget_tokens"], 1024);

        let medium = anthropic_thinking_config(Some("medium"), 4096).unwrap();
        assert_eq!(medium["budget_tokens"], 2048);

        let high = anthropic_thinking_config(Some("high"), 4096).unwrap();
        // budget is capped at max_tokens - 1 = 4095
        assert_eq!(high["budget_tokens"], 4095);
    }

    #[test]
    fn process_sse_buffer_basic() {
        let mut buffer = String::from("data: hello\n\ndata: world\n\n");
        let mut received = Vec::new();
        process_sse_buffer(&mut buffer, |data| received.push(data.to_string()));
        assert_eq!(received, vec!["hello", "world"]);
        assert!(buffer.is_empty());
    }

    #[test]
    fn process_sse_buffer_partial() {
        let mut buffer = String::from("data: hello\n\npartial");
        let mut received = Vec::new();
        process_sse_buffer(&mut buffer, |data| received.push(data.to_string()));
        assert_eq!(received, vec!["hello"]);
        assert_eq!(buffer, "partial");
    }

    #[test]
    fn parse_openai_stream_event_basic() {
        let data = r#"{"choices":[{"delta":{"content":"hello"}}]}"#;
        let event = parse_openai_stream_event(data).unwrap();
        assert_eq!(event.content, Some("hello".to_string()));
        assert!(event.reasoning_content.is_none());
        assert!(event.tool_call_chunks.is_empty());
    }

    #[test]
    fn parse_openai_stream_event_with_tool_call() {
        let data = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read"}}]}}]}"#;
        let event = parse_openai_stream_event(data).unwrap();
        assert_eq!(event.tool_call_chunks.len(), 1);
        assert_eq!(event.tool_call_chunks[0].index, 0);
        assert_eq!(event.tool_call_chunks[0].name, Some("read".to_string()));
    }

    #[test]
    fn parse_anthropic_stream_event_thinking_start() {
        let data = r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}"#;
        match parse_anthropic_stream_event(data) {
            Some(AnthropicStreamEvent::ThinkingStart { index }) => assert_eq!(index, 0),
            _ => panic!("Expected ThinkingStart"),
        }
    }

    #[test]
    fn parse_anthropic_stream_event_text_delta() {
        let data = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}"#;
        match parse_anthropic_stream_event(data) {
            Some(AnthropicStreamEvent::Text(text)) => assert_eq!(text, "hello"),
            _ => panic!("Expected Text"),
        }
    }

    #[test]
    fn parse_anthropic_stream_event_tool_start() {
        let data = r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_1","name":"read"}}"#;
        match parse_anthropic_stream_event(data) {
            Some(AnthropicStreamEvent::ToolStart { index, id, name }) => {
                assert_eq!(index, 1);
                assert_eq!(id, "tool_1");
                assert_eq!(name, "read");
            }
            _ => panic!("Expected ToolStart"),
        }
    }

    #[test]
    fn parse_anthropic_stream_event_invalid() {
        assert!(parse_anthropic_stream_event("not json").is_none());
        assert!(parse_anthropic_stream_event(r#"{"type":"unknown"}"#).is_none());
    }

    #[test]
    fn openai_history_messages_basic() {
        let history = vec![
            ChatMessage { role: "user".to_string(), content: "hi".to_string(), tool_call_id: None, tool_calls: None, thinking_blocks: None },
        ];
        let messages = openai_history_messages("system prompt", &history);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], "system prompt");
        assert_eq!(messages[1]["role"], "user");
        assert_eq!(messages[1]["content"], "hi");
    }

    #[test]
    fn openai_history_messages_with_tool_calls() {
        let history = vec![
            ChatMessage {
                role: "assistant".to_string(),
                content: "".to_string(),
                tool_call_id: None,
                tool_calls: Some(vec![ChatToolCall {
                    id: "call_1".to_string(),
                    name: "read".to_string(),
                    arguments: "{}".to_string(),
                }]),
                thinking_blocks: None,
            },
            ChatMessage { role: "tool".to_string(), content: "result".to_string(), tool_call_id: Some("call_1".to_string()), tool_calls: None, thinking_blocks: None },
        ];
        let messages = openai_history_messages("sys", &history);
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[1]["role"], "assistant");
        assert!(messages[1]["tool_calls"].is_array());
        assert_eq!(messages[2]["role"], "tool");
        assert_eq!(messages[2]["tool_call_id"], "call_1");
    }

    #[test]
    fn anthropic_history_messages_basic() {
        let history = vec![
            ChatMessage { role: "user".to_string(), content: "hi".to_string(), tool_call_id: None, tool_calls: None, thinking_blocks: None },
        ];
        let messages = anthropic_history_messages(&history);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[0]["content"], "hi");
    }
}
