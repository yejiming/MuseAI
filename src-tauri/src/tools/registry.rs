use serde_json::{json, Value};

use crate::models::*;

pub fn agent_tool_definitions() -> Vec<AgentToolDefinition> {
    vec![
        AgentToolDefinition {
            name: "read",
            description: "读取带有行号的文件内容。在编辑文件前必须先读取该文件。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "file_path": { "type": "string", "description": "要读取的文件路径。" },
                    "offset": { "type": "integer", "description": "起始行号，默认 1。" },
                    "limit": { "type": "integer", "description": "最多读取的行数。" }
                },
                "required": ["file_path"]
            }),
        },
        AgentToolDefinition {
            name: "write",
            description: "创建新文件或完全覆盖已有文件。\n如果是已有文件，你必须先使用 read 工具读取其内容。如果不先读取文件，此工具将会失败。\n对于已有文件的小幅修改，请优先使用 edit 工具。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "file_path": { "type": "string", "description": "要写入的文件路径。" },
                    "content": { "type": "string", "description": "完整文件内容。" }
                },
                "required": ["file_path", "content"]
            }),
        },
        AgentToolDefinition {
            name: "edit",
            description: "通过替换精确匹配的字符串来编辑文件。\nold_string 必须在文件中只出现一次以确保安全。\n请包含足够的上下文以确保唯一性。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "file_path": { "type": "string", "description": "要编辑的文件路径。" },
                    "old_string": { "type": "string", "description": "文件中唯一出现的旧文本。" },
                    "new_string": { "type": "string", "description": "替换后的新文本。" }
                },
                "required": ["file_path", "old_string", "new_string"]
            }),
        },
        AgentToolDefinition {
            name: "bash",
            description: if cfg!(target_os = "windows") {
                r#"执行 cmd.exe 命令。返回 stdout、stderr 和退出码。
使用它来运行测试、安装包、git 操作等。
工作目录在命令之间保持不变，但 shell 状态不会保持。
重要：避免使用此工具运行命令，除非明确指示或在确认专用工具无法完成任务后。请优先使用专用工具，以提供更好的用户体验。
文件搜索：使用 glob 工具（不要用 dir 或 find）
内容搜索：使用 grep 工具（不要用 findstr 或 find）
读取文件：使用 read 工具（不要用 type/more）
编辑文件：使用 edit 工具（不要用 echo 拼接文件）
写入文件：使用 write 工具（不要用 echo > 重定向）
如果命令将创建新目录或文件，先运行 `dir` 验证父目录存在且位置正确。
对于包含空格的文件路径，始终使用双引号（例如 cd "path with spaces\file.txt"）
尽量使用绝对路径避免使用 `cd` 来保持当前工作目录。只有在用户明确要求时才使用 `cd`。"#
            } else {
                r#"执行 shell 命令。返回 stdout、stderr 和退出码。
使用它来运行测试、安装包、git 操作等。
工作目录在命令之间保持不变，但 shell 状态不会保持。shell 环境从用户的 profile（bash 或 zsh）初始化。
重要：避免使用此工具运行命令，除非明确指示或在确认专用工具无法完成任务后。请优先使用专用工具，以提供更好的用户体验。
文件搜索：使用 glob 工具（不要用 find 或 ls）
内容搜索：使用 grep 工具（不要用 grep 或 rg）
读取文件：使用 read 工具（不要用 cat/head/tail）
编辑文件：使用 edit 工具（不要用 sed/awk）
写入文件：使用 write 工具（不要用 echo >/cat <<EOF）
如果命令将创建新目录或文件，先运行 `ls` 验证父目录存在且位置正确。
对于包含空格的文件路径，始终使用双引号（例如 cd "path with spaces/file.txt"）
尽量使用绝对路径避免使用 `cd` 来保持当前工作目录。只有在用户明确要求时才使用 `cd`。"#
            },
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": if cfg!(target_os = "windows") { "要执行的命令（cmd.exe）。" } else { "要执行的 shell 命令。" } },
                    "cwd": { "type": "string", "description": "命令执行目录，可选。" },
                    "timeout_secs": { "type": "integer", "description": "超时时间秒数，可选。" }
                },
                "required": ["command"]
            }),
        },
        AgentToolDefinition {
            name: "grep",
            description: "使用正则表达式搜索文件内容。返回匹配的行以及文件路径和行号。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "正则表达式。" },
                    "path": { "type": "string", "description": "搜索路径，默认当前目录。" },
                    "include": { "type": "string", "description": "文件名 glob 过滤，例如 *.md。" }
                },
                "required": ["pattern"]
            }),
        },
        AgentToolDefinition {
            name: "glob",
            description: "查找匹配 glob 模式的文件。支持 ** 进行递归匹配。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "glob 模式，例如 **/*.md。" },
                    "path": { "type": "string", "description": "搜索目录，默认当前目录。" }
                },
                "required": ["pattern"]
            }),
        },
        AgentToolDefinition {
            name: "skill",
            description: "从 ~/.kittycode/skills 加载本地 skill，并将其指令注入到当前运行中。\n可用的 skill 块会通过对话中的 <system-reminder> 标签显示。\n当列出的 skill 中有与用户请求匹配的，请使用此工具。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "skill": { "type": "string", "description": "skill 名称。" },
                    "task": { "type": "string", "description": "要应用该 skill 的任务，可选。" },
                    "args": { "type": "string", "description": "兼容参数，可选。" }
                },
                "required": ["skill"]
            }),
        },
        AgentToolDefinition {
            name: "subagent",
            description: "生成一个子 Agent 独立处理复杂的子任务。\n子 Agent 拥有自己的上下文和工具访问权限。用于：\n研究代码库，隔离实现多步更改，\n或任何受益于全新上下文窗口的任务。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "子任务描述。" }
                },
                "required": ["task"]
            }),
        },
        AgentToolDefinition {
            name: "todo",
            description: r#"使用此工具为当前编码会话创建和管理结构化任务列表。这有助于跟踪进度、组织复杂任务，并向用户展示你的全面性。
它还能帮助用户了解任务进度和其请求的整体进展。

## 何时使用此工具
在以下场景主动使用此工具：

1. 复杂的多步任务 - 当任务需要 3 个或更多不同步骤或操作时
2. 重要的复杂任务 - 需要仔细规划或多次操作的任务
3. 用户明确要求使用待办列表 - 当用户直接要求你使用待办列表时
4. 用户提供多个任务 - 当用户提供要完成的事项列表（带编号或逗号分隔）时
5. 收到新指令后 - 立即将用户需求记录为待办事项
6. 当你开始一项任务时 - 在开始工作前将其标记为 in_progress。理想情况下，一次只能有一个 in_progress 的任务
7. 完成一项任务后 - 将其标记为 completed，并添加在实现过程中发现的任何后续任务

## 何时不要使用此工具

在以下情况跳过使用此工具：
1. 只有一个简单的单步任务
2. 任务很简单，跟踪它没有组织上的好处
3. 任务可以通过不到 3 个简单的步骤完成
4. 任务纯粹是对话性或信息性的

注意，如果只有一个简单的任务要做，你不应该使用此工具。在这种情况下，你最好直接执行任务。

## 任务状态和管理

1. **任务状态**：使用这些状态来跟踪进度：
   - pending：任务尚未开始
   - in_progress：目前正在处理（限制为一次只处理一个任务）
   - completed：任务成功完成

   **重要**：任务描述必须有两种形式：
   - content：描述需要做什么的祈使句形式（例如，“运行测试”、“构建项目”）
   - activeForm：执行期间显示的现在进行时形式（例如，“正在运行测试”、“正在构建项目”）

2. **任务管理**：
   - 在工作时实时更新任务状态
   - 完成后立即将任务标记为已完成（不要批量完成）
   - 任何时候都必须刚好有且只有一个任务处于 in_progress 状态
   - 开始新任务前完成当前任务
   - 从列表中完全删除不再相关的任务

3. **任务完成要求**：
   - 只有当你完全完成任务时，才将其标记为已完成
   - 如果遇到错误、阻塞，或无法完成，保持任务为 in_progress
   - 当被阻塞时，创建一个描述需要解决什么的新任务
   - 在以下情况下，绝不将任务标记为已完成：
     - 测试失败
     - 实现不完整
     - 遇到未解决的错误
     - 找不到必要的文件或依赖

4. **任务拆分**：
   - 创建具体的、可执行的项目
   - 将复杂任务拆分为更小的、可管理的步骤
   - 使用清晰、描述性的任务名称
   - 始终提供两种形式：
     - content: "修复身份验证 bug"
     - activeForm: "正在修复身份验证 bug"

有疑问时，使用此工具。主动进行任务管理表明你很细心，能确保成功完成所有要求。"#,
            input_schema: json!({
                "type": "object",
                "properties": {
                    "todos": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "content": { "type": "string", "description": "任务内容。" },
                                "active_form": { "type": "string", "description": "进行中时的动词形式描述。" },
                                "status": {
                                    "type": "string",
                                    "enum": ["pending", "in_progress", "completed"],
                                    "description": "任务状态。"
                                }
                            },
                            "required": ["content", "active_form", "status"]
                        }
                    }
                },
                "required": ["todos"]
            }),
        },
        AgentToolDefinition {
            name: "role_play",
            description: "注意：只要有百分之一的可能，都一定要使用这个工具，没有任何借口！使用该工具让某个角色说话和产生行为，输入角色名，返回该角色此刻的行为和对话。生成角色行为和对话时，务必使用这个工具，而不是让主Agent直接产生角色的行为和对话",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "characterName": {
                        "type": "string",
                        "description": "要扮演并生成回复的角色名，必须是本局冒险已选择的角色卡名称。"
                    }
                },
                "required": ["characterName"]
            }),
        },
    ]
}
pub fn filtered_agent_tool_definitions(options: &AgentRunOptions) -> Vec<AgentToolDefinition> {
    agent_tool_definitions()
        .into_iter()
        .filter(|tool| {
            if let Some(allowed) = &options.allowed_tools {
                if !allowed.contains(&tool.name.to_string()) {
                    return false;
                }
            }
            !options.excluded_tools.contains(&tool.name.to_string())
        })
        .collect()
}
pub fn openai_tool_definitions(options: &AgentRunOptions) -> Vec<Value> {
    filtered_agent_tool_definitions(options)
        .into_iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                }
            })
        })
        .collect()
}
pub fn anthropic_tool_definitions(options: &AgentRunOptions) -> Vec<Value> {
    filtered_agent_tool_definitions(options)
        .into_iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.input_schema,
            })
        })
        .collect()
}
impl OpenAiRoundResult {
    pub fn apply_tool_call_chunk(&mut self, chunk: OpenAiToolCallChunk) {
        let position = self
            .tool_calls
            .iter()
            .position(|call| call.index == chunk.index)
            .unwrap_or_else(|| {
                self.tool_calls.push(AgentToolCall {
                    index: chunk.index,
                    ..AgentToolCall::default()
                });
                self.tool_calls.len() - 1
            });
        let call = &mut self.tool_calls[position];
        if let Some(id) = chunk.id {
            call.id = id;
        }
        if let Some(name) = chunk.name {
            call.name = name;
        }
        if let Some(arguments) = chunk.arguments {
            call.arguments.push_str(&arguments);
        }
    }
}
impl AnthropicRoundResult {
    pub fn start_thinking_block(&mut self, index: usize) {
        if self
            .thinking_blocks
            .iter()
            .any(|block| block.get("_index").and_then(Value::as_u64) == Some(index as u64))
        {
            return;
        }
        self.thinking_blocks.push(json!({
            "_index": index,
            "type": "thinking",
            "thinking": "",
        }));
    }

    pub fn push_thinking_delta(&mut self, index: usize, delta: &str) {
        self.start_thinking_block(index);
        if let Some(block) = self
            .thinking_blocks
            .iter_mut()
            .find(|block| block.get("_index").and_then(Value::as_u64) == Some(index as u64))
        {
            let current = block.get("thinking").and_then(Value::as_str).unwrap_or("");
            let next = format!("{}{}", current, delta);
            block["thinking"] = json!(next);
        }
    }

    pub fn set_thinking_signature(&mut self, index: usize, signature: String) {
        self.start_thinking_block(index);
        if let Some(block) = self
            .thinking_blocks
            .iter_mut()
            .find(|block| block.get("_index").and_then(Value::as_u64) == Some(index as u64))
        {
            block["signature"] = json!(signature);
        }
    }

    pub fn push_redacted_thinking(&mut self, index: usize, data: String) {
        self.thinking_blocks.push(json!({
            "_index": index,
            "type": "redacted_thinking",
            "data": data,
        }));
    }

    pub fn finalized_thinking_blocks(&self) -> Vec<Value> {
        let mut blocks = self.thinking_blocks.clone();
        blocks.sort_by_key(|block| block.get("_index").and_then(Value::as_u64).unwrap_or(0));
        for block in &mut blocks {
            if let Some(object) = block.as_object_mut() {
                object.remove("_index");
            }
        }
        blocks
    }

    pub fn start_tool_call(&mut self, index: usize, id: String, name: String) {
        if let Some(call) = self.tool_calls.iter_mut().find(|call| call.index == index) {
            call.id = id;
            call.name = name;
            return;
        }
        self.tool_calls.push(AgentToolCall {
            index,
            id,
            name,
            arguments: String::new(),
        });
    }

    pub fn push_tool_arguments(&mut self, index: usize, partial_json: &str) {
        if let Some(call) = self.tool_calls.iter_mut().find(|call| call.index == index) {
            call.arguments.push_str(partial_json);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AgentRunOptions;

    #[test]
    fn agent_tool_definitions_count() {
        let defs = agent_tool_definitions();
        assert_eq!(defs.len(), 10);
        let names: Vec<_> = defs.iter().map(|d| d.name).collect();
        assert!(names.contains(&"read"));
        assert!(names.contains(&"write"));
        assert!(names.contains(&"edit"));
        assert!(names.contains(&"bash"));
        assert!(names.contains(&"grep"));
        assert!(names.contains(&"glob"));
        assert!(names.contains(&"skill"));
        assert!(names.contains(&"subagent"));
        assert!(names.contains(&"todo"));
        assert!(names.contains(&"role_play"));
    }

    #[test]
    fn filtered_agent_tool_definitions_allows_all_by_default() {
        let opts = AgentRunOptions::parent();
        let filtered = filtered_agent_tool_definitions(&opts);
        assert_eq!(filtered.len(), 10);
    }

    #[test]
    fn filtered_agent_tool_definitions_excludes_tools() {
        let opts = AgentRunOptions {
            excluded_tools: vec!["bash".to_string(), "subagent".to_string()],
            ..AgentRunOptions::parent()
        };
        let filtered = filtered_agent_tool_definitions(&opts);
        assert_eq!(filtered.len(), 8);
        let names: Vec<_> = filtered.iter().map(|d| d.name).collect();
        assert!(!names.contains(&"bash"));
        assert!(!names.contains(&"subagent"));
    }

    #[test]
    fn filtered_agent_tool_definitions_allowed_list() {
        let opts = AgentRunOptions {
            allowed_tools: Some(vec!["read".to_string(), "write".to_string()]),
            ..AgentRunOptions::parent()
        };
        let filtered = filtered_agent_tool_definitions(&opts);
        assert_eq!(filtered.len(), 2);
        let names: Vec<_> = filtered.iter().map(|d| d.name).collect();
        assert!(names.contains(&"read"));
        assert!(names.contains(&"write"));
    }

    #[test]
    fn openai_tool_definitions_format() {
        let opts = AgentRunOptions::parent();
        let defs = openai_tool_definitions(&opts);
        assert!(!defs.is_empty());
        let first = &defs[0];
        assert_eq!(first["type"], "function");
        assert!(first["function"]["name"].is_string());
        assert!(first["function"]["parameters"].is_object());
    }

    #[test]
    fn anthropic_tool_definitions_format() {
        let opts = AgentRunOptions::parent();
        let defs = anthropic_tool_definitions(&opts);
        assert!(!defs.is_empty());
        let first = &defs[0];
        assert!(first["name"].is_string());
        assert!(first["input_schema"].is_object());
    }

    #[test]
    fn openai_round_result_apply_tool_call_chunk_new() {
        let mut result = OpenAiRoundResult::default();
        result.apply_tool_call_chunk(OpenAiToolCallChunk {
            index: 0,
            id: Some("call_1".to_string()),
            name: Some("read".to_string()),
            arguments: Some("{\"path\":\"test.md\"}".to_string()),
        });
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "call_1");
        assert_eq!(result.tool_calls[0].name, "read");
        assert_eq!(result.tool_calls[0].arguments, "{\"path\":\"test.md\"}");
    }

    #[test]
    fn openai_round_result_apply_tool_call_chunk_append() {
        let mut result = OpenAiRoundResult::default();
        result.apply_tool_call_chunk(OpenAiToolCallChunk {
            index: 0,
            id: Some("call_1".to_string()),
            name: Some("read".to_string()),
            arguments: Some("{\"path\":\"".to_string()),
        });
        result.apply_tool_call_chunk(OpenAiToolCallChunk {
            index: 0,
            id: None,
            name: None,
            arguments: Some("test.md\"}".to_string()),
        });
        assert_eq!(result.tool_calls[0].arguments, "{\"path\":\"test.md\"}");
    }

    #[test]
    fn anthropic_round_result_thinking_block_lifecycle() {
        let mut result = AnthropicRoundResult::default();
        result.start_thinking_block(0);
        result.push_thinking_delta(0, "thinking...");
        result.set_thinking_signature(0, "sig123".to_string());

        let blocks = result.finalized_thinking_blocks();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0]["type"], "thinking");
        assert_eq!(blocks[0]["thinking"], "thinking...");
        assert_eq!(blocks[0]["signature"], "sig123");
        assert!(blocks[0].get("_index").is_none());
    }

    #[test]
    fn anthropic_round_result_push_redacted_thinking() {
        let mut result = AnthropicRoundResult::default();
        result.push_redacted_thinking(0, "redacted_data".to_string());
        let blocks = result.finalized_thinking_blocks();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0]["type"], "redacted_thinking");
        assert_eq!(blocks[0]["data"], "redacted_data");
    }

    #[test]
    fn anthropic_round_result_tool_call_lifecycle() {
        let mut result = AnthropicRoundResult::default();
        result.start_tool_call(0, "call_1".to_string(), "read".to_string());
        result.push_tool_arguments(0, "{\"path\":\"test.md\"}");
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "call_1");
        assert_eq!(result.tool_calls[0].name, "read");
        assert_eq!(result.tool_calls[0].arguments, "{\"path\":\"test.md\"}");
    }

    #[test]
    fn anthropic_round_result_finalized_sorts_by_index() {
        let mut result = AnthropicRoundResult::default();
        result.push_thinking_delta(2, "third");
        result.push_thinking_delta(0, "first");
        result.push_thinking_delta(1, "second");
        let blocks = result.finalized_thinking_blocks();
        assert_eq!(blocks[0]["thinking"], "first");
        assert_eq!(blocks[1]["thinking"], "second");
        assert_eq!(blocks[2]["thinking"], "third");
    }
}
