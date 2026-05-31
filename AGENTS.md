# 指南 (AGENTS.md)

这份文档旨在指导协助开发此项目的 AI Agent。请严格遵守以下核心原则与工程规范。

## 1. 核心技术栈
- **前端**: React, TypeScript, Ant Design, Zustand, React Router, Vite, Vitest。
- **后端 / 桌面壳**: Tauri v2, Rust。

## 2. 界面与设计原则 (严格执行)
- **全部使用中文**: 任何用户可见的 UI 文案、占位符、错误提示等**必须全部使用中文**。
- **设计风格 (暖色调极简风)**:
  - 背景 `#faf9f5`，强调色 `#d97757`。
  - 不用多余嵌套卡片和深色边界，用留白代替分割线。
  - 核心工作区采用左中右三栏（文件树 / Markdown 编辑器 / Agent 对话框）。

## 3. 工作流与任务追踪
- **OpenSpec 追踪**: 使用 OpenSpec 工作流管理任务，归档于 `openspec/changes/archive/`。
- **改动原则**: 小步快跑，每次改动围绕具体任务展开。涉及文件读写、Bash 等敏感操作**必须在 Rust 后端实现**，通过 Tauri Commands 暴露给前端，严禁前端直接调用危险 API。

## 4. 后端架构 (Rust)

`src-tauri/src/lib.rs` 负责模块声明、Tauri 命令注册，以及部分直接暴露的底层命令（如文件重命名、安全移动等）。业务逻辑分布在以下模块：

| 模块 | 文件 | 职责 |
|------|------|------|
| `models` | `src/models.rs` | 共享类型定义 |
| `utils` | `src/utils.rs` | 路径规范化、字符串截断、glob 匹配、文件过滤等 |
| `tools` | `src/tools/mod.rs`, `src/tools/registry.rs` | Agent 工具：`read`, `write`, `edit`, `bash`, `grep`, `glob`, `skill`, `subagent`, `todo` |
| `llm` | `src/llm/mod.rs` | LLM 提供商集成、SSE 流解析、消息格式化 |
| `agent` | `src/agent/mod.rs`, `src/agent/sessions.rs` | Agent 运行时、会话持久化、`analyze_character_memory` |
| `commands` | `src/commands/mod.rs`, `fs.rs`, `workspace.rs`, `versions.rs`, `skills.rs` | Tauri 命令按领域分组 |
| `fs_commands` | `src/fs_commands.rs` | 隔离的底层文件操作（重命名、安全移动、空目录生成） |
| `crawler` | `src/crawler.rs` | 网页爬取（番茄小说等） |

### 开发规范
- Tauri 命令正确处理 `Result` 并序列化给前端。
- `bash` 命令必须设超时、校验危险命令、限制局部路径。
- 新增工具或命令时，在对应模块实现，并在 `lib.rs` 中注册。

## 5. 前端架构 (React)

### 5.1 页面 (`src/pages/`)
`Home.tsx`, `Works.tsx`, `Examples.tsx`, `DeAi.tsx`, `Outline.tsx`, `Background.tsx`, `Chat.tsx`, `Story.tsx`, `Bond.tsx`, `Settings.tsx`

### 5.2 核心组件 (`src/components/`)
`AgentChat.tsx`, `DeAiAgentChat.tsx`, `OutlineAssessmentAgentChat.tsx`, `OutlineCreationAgentChat.tsx`, `PartnerChatSettingsModal.tsx`, `WorkspaceDirectory.tsx`, `MarkdownEditor.tsx`, `ScoreDetailsModal.tsx`, `ScoreRadarChart.tsx`, `AppShell.tsx`

### 5.3 状态管理 (`src/stores/`)
`useAgentStore.ts`, `useDeAiStore.ts`, `useOutlineStore.ts`, `usePartnerStore.ts`, `usePartnerChatStore.ts`, `useStoryStore.ts`, `useSettingsStore.ts`, `useWorksStore.ts`

### 5.4 开发规范
- 函数式组件与 Hooks。
- 样式整合到 Ant Design `ConfigProvider` 和 `theme.ts`。
- 对话框与编辑器支持 Markdown 渲染（实时高亮与流式显示）。

## 6. 工作区与目录结构

### 6.1 根目录
所有用户数据存储在 **`~/Documents/MuseAI/`** 下：
- `articles/` — 用户作品
- `references/` — 范文库
- `outline/` — 大纲工作区

### 6.2 规范与数据流
- 首次访问自动从旧路径迁移数据。
- Agent 文件操作严格限制在上述目录内，严禁直接修改用户导入的原始文件。
- 修改类 Agent 必须先 Copy-on-Write 创建新版本，再在新版本上修改。
- 世界书与角色卡通过前端 Zustand + LocalStorage 管理（`museai-partner-storage`）。
- 伴侣聊天与故事冒险的 Session 通过 Tauri 后端命令持久化。

## 7. 应用内 Multi-Agent 架构与开发规范

### 7.1 Agent 类型
- **写作 Agent** (`AgentChat`)
- **检测 Agent** / **去除 Agent** (`DeAiAgentChat`)
- **大纲评估 Agent** (`OutlineAssessmentAgentChat`)
- **大纲制作 Agent** (`OutlineCreationAgentChat`)
- **智能伴侣 Agent** (`Chat` / `usePartnerChatStore`)
- **故事/文字冒险 Agent** (`Story` / `useStoryStore`)
- **记忆归档 Agent** (`analyze_character_memory`)

### 7.2 权限与环境沙盒化
- 默认只读权限：`read` 工具读取 Skill 模板和范文库。
- 文件操作隔离：限制在 `~/Documents/MuseAI/` 下。
- 非破坏性修改：Copy-on-Write。
- 工作区隔离：各模块 Agent 工作空间相互独立。

### 7.3 多 Agent 协同与上下文管理
- **动态上下文组装**：Agent 提示词动态嵌入关联数据（范文、前置评分等）。
- **级联与状态重置**：多 Agent 协同流开启前清空参与 Agent 的上下文。
- **结果持久化**：评估产出结果（JSON 打分/建议）及时本地持久化。
- **角色记忆归档**：Chat/Story 会话结束后调用 `analyze_character_memory`，输出关系类型、相处模式、底线、关键事件、会话标题，写回角色卡。

### 7.4 TDD 开发规范（强制执行）
本项目要求**测试驱动开发（TDD）**：新增功能或修改既有逻辑前，必须先编写测试，确保测试失败后再编写实现代码，最终测试通过方可提交。

#### 测试覆盖原则
- **Rust 后端**：所有新增 Tauri 命令、Agent 工具、LLM 解析器、文件系统操作等核心逻辑，必须配套单元测试或集成测试。
- **前端状态管理**：Zustand store 中的复杂计算逻辑必须编写单元测试。
- **关键数据流**：会话保存/加载/归档、版本控制、角色记忆分析等涉及用户数据持久化的路径，测试为强制项，不允许跳过。

#### 测试编写规范
- 测试用例体现**业务需求**和**边界条件**，而非验证实现细节。
- Rust 测试使用 `cargo test`，测试块置于被测模块同文件的 `#[cfg(test)]` 中（如 `models.rs`、`lib.rs` 已存在的模式）。前端测试使用 Vitest，测试文件置于 `src/test/`。
- 测试命名清晰描述场景：`test_save_agent_session_with_character_card_id`、`test_bond_filters_sessions_by_character`。

#### 运行与门禁
- 每次代码变更后，必须执行 `cargo test` 与 `tsc --noEmit`，两者全部通过方可视为完成。
- 不允许以"只是小改动"为由跳过测试。若现有测试因修改而失败，必须修复或同步更新测试本身。

## 8. Skill 系统
- Skill 定义文件位于 `src-tauri/resources/skills/`，Markdown 格式，含 YAML frontmatter。
- Tauri 构建将 `resources/skills` 打包为应用资源。
- `src/commands/skills.rs` 提供 Skill 的发现、导入和列表命令。
- Agent 通过 `skill` 工具按名称调用 Skill。

## 9. 版本管理
- 每个作品文件支持多版本，版本元数据持久化在 `.versions/` 中。
- `VersionInfo` 扩展了可选的 AI 检测分数和修改建议字段。
- 版本操作命令位于 `src/commands/versions.rs`。
