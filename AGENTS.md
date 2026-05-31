# 指南 (AGENTS.md)

这份文档旨在指导协助开发此项目的 AI Agent。请严格遵守以下核心原则与工程规范。

## 1. 核心技术栈
- **前端**: React, TypeScript, Ant Design, Zustand (状态管理), React Router (路由)。
- **后端 / 桌面壳**: Tauri v2, Rust。
- **构建工具**: Vite。

## 2. 界面与设计原则 (严格执行)
- **全部使用中文**: 任何用户可见的 UI 文案、占位符、错误提示等**必须全部使用中文**。
- **设计风格 (暖色调极简风)**: 
  - 遵循 `DESIGN.md` 中的设计系统，背景采用暖色调（如 `#faf9f5`），强调色采用陶土色/琥珀色（如 `#d97757`）。
  - 不使用多余的嵌套卡片和刺眼的深色边界，用充足的"留白"代替视觉分割线。
  - 核心工作区采用左中右三栏布局（左侧文件树、中间 Markdown 编辑器、右侧 Agent 对话框）。

## 3. 工作流与任务追踪
- **OpenSpec 追踪**: 本项目使用 OpenSpec 工作流进行任务管理（归档于 `openspec/changes/archive/`）。
- **改动原则**: 小步快跑，每次改动仅围绕具体任务展开。涉及文件读写、Bash 执行等底层敏感操作时，**必须在 Rust 后端实现**，并通过 Tauri Commands 提供给前端调用，严禁在前端直接调用危险 API。

## 4. 后端架构 (Rust)

后端采用模块化设计，`src-tauri/src/lib.rs` 仅保留模块声明和 Tauri 命令注册，业务逻辑分布在以下模块中：

### 4.1 模块职责
| 模块 | 文件/目录 | 职责 |
|------|----------|------|
| `models` | `src/models.rs` | 共享类型定义：`FileNode`, `ToolResult`, `ChatMessage`, `VersionInfo`, `AgentSessionRecord`, `SkillDefinition`, `AnalyzeMemoryRequest` 等 |
| `utils` | `src/utils.rs` | 共享工具函数：路径规范化、字符串截断、token 估算、glob 匹配、文件过滤等 |
| `tools` | `src/tools/mod.rs`, `src/tools/registry.rs` | Agent 工具实现：`read`, `write`, `edit`, `bash`, `grep`, `glob`, `skill`, `subagent`, `todo`；工具定义与权限过滤 |
| `llm` | `src/llm/mod.rs` | LLM 提供商集成：OpenAI / Anthropic 的 endpoint 构建、SSE 流解析、消息格式化、上下文预算裁剪 |
| `agent` | `src/agent/mod.rs`, `src/agent/sessions.rs` | Agent 运行时循环、工具执行调度、事件发射；Agent 会话的持久化与读取；大模型文本总结及角色记忆/关系分析（`analyze_character_memory`） |
| `commands` | `src/commands/fs.rs`, `workspace.rs`, `versions.rs`, `skills.rs` | Tauri 命令按领域分组：文件系统沙盒化操作、工作区与作品状态同步（包括 AI 评分保存与加载）、版本控制管理、Skill 管理 |
| `fs_commands` | `src/fs_commands.rs` | 隔离的文件系统敏感操作底层命令（重命名、安全移动、空目录生成） |
| `crawler` | `src/crawler.rs` | 网页爬取模块（支持番茄小说等站点的文章与大纲抓取） |

### 4.2 开发规范
- Tauri 命令需正确处理 `Result` 并序列化给前端。
- 执行 `bash` 等命令时必须设定超时、校验危险命令、只允许局部路径操作。
- 新增工具或命令时，必须在对应模块中实现，并在 `lib.rs` 中声明模块。

## 5. 前端架构 (React)

### 5.1 页面 (`src/pages/`)
- `Works.tsx` — 作品管理页面（`dirType="articles"`）
- `Examples.tsx` — 范文库页面（`dirType="references"`）
- `DeAi.tsx` — 去 AI 味模块（检测 Agent + 去除 Agent）
- `Outline.tsx` — 大纲模块（大纲评估 Agent + 大纲制作 Agent）
- `Background.tsx` — 伴侣背景设定页面（管理“世界书”与“角色卡”设定，采用字段分离的高级结构化表单设计）
- `Chat.tsx` — 智能伴侣聊天页面（载入所选世界书、角色卡与用户信息，展开高沉浸对话）
- `Story.tsx` — 故事冒险页面（文字冒险模块，支持选择一个世界书、多个角色卡与初始剧情，支持“语言(speech)”/“行为(behavior)”/“剧情(plot)”三种输入模式，支持历史会话与记忆归档）
- `Settings.tsx` — 应用设置页面

### 5.2 核心组件 (`src/components/`)
- `AgentChat.tsx` — 通用写作 Agent 对话框
- `DeAiAgentChat.tsx` — 去 AI 味专用 Agent 对话框
- `OutlineAssessmentAgentChat.tsx` — 大纲评估 Agent 对话框
- `OutlineCreationAgentChat.tsx` — 大纲制作 Agent 对话框
- `PartnerChatSettingsModal.tsx` — 伴侣对话设置模态框（配置使用的世界书、角色卡、模型及填写用户信息）
- `WorkspaceDirectory.tsx` — 通用工作区文件树组件（替代了旧的 `DeAiDirectory` / `ExamplesDirectory`）
- `MarkdownEditor.tsx` — Markdown 编辑器

### 5.3 状态管理 (`src/stores/`)
- `useAgentStore.ts` — 通用 Agent 状态
- `useDeAiStore.ts` — 去 AI 味模块状态
- `useOutlineStore.ts` — 大纲模块状态
- `usePartnerStore.ts` — 智能伴侣背景设置状态管理（包含世界书、角色卡的增删改查、字段编译为标准 Markdown 结构等逻辑）
- `usePartnerChatStore.ts` — 智能伴侣聊天状态管理（含已选关联背景 ID 缓存、用户信息缓存）
- `useStoryStore.ts` — 故事冒险状态管理（含输入模式选择、多角色卡选择缓存、初始剧情缓存）
- `useSettingsStore.ts` — 应用设置状态（支持为不同模块的独立 Agent 配置私有的 LLM 参数，去除全局默认配置）
- `useWorksStore.ts` — 作品管理状态

### 5.4 开发规范
- 尽量使用函数式组件与 Hooks。
- 将样式整合到 Ant Design 的 `ConfigProvider` 和 `theme.ts` 中。
- 对话框与编辑器需支持 Markdown 渲染（实时高亮与流式显示）。

## 6. 工作区与目录结构

### 6.1 根目录
所有用户数据及作品存储在 **`~/Documents/MuseAI/`** 下：
- `~/Documents/MuseAI/articles/` — 用户作品（写作 Agent 的工作区）
- `~/Documents/MuseAI/references/` — 范文库/参考文件
- `~/Documents/MuseAI/outline/` — 大纲模块工作区

### 6.2 规范与数据流
- 应用首次访问时会自动从旧路径（`app_data_dir`）迁移数据到上述新路径。
- 所有 Agent 的文件读取/写入目标必须是上述目录下的文件，**严禁直接对用户导入的原始文件进行写操作**。
- 任何执行修改操作的 Agent，在任务开始前必须先将目标文件复制为一个新版本（Copy-on-Write），后续修改在新版本上进行。
- 智能伴侣的世界书与角色卡属于用户背景设定，目前主要通过前端 Zustand 的 LocalStorage 持久化存储（`museai-partner-storage`）进行高频管理。
- 智能伴侣聊天与故事文字冒险的 Session 历史数据属于高负荷会话序列，统一通过 Tauri 后端命令（`save_agent_session`, `load_agent_session` 等）存储在应用本地方案中。

## 7. 应用内 Multi-Agent 架构与开发规范

### 7.1 Agent 类型
- **写作 Agent** (`AgentChat`)：辅助用户创作文章，可读取范文库内容注入上下文。
- **检测 Agent** / **去除 Agent** (`DeAiAgentChat`)：检测文章的"AI 味"浓度并给出分数和建议；去除 Agent 根据建议优化文本。
- **大纲评估 Agent** (`OutlineAssessmentAgentChat`)：对用户提交的大纲进行打分并给出优化建议。
- **大纲制作 Agent** (`OutlineCreationAgentChat`)：根据评估结果或用户要求制作/修改大纲。
- **智能伴侣 Agent** (`Chat` / `usePartnerChatStore`)：根据载入的世界书、角色卡以及用户信息（userInfo），完美契合角色性格和语言风格进行沉浸式对话。
- **故事/文字冒险 Agent** (`Story` / `useStoryStore`)：担任地下城主（DM）或叙事者，依照设定的世界背景、角色卡及初始剧情，对用户的语言、行为或剧情推进做出合理的剧情演绎和场景描绘。
- **记忆归档 Agent** (`analyze_character_memory`)：专门负责提取会话关键片段，分析用户与角色间关系类型的加深与确立，更新相处模式与底线，提取里程碑式“关键事件”并更新至角色卡。

### 7.2 权限与环境沙盒化
- **只读基准权限**：所有应用内 Agent 默认拥有对本地文件的 `read` 权限，以读取 Skill 模板和范文库资源。
- **文件操作隔离**：读写目标严格限制在 `~/Documents/MuseAI/` 及其子目录下。
- **非破坏性修改 (Copy-on-Write)**：修改类 Agent 必须先在目标文件上创建新版本，再对新版本进行修改。
- **工作区隔离**：各模块 Agent 的工作空间相互独立（如大纲相关 Agent 限制在 `~/Documents/MuseAI/outline`）。

### 7.3 多 Agent 协同与上下文管理
- **动态上下文组装**：Agent 的提示词构建需动态嵌入关联数据，例如用户勾选的范文库内容、前置 Agent 输出的评分与优化建议等。
- **级联与状态重置**：在涉及多 Agent 自动协同流时，每次开启新一轮任务对话前必须清空参与轮转的 Agent 的上下文记录。
- **结果持久化**：评估检测类 Agent 的产出结果（如 JSON 格式的打分及建议）需及时进行本地持久化，供前端 UI 渲染或下一步 Agent 读取。
- **角色记忆归档工作流**：
  在伴侣对话（Chat）或故事冒险（Story）中，每次对话结束或用户主动发起“保存并归档”时，系统将通过 Tauri 调用 Rust 后端的 `analyze_character_memory` 命令，分析当前的完整会话记录、现存关系设定与历史关键事件。归档 Agent 将以 JSON 格式输出最新的“与用户关系类型”、“与用户相处模式”、“与用户关系底线”、“关键事件”以及“本次会话标题”，并在用户确认后，自动写回至前端 `usePartnerStore` 对应的角色卡字段中，实现角色的性格成长与动态记忆留存。

## 8. Skill 系统
- Skill 定义文件位于 `src-tauri/resources/skills/`，以 Markdown 格式存储，包含 YAML frontmatter（`name`, `description`, `version` 等）。
- Tauri 构建配置 (`tauri.conf.json`) 将 `resources/skills` 打包为应用资源。
- `src/commands/skills.rs` 提供 Skill 的发现、导入和列表命令。
- Agent 可通过 `skill` 工具按名称调用 Skill，系统会自动从资源目录加载对应的 Skill 内容注入提示词。

## 9. 版本管理
- 每个作品文件支持多版本管理，版本元数据持久化在文件同级目录的 `.versions/` 中。
- `VersionInfo` 扩展了可选的 AI 检测分数和修改建议字段，供去 AI 味模块使用。
- 版本操作命令位于 `src/commands/versions.rs`：创建、读取、删除版本，以及更新 AI 检测分数和建议。
