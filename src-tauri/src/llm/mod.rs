use serde_json::{json, Value};
use std::error::Error;

use crate::agent::parse_tool_arguments;
use crate::models::*;

pub fn approximate_token_count(text: &str) -> usize {
    text.chars().count().div_ceil(4)
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

pub struct ContextCompactionPlan {
    pub messages_to_summarize: Vec<ChatMessage>,
    pub compacted_through_message_id: Option<String>,
    pub compacted_through_index: usize,
    pub summary_style: ContextSummaryStyle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContextSummaryStyle {
    Generic,
    PartnerChat,
    StoryAgent,
}

pub const PARTNER_CHAT_AGENT_ID: &str = "partnerChat";
pub const STORY_AGENT_ID: &str = "storyAgent";
pub const STORY_DYNAMIC_AGENT_ID: &str = "storyDynamicAgent";
const DEFAULT_COMPACTION_TURN_THRESHOLD: u32 = 20;

pub fn should_compact_context(
    system_prompt: &str,
    history: &[ChatMessage],
    max_context_tokens: Option<u32>,
) -> bool {
    let Some(max_context_tokens) = max_context_tokens else {
        return false;
    };
    if max_context_tokens == 0 {
        return false;
    }
    let total = approximate_token_count(system_prompt)
        + history
            .iter()
            .map(chat_message_token_estimate)
            .sum::<usize>();
    total.saturating_mul(100) >= (max_context_tokens as usize).saturating_mul(95)
}

pub fn effective_history_with_compaction(
    history: &[ChatMessage],
    compaction: Option<&SessionContextCompaction>,
) -> Vec<ChatMessage> {
    let Some(compaction) = compaction.filter(|value| !value.summary.trim().is_empty()) else {
        return history.to_vec();
    };
    let suffix_start = compaction_boundary_suffix_start(history, compaction);
    let mut compacted = vec![ChatMessage {
        id: None,
        role: "user".to_string(),
        content: format!("【本会话早期内容已压缩】\n{}", compaction.summary.trim()),
        tool_call_id: None,
        tool_calls: None,
        thinking_blocks: None,
    }];
    compacted.extend(history.iter().skip(suffix_start).cloned());
    compacted
}

pub fn plan_context_compaction_for_agent(
    system_prompt: &str,
    history: &[ChatMessage],
    existing_compaction: Option<&SessionContextCompaction>,
    max_context_tokens: Option<u32>,
    agent_id: Option<&str>,
    compaction_turn_threshold: Option<u32>,
) -> Option<ContextCompactionPlan> {
    let effective_history = effective_history_with_compaction(history, existing_compaction);
    let reaches_context_threshold =
        should_compact_context(system_prompt, &effective_history, max_context_tokens);
    let compact_from = existing_compaction
        .map(|compaction| compaction_boundary_suffix_start(history, compaction))
        .unwrap_or(0);
    let turn_summary_style = match agent_id {
        Some(PARTNER_CHAT_AGENT_ID) => Some(ContextSummaryStyle::PartnerChat),
        Some(STORY_AGENT_ID) | Some(STORY_DYNAMIC_AGENT_ID) => {
            Some(ContextSummaryStyle::StoryAgent)
        }
        _ => None,
    };
    let turn_threshold = compaction_turn_threshold
        .filter(|value| *value >= 2)
        .unwrap_or(DEFAULT_COMPACTION_TURN_THRESHOLD);
    let turn_based_boundary = turn_summary_style
        .and_then(|_| select_turn_based_compaction_boundary(history, turn_threshold))
        .filter(|boundary| {
            *boundary >= compact_from && history.len().saturating_sub(*boundary + 1) >= 2
        });

    if !reaches_context_threshold && turn_based_boundary.is_none() {
        return None;
    }

    let (boundary, summary_style) = if let Some(boundary) = turn_based_boundary {
        (
            boundary,
            turn_summary_style.unwrap_or(ContextSummaryStyle::Generic),
        )
    } else {
        (
            select_compaction_boundary(system_prompt, history, max_context_tokens)?,
            ContextSummaryStyle::Generic,
        )
    };
    if boundary < compact_from || history.len().saturating_sub(boundary + 1) < 2 {
        return None;
    }

    let mut messages_to_summarize = Vec::new();
    if let Some(compaction) = existing_compaction.filter(|value| !value.summary.trim().is_empty()) {
        messages_to_summarize.push(ChatMessage {
            id: None,
            role: "user".to_string(),
            content: format!("【上一轮压缩摘要】\n{}", compaction.summary.trim()),
            tool_call_id: None,
            tool_calls: None,
            thinking_blocks: None,
        });
    }
    messages_to_summarize.extend(history[compact_from..=boundary].iter().cloned());

    Some(ContextCompactionPlan {
        messages_to_summarize,
        compacted_through_message_id: history[boundary].id.clone(),
        compacted_through_index: boundary,
        summary_style,
    })
}

pub fn fallback_context_summary(messages: &[ChatMessage]) -> String {
    fallback_context_summary_with_style(messages, ContextSummaryStyle::Generic)
}

pub fn fallback_context_summary_with_style(
    messages: &[ChatMessage],
    summary_style: ContextSummaryStyle,
) -> String {
    match summary_style {
        ContextSummaryStyle::PartnerChat => return fallback_partner_chat_summary(messages),
        ContextSummaryStyle::StoryAgent => return fallback_story_summary(messages),
        ContextSummaryStyle::Generic => {}
    }

    let mut user_snippets = Vec::new();
    let mut files_seen = Vec::new();
    let mut errors = Vec::new();

    for message in messages {
        let text = message.content.trim();
        if message.role == "user" && !text.is_empty() {
            user_snippets.push(truncate_for_summary_line(text, 120));
        }
        for token in text
            .split(|c: char| c.is_whitespace() || c == ',' || c == '，' || c == '：' || c == ':')
        {
            let trimmed = token.trim_matches(|c: char| {
                c == '"' || c == '\'' || c == '`' || c == '(' || c == ')' || c == '[' || c == ']'
            });
            if looks_like_file_path(trimmed) && !files_seen.iter().any(|item| item == trimmed) {
                files_seen.push(trimmed.to_string());
            }
        }
        for line in text.lines() {
            let lower = line.to_lowercase();
            if lower.contains("error") || line.contains("错误") || line.contains("失败") {
                errors.push(truncate_for_summary_line(line.trim(), 160));
            }
        }
    }

    let mut parts = Vec::new();
    if !user_snippets.is_empty() {
        parts.push(format!(
            "用户近期目标：{}",
            user_snippets
                .iter()
                .rev()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("；")
        ));
    }
    if !files_seen.is_empty() {
        parts.push(format!(
            "重要文件/路径：{}",
            files_seen
                .into_iter()
                .take(12)
                .collect::<Vec<_>>()
                .join("，")
        ));
    }
    if !errors.is_empty() {
        parts.push(format!(
            "已出现的问题：{}",
            errors.into_iter().take(5).collect::<Vec<_>>().join("；")
        ));
    }
    if parts.is_empty() {
        "压缩摘要生成失败；旧上下文中没有可稳定提取的关键信息。".to_string()
    } else {
        format!(
            "压缩摘要生成失败，以下为规则提取的关键信息：\n{}",
            parts.join("\n")
        )
    }
}

pub fn context_summary_system_prompt(summary_style: ContextSummaryStyle) -> &'static str {
    match summary_style {
        ContextSummaryStyle::Generic => concat!(
            "请把这段 MuseAI 当前会话的旧上下文压缩成简洁摘要，用中文输出。\n",
            "必须保留：用户目标、已确认要求、当前任务进度、重要文件/路径/版本、关键工具结果、已失败或被否定的方向、后续待处理问题。\n",
            "必须删除：冗长工具输出、重复寒暄、长代码全文、无关细节。\n",
            "输出只给摘要正文，不要回答用户，不要新增事实。"
        ),
        ContextSummaryStyle::PartnerChat => concat!(
            "请把这段 MuseAI 伴侣聊天的旧上下文压缩成可继续对话的中文摘要。\n",
            "必须按以下四个方面组织信息：关系状态、已发生事件、用户偏好、未解决话题。\n",
            "必须保留会影响后续相处的情绪变化、称呼、承诺、边界、共同经历和用户明确表达的喜好。\n",
            "必须删除重复寒暄、重复安抚、重复动作描写和没有新增信息的闲聊。\n",
            "输出只给摘要正文，不要回答用户，不要新增事实。"
        ),
        ContextSummaryStyle::StoryAgent => concat!(
            "请把这段 MuseAI 跑团/文字冒险的旧上下文压缩成可继续推进剧情的中文摘要。\n",
            "必须按以下四个方面组织信息：当前剧情进度、世界与 NPC 状态、角色关系变化、未解决的伏笔与悬念。\n",
            "必须保留关键选择、因果后果、场景位置、阵营变化、NPC 目标、道具线索和影响后续冒险的承诺或冲突。\n",
            "必须删除冗长旁白、重复场景描写、重复动作描写和没有新增信息的气氛渲染。\n",
            "输出只给摘要正文，不要回答用户，不要新增事实。"
        ),
    }
}

fn fallback_partner_chat_summary(messages: &[ChatMessage]) -> String {
    let mut user_snippets = Vec::new();
    let mut assistant_snippets = Vec::new();
    for message in messages {
        let text = message.content.trim();
        if text.is_empty() {
            continue;
        }
        if message.role == "user" {
            user_snippets.push(truncate_for_summary_line(text, 120));
        } else if message.role == "assistant" {
            assistant_snippets.push(truncate_for_summary_line(text, 120));
        }
    }

    let recent_user = user_snippets
        .iter()
        .rev()
        .take(3)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("；");
    let recent_assistant = assistant_snippets
        .iter()
        .rev()
        .take(2)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("；");

    format!(
        "关系状态：压缩摘要生成失败；请根据最近原文继续保持既有人设和关系氛围。\n已发生事件：{}。\n用户偏好：{}。\n未解决话题：继续回应用户最近提出但尚未完全解决的内容。",
        if recent_assistant.is_empty() {
            "旧上下文没有可稳定提取的角色回应".to_string()
        } else {
            recent_assistant
        },
        if recent_user.is_empty() {
            "旧上下文没有可稳定提取的用户偏好".to_string()
        } else {
            recent_user
        }
    )
}

fn fallback_story_summary(messages: &[ChatMessage]) -> String {
    let mut user_snippets = Vec::new();
    let mut assistant_snippets = Vec::new();
    for message in messages {
        let text = message.content.trim();
        if text.is_empty() {
            continue;
        }
        if message.role == "user" {
            user_snippets.push(truncate_for_summary_line(text, 120));
        } else if message.role == "assistant" {
            assistant_snippets.push(truncate_for_summary_line(text, 120));
        }
    }

    let recent_user = user_snippets
        .iter()
        .rev()
        .take(3)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("；");
    let recent_assistant = assistant_snippets
        .iter()
        .rev()
        .take(2)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("；");

    format!(
        "当前剧情进度：{}。\n世界与 NPC 状态：压缩摘要生成失败；请根据最近原文保持已建立的世界状态与 NPC 行动逻辑。\n角色关系变化：{}。\n未解决的伏笔与悬念：继续承接用户最近选择造成的后果与尚未揭开的线索。",
        if recent_assistant.is_empty() {
            "旧上下文没有可稳定提取的剧情进展".to_string()
        } else {
            recent_assistant
        },
        if recent_user.is_empty() {
            "旧上下文没有可稳定提取的角色互动".to_string()
        } else {
            recent_user
        }
    )
}

fn select_turn_based_compaction_boundary(history: &[ChatMessage], threshold: u32) -> Option<usize> {
    let user_turns = history
        .iter()
        .filter(|message| message.role.as_str() == "user")
        .count();
    if user_turns <= threshold.max(2) as usize {
        return None;
    }

    let mut retained_user_turns = 0usize;
    for index in (0..history.len()).rev() {
        if history[index].role == "user" {
            retained_user_turns += 1;
            if retained_user_turns == 5 {
                return index.checked_sub(1);
            }
        }
    }
    None
}

fn select_compaction_boundary(
    system_prompt: &str,
    history: &[ChatMessage],
    max_context_tokens: Option<u32>,
) -> Option<usize> {
    let max_context_tokens = max_context_tokens? as usize;
    if history.len() < 6 {
        return None;
    }
    let system_cost = approximate_token_count(system_prompt);
    let recent_budget = max_context_tokens
        .saturating_mul(35)
        .checked_div(100)
        .unwrap_or(0)
        .saturating_sub(system_cost);
    if recent_budget == 0 {
        return None;
    }

    let mut start = history.len();
    let mut total = 0usize;
    for (kept, index) in (0..history.len()).rev().enumerate() {
        let cost = chat_message_token_estimate(&history[index]);
        if kept >= 4 && total + cost > recent_budget {
            break;
        }
        total += cost;
        start = index;
    }
    if start == 0 || start >= history.len() {
        return None;
    }
    while start > 0 && history[start].role == "tool" {
        start -= 1;
    }
    if start == 0 {
        return None;
    }
    Some(start - 1)
}

fn compaction_boundary_suffix_start(
    history: &[ChatMessage],
    compaction: &SessionContextCompaction,
) -> usize {
    if let Some(id) = compaction
        .compacted_through_message_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
    {
        if let Some(index) = history
            .iter()
            .position(|message| message.id.as_deref() == Some(id))
        {
            return (index + 1).min(history.len());
        }
    }
    (compaction.compacted_through_index + 1).min(history.len())
}

fn looks_like_file_path(value: &str) -> bool {
    if value.len() < 3 || value.len() > 180 || !value.contains('.') {
        return false;
    }
    value.contains('/')
        || value.ends_with(".md")
        || value.ends_with(".rs")
        || value.ends_with(".tsx")
        || value.ends_with(".ts")
        || value.ends_with(".json")
}

fn truncate_for_summary_line(value: &str, max_chars: usize) -> String {
    let mut result: String = value.chars().take(max_chars).collect();
    if value.chars().count() > max_chars {
        result.push_str("...");
    }
    result
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
                                if obj.get("type").and_then(Value::as_str)
                                    == Some("redacted_thinking")
                                {
                                    content.push(block.clone());
                                } else {
                                    let mut thinking_block = serde_json::Map::new();
                                    thinking_block.insert("type".to_string(), json!("thinking"));
                                    if let Some(thinking) = obj
                                        .get("content")
                                        .or_else(|| obj.get("thinking"))
                                        .and_then(Value::as_str)
                                    {
                                        thinking_block
                                            .insert("thinking".to_string(), json!(thinking));
                                    }
                                    if let Some(signature) =
                                        obj.get("signature").and_then(Value::as_str)
                                    {
                                        thinking_block
                                            .insert("signature".to_string(), json!(signature));
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

pub fn format_response_read_error(context: &str, error: &(dyn Error + 'static)) -> String {
    let mut details = Vec::new();
    let mut current = Some(error);
    while let Some(item) = current {
        let message = item.to_string();
        if !message.is_empty() && !details.contains(&message) {
            details.push(message);
        }
        current = item.source();
    }
    if details.is_empty() {
        context.to_string()
    } else {
        format!("{}：{}", context, details.join("；"))
    }
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
    let finish_reason = choice
        .get("finish_reason")
        .and_then(Value::as_str)
        .map(String::from);

    Some(OpenAiStreamEvent {
        content,
        reasoning_content,
        tool_call_chunks,
        finish_reason,
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
        "message_delta" => {
            let delta = value.get("delta")?;
            let stop_reason = delta
                .get("stop_reason")
                .and_then(Value::as_str)
                .map(String::from);
            Some(AnthropicStreamEvent::MessageDelta { stop_reason })
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
    use std::error::Error;
    use std::fmt;

    #[derive(Debug)]
    struct ChainedTestError {
        message: &'static str,
        source: Option<Box<dyn Error + Send + Sync>>,
    }

    impl fmt::Display for ChainedTestError {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str(self.message)
        }
    }

    impl Error for ChainedTestError {
        fn source(&self) -> Option<&(dyn Error + 'static)> {
            self.source
                .as_deref()
                .map(|source| source as &(dyn Error + 'static))
        }
    }

    fn msg(id: &str, role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            id: Some(id.to_string()),
            role: role.to_string(),
            content: content.to_string(),
            tool_call_id: None,
            tool_calls: None,
            thinking_blocks: None,
        }
    }

    fn tool_result(id: &str, call_id: &str, content: &str) -> ChatMessage {
        ChatMessage {
            id: Some(id.to_string()),
            role: "tool".to_string(),
            content: content.to_string(),
            tool_call_id: Some(call_id.to_string()),
            tool_calls: None,
            thinking_blocks: None,
        }
    }

    #[test]
    fn format_response_read_error_keeps_context_and_unique_source_chain() {
        let error = ChainedTestError {
            message: "error decoding response body",
            source: Some(Box::new(ChainedTestError {
                message: "error decoding response body",
                source: Some(Box::new(ChainedTestError {
                    message: "connection reset by peer",
                    source: None,
                })),
            })),
        };

        let message = format_response_read_error("读取 OpenAI 兼容流式响应失败", &error);

        assert!(message.starts_with("读取 OpenAI 兼容流式响应失败："));
        assert!(message.contains("error decoding response body"));
        assert!(message.contains("connection reset by peer"));
        assert_eq!(message.matches("error decoding response body").count(), 1);
    }

    fn partner_chat_pairs(count: usize) -> Vec<ChatMessage> {
        let mut history = Vec::new();
        for index in 1..=count {
            history.push(msg(
                &format!("u{}", index),
                "user",
                &format!("user turn {}", index),
            ));
            history.push(msg(
                &format!("a{}", index),
                "assistant",
                &format!("assistant turn {}", index),
            ));
        }
        history
    }

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
            id: None,
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
            id: None,
            role: "assistant".to_string(),
            content: "ok".to_string(),
            tool_call_id: None,
            tool_calls: Some(vec![ChatToolCall {
                id: "call_1".to_string(),
                name: "read".to_string(),
                arguments: "{\"file_path\": \"test.md\"}".to_string(),
            }]),
            thinking_blocks: None,
        };
        let estimate = chat_message_token_estimate(&msg);
        // role (9->3) + content (2->1) + tool_call_id(0) + tool_calls(call_1(6->2) + read(4->1) + args(24->6)) + 8 = 3+1+0+2+1+6+8 = 21
        assert_eq!(estimate, 21);
    }

    #[test]
    fn trim_history_to_context_budget_no_budget() {
        let history = vec![msg("u1", "user", "hi")];
        let result = trim_history_to_context_budget("system", &history, None);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn trim_history_to_context_budget_zero() {
        let history = vec![msg("u1", "user", "hi")];
        let result = trim_history_to_context_budget("system", &history, Some(1));
        assert!(result.is_empty());
    }

    #[test]
    fn trim_history_to_context_budget_trims() {
        let history = vec![
            msg("u1", "user", "message one"),
            msg("a1", "assistant", "message two"),
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
        let history = vec![tool_result("t1", "id", "result"), msg("u1", "user", "hi")];
        let result = trim_history_to_context_budget("sys", &history, Some(1000));
        // Leading tool messages should be stripped
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].role, "user");
    }

    #[test]
    fn build_endpoint_openai() {
        assert_eq!(
            build_endpoint(
                "https://api.openai.com",
                "v1/chat/completions",
                "chat/completions"
            ),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            build_endpoint(
                "https://api.openai.com/",
                "v1/chat/completions",
                "chat/completions"
            ),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            build_endpoint(
                "https://api.openai.com/v1",
                "v1/chat/completions",
                "chat/completions"
            ),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            build_endpoint(
                "https://api.openai.com/v1/chat/completions",
                "v1/chat/completions",
                "chat/completions"
            ),
            "https://api.openai.com/v1/chat/completions"
        );
    }

    #[test]
    fn build_endpoint_anthropic() {
        assert_eq!(
            build_endpoint("https://api.anthropic.com", "v1/messages", "messages"),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            build_endpoint("https://api.anthropic.com/v1", "v1/messages", "messages"),
            "https://api.anthropic.com/v1/messages"
        );
    }

    #[test]
    fn should_compact_context_uses_95_percent_threshold() {
        let history = vec![
            msg("u1", "user", &"a".repeat(120)),
            msg("a1", "assistant", &"b".repeat(120)),
        ];

        assert!(!should_compact_context("", &history, Some(100)));
        assert!(should_compact_context("", &history, Some(80)));
    }

    #[test]
    fn non_partner_chat_plan_ignores_turn_count_below_context_threshold() {
        let history = partner_chat_pairs(21);

        let plan = plan_context_compaction_for_agent(
            "",
            &history,
            None,
            Some(100_000),
            Some("writer"),
            None,
        );

        assert!(plan.is_none());
    }

    #[test]
    fn partner_chat_plan_compacts_after_configured_turn_threshold() {
        let history = partner_chat_pairs(13);

        let plan = plan_context_compaction_for_agent(
            "",
            &history,
            None,
            Some(100_000),
            Some(PARTNER_CHAT_AGENT_ID),
            Some(12),
        )
        .unwrap();

        assert_eq!(plan.summary_style, ContextSummaryStyle::PartnerChat);
        assert_eq!(plan.compacted_through_message_id.as_deref(), Some("a8"));
    }

    #[test]
    fn partner_chat_turn_compaction_keeps_latest_five_turns_raw() {
        let history = partner_chat_pairs(21);
        let plan = plan_context_compaction_for_agent(
            "",
            &history,
            None,
            Some(100_000),
            Some(PARTNER_CHAT_AGENT_ID),
            None,
        )
        .unwrap();
        let compaction = SessionContextCompaction {
            summary: "关系状态：稳定\n已发生事件：旧事\n用户偏好：慢聊\n未解决话题：继续"
                .to_string(),
            compacted_through_message_id: plan.compacted_through_message_id,
            compacted_through_index: plan.compacted_through_index,
            source_message_count: history.len(),
            updated_at: 1,
        };

        let effective = effective_history_with_compaction(&history, Some(&compaction));

        assert_eq!(effective[1].id.as_deref(), Some("u17"));
        assert_eq!(
            effective.last().and_then(|message| message.id.as_deref()),
            Some("a21")
        );
        assert_eq!(
            effective
                .iter()
                .filter(|message| message.role.as_str() == "user")
                .count(),
            6
        );
    }

    #[test]
    fn partner_chat_turn_count_only_counts_user_messages() {
        let mut history = partner_chat_pairs(20);
        history.push(msg("extra-assistant", "assistant", "still not a user turn"));

        let plan = plan_context_compaction_for_agent(
            "",
            &history,
            None,
            Some(100_000),
            Some(PARTNER_CHAT_AGENT_ID),
            None,
        );

        assert!(plan.is_none());
    }

    #[test]
    fn story_agents_use_turn_based_compaction_with_story_summary_style() {
        for agent_id in [STORY_AGENT_ID, STORY_DYNAMIC_AGENT_ID] {
            let history = partner_chat_pairs(16);
            let plan = plan_context_compaction_for_agent(
                "",
                &history,
                None,
                Some(100_000),
                Some(agent_id),
                Some(15),
            )
            .unwrap();

            assert_eq!(plan.summary_style, ContextSummaryStyle::StoryAgent);
            assert_eq!(plan.compacted_through_message_id.as_deref(), Some("a11"));
        }
    }

    #[test]
    fn story_dynamic_turn_count_ignores_tool_and_assistant_messages() {
        let mut history = partner_chat_pairs(18);
        history.push(msg("assistant-extra", "assistant", "旁白继续"));
        history.push(tool_result("tool-extra", "role_play_1", "角色发言"));

        let plan = plan_context_compaction_for_agent(
            "",
            &history,
            None,
            Some(100_000),
            Some(STORY_DYNAMIC_AGENT_ID),
            Some(20),
        );

        assert!(plan.is_none());
    }

    #[test]
    fn turn_threshold_defaults_to_twenty_when_missing_or_too_small() {
        for threshold in [None, Some(0), Some(1)] {
            let history = partner_chat_pairs(21);
            let plan = plan_context_compaction_for_agent(
                "",
                &history,
                None,
                Some(100_000),
                Some(PARTNER_CHAT_AGENT_ID),
                threshold,
            )
            .unwrap();

            assert_eq!(plan.compacted_through_message_id.as_deref(), Some("a16"));
        }
    }

    #[test]
    fn turn_threshold_does_not_compact_below_configured_value() {
        let history = partner_chat_pairs(25);
        let plan = plan_context_compaction_for_agent(
            "",
            &history,
            None,
            Some(100_000),
            Some(PARTNER_CHAT_AGENT_ID),
            Some(30),
        );

        assert!(plan.is_none());
    }

    #[test]
    fn partner_chat_summary_prompt_uses_companion_sections() {
        let prompt = context_summary_system_prompt(ContextSummaryStyle::PartnerChat);

        assert!(prompt.contains("关系状态"));
        assert!(prompt.contains("已发生事件"));
        assert!(prompt.contains("用户偏好"));
        assert!(prompt.contains("未解决话题"));
    }

    #[test]
    fn story_summary_prompt_and_fallback_are_story_oriented() {
        let prompt = context_summary_system_prompt(ContextSummaryStyle::StoryAgent);
        let summary = fallback_context_summary_with_style(
            &[
                msg("u1", "user", "我决定进入旧钟楼寻找失踪的妹妹"),
                msg("a1", "assistant", "钟楼里传来脚步声，守夜人提到银钥匙"),
            ],
            ContextSummaryStyle::StoryAgent,
        );

        assert!(prompt.contains("当前剧情进度"));
        assert!(prompt.contains("世界与 NPC 状态"));
        assert!(prompt.contains("未解决的伏笔与悬念"));
        assert!(summary.contains("当前剧情进度"));
        assert!(summary.contains("世界与 NPC 状态"));
        assert!(summary.contains("未解决的伏笔与悬念"));
    }

    #[test]
    fn plan_context_compaction_keeps_tool_pair_together() {
        let mut assistant_tool = msg("a-tool", "assistant", "");
        assistant_tool.tool_calls = Some(vec![ChatToolCall {
            id: "call_1".to_string(),
            name: "read".to_string(),
            arguments: "{}".to_string(),
        }]);
        let history = vec![
            msg("u1", "user", &"a".repeat(120)),
            msg("a1", "assistant", &"b".repeat(120)),
            msg("u2", "user", &"c".repeat(120)),
            assistant_tool,
            tool_result("tool-1", "call_1", &"tool output".repeat(20)),
            msg("u3", "user", "continue"),
            msg("a3", "assistant", "ok"),
        ];

        let plan =
            plan_context_compaction_for_agent("", &history, None, Some(140), None, None).unwrap();
        let compacted = SessionContextCompaction {
            summary: "摘要".to_string(),
            compacted_through_message_id: plan.compacted_through_message_id,
            compacted_through_index: plan.compacted_through_index,
            source_message_count: history.len(),
            updated_at: 1,
        };
        let effective = effective_history_with_compaction(&history, Some(&compacted));

        assert_ne!(
            effective.get(1).map(|message| message.role.as_str()),
            Some("tool")
        );
        assert!(plan.compacted_through_index < history.len() - 1);
    }

    #[test]
    fn effective_history_uses_existing_compaction_summary_and_recent_messages() {
        let history = vec![
            msg("u1", "user", "old"),
            msg("a1", "assistant", "old answer"),
            msg("u2", "user", "recent"),
        ];
        let compaction = SessionContextCompaction {
            summary: "旧内容摘要".to_string(),
            compacted_through_message_id: Some("a1".to_string()),
            compacted_through_index: 1,
            source_message_count: 3,
            updated_at: 1,
        };

        let effective = effective_history_with_compaction(&history, Some(&compaction));

        assert_eq!(effective.len(), 2);
        assert!(effective[0].content.contains("旧内容摘要"));
        assert_eq!(effective[1].id.as_deref(), Some("u2"));
    }

    #[test]
    fn repeated_compaction_includes_previous_summary_and_new_messages() {
        let history = vec![
            msg("u1", "user", &"a".repeat(120)),
            msg("a1", "assistant", &"b".repeat(120)),
            msg("u2", "user", &"c".repeat(120)),
            msg("a2", "assistant", &"d".repeat(120)),
            msg("u3", "user", &"e".repeat(120)),
            msg("a3", "assistant", &"f".repeat(120)),
            msg("u4", "user", "recent"),
            msg("a4", "assistant", "ok"),
        ];
        let existing = SessionContextCompaction {
            summary: "第一轮摘要".to_string(),
            compacted_through_message_id: Some("a1".to_string()),
            compacted_through_index: 1,
            source_message_count: 6,
            updated_at: 1,
        };

        let plan =
            plan_context_compaction_for_agent("", &history, Some(&existing), Some(140), None, None)
                .unwrap();

        assert!(plan.messages_to_summarize[0].content.contains("第一轮摘要"));
        assert_eq!(plan.messages_to_summarize[1].id.as_deref(), Some("u2"));
        assert!(plan.compacted_through_index > existing.compacted_through_index);
    }

    #[test]
    fn fallback_context_summary_extracts_files_errors_and_user_intent() {
        let history = vec![
            msg("u1", "user", "请修改 /tmp/story.md，并注意前面确认过的风格"),
            msg("a1", "assistant", "Error: failed to read src/main.rs"),
        ];

        let summary = fallback_context_summary(&history);

        assert!(summary.contains("/tmp/story.md"));
        assert!(summary.contains("src/main.rs"));
        assert!(summary.contains("Error"));
        assert!(summary.contains("用户近期目标"));
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
        let data =
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read"}}]}}]}"#;
        let event = parse_openai_stream_event(data).unwrap();
        assert_eq!(event.tool_call_chunks.len(), 1);
        assert_eq!(event.tool_call_chunks[0].index, 0);
        assert_eq!(event.tool_call_chunks[0].name, Some("read".to_string()));
    }

    #[test]
    fn parse_anthropic_stream_event_thinking_start() {
        let data =
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}"#;
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
        let history = vec![msg("u1", "user", "hi")];
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
                id: Some("a1".to_string()),
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
            tool_result("t1", "call_1", "result"),
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
        let history = vec![msg("u1", "user", "hi")];
        let messages = anthropic_history_messages(&history);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[0]["content"], "hi");
    }
}
