# Linux 文档目录回退兼容设计

## 背景

MuseAI 将工作区、配置、Agent 会话和日志存放在系统文档目录下的 `MuseAI/` 中。当前代码直接调用 Tauri 的 `app.path().document_dir()`。在 Linux 上，该接口依赖 XDG `user-dirs.dirs` 中的 `XDG_DOCUMENTS_DIR`；配置缺失或无效时会返回 `UnknownPath`，导致目录尚未创建就终止操作。

## 目标

- 保留各平台现有的系统文档目录解析行为。
- 仅在 Linux 无法解析系统文档目录时回退到 `$HOME/Documents`。
- 让工作区、配置、会话、日志、Agent 工具和移动端接口使用同一套路径解析逻辑。
- 不改变已能正常解析 XDG 文档目录的 Linux 用户的数据位置。

## 非目标

- 不允许用户自定义数据根目录。
- 不迁移已有数据到新的位置。
- 不修改移动端服务的监听或 Docker 网络行为。
- 不为 Windows 或 macOS 增加额外回退规则。

## 设计

在 Rust 公共工具模块中增加统一的文档目录解析函数。

解析顺序：

1. 调用 Tauri `app.path().document_dir()`。
2. 成功时直接返回该路径。
3. 失败且目标平台为 Linux 时，读取非空的 `HOME`，返回 `$HOME/Documents`。
4. 其他平台或 Linux 无可用 `HOME` 时，保留原始 Tauri 错误，并转换为现有命令使用的字符串错误。

所有当前直接调用 `app.path().document_dir()` 的业务路径改用该函数，包括：

- 工作区目录及应用状态；
- Agent 会话与错误日志；
- Agent 工具的工作区限制；
- 移动端配置、会话和业务接口；
- `lib.rs` 中依赖文档目录的命令。

回退函数只负责确定路径，不主动创建 `Documents`。目录仍由现有业务代码在需要写入时通过 `create_dir_all` 创建，避免改变只读调用的副作用。

## 错误处理

- XDG 可用时不触发回退。
- Linux 的 `HOME` 缺失或为空时不猜测路径，返回原始解析错误。
- 文件系统创建或写入失败继续返回真实 I/O 错误，不伪装为路径解析错误。
- 日志路径也使用统一解析函数，使 Linux 回退场景可以正常创建 `.logs/agent-runs.log`。

## 测试与验证

先为纯路径决策逻辑添加 Rust 单元测试：

- 首选系统文档目录；
- Linux 系统目录解析失败时回退到 `$HOME/Documents`；
- Linux `HOME` 缺失或为空时返回原始错误；
- 非 Linux 不使用 `$HOME/Documents` 回退。

实现后运行：

1. `cargo test`，验证 Rust 单元测试及现有后端测试。
2. `npm run test`，确认前端调用契约未受影响。
3. `npm run build`，确认完整前端构建。
4. 搜索剩余的直接 `document_dir()` 调用，确认业务路径已统一；测试辅助代码或统一解析函数内部调用除外。

## 成功标准

- 缺少有效 `XDG_DOCUMENTS_DIR`、但存在有效 `HOME` 的 Linux 环境能够创建并使用 `$HOME/Documents/MuseAI/`。
- 有效 XDG 自定义文档目录仍被优先使用。
- Windows 和 macOS 行为不变。
- 所有相关测试与构建通过。
