mod crawler;
mod fs_commands;
use base64::{engine::general_purpose, Engine as _};
use futures_util::{future::BoxFuture, StreamExt};
use glob::glob;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::sync::OnceLock;
use std::thread;
use std::time::UNIX_EPOCH;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;
use uuid::Uuid;
use walkdir::WalkDir;

static BASH_PERMISSION_CHANNELS: OnceLock<Mutex<HashMap<String, oneshot::Sender<bool>>>> =
    OnceLock::new();

fn bash_permission_channels() -> &'static Mutex<HashMap<String, oneshot::Sender<bool>>> {
    BASH_PERMISSION_CHANNELS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct ActiveStreams(Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>);

#[derive(Serialize)]
pub struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileNode>>,
}

#[derive(Serialize)]
pub struct ToolResult {
    success: bool,
    output: String,
}

#[derive(Serialize)]
pub struct BashToolResult {
    success: bool,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    timed_out: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    id: String,
    timestamp: u64,
    ai_score: Option<u32>,
    suggestion: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileVersionsMetadata {
    versions: Vec<VersionInfo>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct TodoItem {
    content: String,
    active_form: String,
    status: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    role: String,
    content: String,
    tool_call_id: Option<String>,
    tool_calls: Option<Vec<ChatToolCall>>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatToolCall {
    id: String,
    name: String,
    arguments: String,
}



#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamRequest {
    model_interface: String,
    base_url: String,
    api_key: String,
    model: String,
    temperature: Option<f32>,
    max_output_tokens: Option<u32>,
    max_context_tokens: Option<u32>,
    thinking_depth: Option<String>,
    system_prompt: String,
    workspace_path: Option<String>,
    messages: Vec<ChatMessage>,
    selected_reference_files: Option<Vec<String>>,
    allowed_tools: Option<Vec<String>>,
    allowed_write_paths: Option<Vec<String>>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummarizeRequest {
    model_interface: String,
    base_url: String,
    api_key: String,
    model: String,
    temperature: Option<f32>,
    max_output_tokens: Option<u32>,
    text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamEvent {
    run_id: String,
    event_type: String,
    delta: Option<String>,
    message: Option<String>,
    tool_call_id: Option<String>,
    tool_name: Option<String>,
    tool_status: Option<String>,
    tool_arguments: Option<String>,
    todos: Option<Vec<AgentSessionTodo>>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionTool {
    id: Option<String>,
    name: String,
    result: String,
    status: Option<String>,
    arguments: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionMessage {
    id: String,
    role: String,
    content: String,
    thinking: Option<String>,
    tools: Option<Vec<AgentSessionTool>>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionTodo {
    content: String,
    status: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRecord {
    id: String,
    title: String,
    saved_at: u64,
    messages: Vec<AgentSessionMessage>,
    selected_reference_files: Vec<String>,
    todos: Vec<AgentSessionTodo>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummary {
    id: String,
    title: String,
    saved_at: u64,
}

const MAX_READ_LINES: usize = 2000;
const MAX_SEARCH_RESULTS: usize = 200;
const MAX_GLOB_RESULTS: usize = 100;
const MAX_BASH_OUTPUT_CHARS: usize = 15_000;
const MAX_AGENT_TOOL_OUTPUT_CHARS: usize = 12_000;
const MAX_AGENT_TOOL_ROUNDS: usize = 50;
const MAX_SUBAGENT_TOOL_ROUNDS: usize = 6;
const MAX_SUBAGENT_OUTPUT_CHARS: usize = 5_000;
const DEFAULT_BASH_TIMEOUT_SECS: u64 = 120;
const MAX_BASH_TIMEOUT_SECS: u64 = 600;

fn is_supported_content_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("md" | "txt" | "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg")
    )
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<FileNode>, String> {
    let mut nodes = Vec::new();
    let dir_path = Path::new(&path);

    if !dir_path.exists() || !dir_path.is_dir() {
        return Err(format!("Path {} is not a valid directory", path));
    }

    match fs::read_dir(dir_path) {
        Ok(entries) => {
            for entry in entries {
                if let Ok(entry) = entry {
                    let path_buf = entry.path();
                    let name = entry
                        .file_name()
                        .into_string()
                        .unwrap_or_else(|_| String::from("unknown"));
                    if name.starts_with('.') {
                        continue;
                    }
                    let is_dir = path_buf.is_dir();
                    if !is_dir && !is_supported_content_file(&path_buf) {
                        continue;
                    }

                    nodes.push(FileNode {
                        name,
                        path: path_buf.to_string_lossy().into_owned(),
                        is_dir,
                        children: if is_dir { Some(vec![]) } else { None },
                    });
                }
            }
            nodes.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
            Ok(nodes)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_image_data_url(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    if !is_supported_content_file(path)
        || path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false)
    {
        return Err("仅支持图片文件预览".to_string());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let mime = match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        _ => return Err("不支持的图片格式".to_string()),
    };
    Ok(format!(
        "data:{};base64,{}",
        mime,
        general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
fn write_file(app: tauri::AppHandle, path: String, content: String) -> Result<u64, String> {
    fs::write(&path, content).map_err(|e| e.to_string())?;
    let _ = app.emit("workspace-changed", ());
    file_modified_at(path)
}

#[tauri::command]
fn create_file(app: tauri::AppHandle, path: String) -> Result<u64, String> {
    let path = Path::new(&path);
    if path.exists() {
        return Err("文件已存在".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, "").map_err(|e| e.to_string())?;
    let _ = app.emit("workspace-changed", ());
    file_modified_at(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn create_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = Path::new(&path);
    if path.exists() {
        return Err("文件夹已存在".to_string());
    }
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    let _ = app.emit("workspace-changed", ());
    Ok(())
}

#[tauri::command]
fn rename_path(app: tauri::AppHandle, path: String, new_name: String) -> Result<String, String> {
    let source = Path::new(&path);
    if !source.exists() {
        return Err("文件或文件夹不存在".to_string());
    }
    if new_name.trim().is_empty() || new_name.contains('/') || new_name.contains('\\') {
        return Err("名称不合法".to_string());
    }
    let parent = source.parent().ok_or("无法获取上级目录")?;
    let target = parent.join(new_name.trim());
    if target.exists() {
        return Err("同名文件或文件夹已存在".to_string());
    }
    fs::rename(source, &target).map_err(|e| e.to_string())?;
    let _ = app.emit("workspace-changed", ());
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn delete_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Ok(());
    }
    if target.is_dir() {
        fs::remove_dir_all(target).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(target).map_err(|e| e.to_string())?;
    }
    let _ = app.emit("workspace-changed", ());
    Ok(())
}

#[tauri::command]
fn file_modified_at(path: String) -> Result<u64, String> {
    let modified = fs::metadata(path)
        .map_err(|e| e.to_string())?
        .modified()
        .map_err(|e| e.to_string())?;

    let millis = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();

    u64::try_from(millis).map_err(|_| String::from("File modified timestamp is too large"))
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn tool_read(file_path: String, offset: Option<usize>, limit: Option<usize>, workspace: Option<String>) -> ToolResult {
    match read_file_with_lines(
        &expand_path(workspace.as_deref(), &file_path).to_string_lossy(),
        offset.unwrap_or(1),
        limit.unwrap_or(MAX_READ_LINES),
    ) {
        Ok(output) => ToolResult {
            success: true,
            output,
        },
        Err(output) => ToolResult {
            success: false,
            output,
        },
    }
}

#[tauri::command]
fn tool_write(app: tauri::AppHandle, file_path: String, content: String, workspace: Option<String>) -> ToolResult {
    let path = expand_path(workspace.as_deref(), &file_path);
    let result = (|| -> Result<String, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        fs::write(&path, &content).map_err(|e| e.to_string())?;
        let _ = app.emit("workspace-changed", ());
        let line_count = count_lines(&content);
        Ok(format!("Wrote {} lines to {}", line_count, path.display()))
    })();

    result_to_tool_result(result)
}

#[tauri::command]
fn tool_edit(app: tauri::AppHandle, file_path: String, old_string: String, new_string: String, workspace: Option<String>) -> ToolResult {
    let path = expand_path(workspace.as_deref(), &file_path);
    let result = (|| -> Result<String, String> {
        if !path.exists() {
            return Err(format!("Error: {} not found", path.display()));
        }
        if !path.is_file() {
            return Err(format!("Error: {} is not a file", path.display()));
        }

        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let occurrences = content.matches(&old_string).count();
        if occurrences == 0 {
            let preview = truncate_chars(&content, 500);
            return Err(format!(
                "Error: old_string not found in {}.\nFile starts with:\n{}",
                path.display(),
                preview
            ));
        }
        if occurrences > 1 {
            return Err(format!(
                "Error: old_string appears {} times in {}. Include more surrounding lines to make it unique.",
                occurrences,
                path.display()
            ));
        }

        let new_content = content.replacen(&old_string, &new_string, 1);
        fs::write(&path, &new_content).map_err(|e| e.to_string())?;
        let _ = app.emit("workspace-changed", ());
        Ok(format!(
            "Edited {}\n{}",
            path.display(),
            simple_diff(&content, &new_content)
        ))
    })();

    result_to_tool_result(result)
}

#[tauri::command]
async fn resolve_bash_permission(request_id: String, approved: bool) -> Result<(), String> {
    if let Some(sender) = bash_permission_channels()
        .lock()
        .unwrap()
        .remove(&request_id)
    {
        let _ = sender.send(approved);
    }
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BashPermissionRequestPayload {
    pub request_id: String,
    pub command: String,
}

#[tauri::command]
async fn tool_bash(
    app: tauri::AppHandle,
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
    workspace: Option<String>,
) -> BashToolResult {
    if let Some(reason) = dangerous_command_reason(&command) {
        return BashToolResult {
            success: false,
            stdout: String::new(),
            stderr: format!(
                "Blocked: {}\nCommand: {}\nIf intentional, make the command more specific.",
                reason, command
            ),
            exit_code: None,
            timed_out: false,
        };
    }

    if let Some(reason) = avoid_command_reason(&command) {
        return BashToolResult {
            success: false,
            stdout: String::new(),
            stderr: format!(
                "Blocked: {}\nCommand: {}\nPlease use the appropriate dedicated tool instead.",
                reason, command
            ),
            exit_code: None,
            timed_out: false,
        };
    }

    let request_id = Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    bash_permission_channels()
        .lock()
        .unwrap()
        .insert(request_id.clone(), tx);

    let payload = BashPermissionRequestPayload {
        request_id,
        command: command.clone(),
    };
    let _ = app.emit("bash-permission-request", payload);

    let approved = rx.await.unwrap_or(false);
    if !approved {
        return BashToolResult {
            success: false,
            stdout: String::new(),
            stderr: String::from("User denied permission to run this command."),
            exit_code: None,
            timed_out: false,
        };
    }

    let timeout = timeout_secs
        .unwrap_or(DEFAULT_BASH_TIMEOUT_SECS)
        .clamp(1, MAX_BASH_TIMEOUT_SECS);
    let mut child_command = Command::new(shell_path());
    child_command
        .arg("-lc")
        .arg(&command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(cwd) = cwd {
        child_command.current_dir(expand_path(workspace.as_deref(), &cwd));
    }

    let mut child = match child_command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return BashToolResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Error running command: {}", error),
                exit_code: None,
                timed_out: false,
            }
        }
    };

    let deadline = Instant::now() + Duration::from_secs(timeout);
    let mut timed_out = false;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() >= deadline => {
                timed_out = true;
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                return BashToolResult {
                    success: false,
                    stdout: String::new(),
                    stderr: error.to_string(),
                    exit_code: None,
                    timed_out: false,
                }
            }
        }
    }

    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut stream) = child.stdout.take() {
        let _ = stream.read_to_string(&mut stdout);
    }
    if let Some(mut stream) = child.stderr.take() {
        let _ = stream.read_to_string(&mut stderr);
    }
    stdout = truncate_middle(stdout.trim_end().to_string(), MAX_BASH_OUTPUT_CHARS);
    stderr = truncate_middle(stderr.trim_end().to_string(), MAX_BASH_OUTPUT_CHARS);

    if timed_out {
        return BashToolResult {
            success: false,
            stdout,
            stderr: format!("{}\nError: timed out after {}s", stderr, timeout)
                .trim()
                .to_string(),
            exit_code: None,
            timed_out: true,
        };
    }

    let status = child.wait().ok();
    let exit_code = status.and_then(|status| status.code());
    
    // Commands like `touch` or `mkdir` might have modified the workspace
    if exit_code == Some(0) {
        let _ = app.emit("workspace-changed", ());
    }

    BashToolResult {
        success: exit_code == Some(0),
        stdout,
        stderr,
        exit_code,
        timed_out: false,
    }
}

#[tauri::command]
fn tool_grep(pattern: String, path: Option<String>, include: Option<String>, workspace: Option<String>) -> ToolResult {
    let result = (|| -> Result<String, String> {
        let regex = Regex::new(&pattern).map_err(|e| format!("Invalid regex: {}", e))?;
        let base = expand_path(workspace.as_deref(), path.as_deref().unwrap_or("."));
        if !base.exists() {
            return Err(format!("Error: {} not found", base.display()));
        }

        let files = collect_grep_files(&base, include.as_deref())?;
        let mut matches = Vec::new();
        for file in files {
            let Ok(text) = fs::read_to_string(&file) else {
                continue;
            };
            for (line_index, line) in text.lines().enumerate() {
                if regex.is_match(line) {
                    matches.push(format!("{}:{}: {}", file.display(), line_index + 1, line));
                    if matches.len() >= MAX_SEARCH_RESULTS {
                        matches.push(format!("... ({} match limit reached)", MAX_SEARCH_RESULTS));
                        return Ok(matches.join("\n"));
                    }
                }
            }
        }

        if matches.is_empty() {
            Ok(String::from("No matches found."))
        } else {
            Ok(matches.join("\n"))
        }
    })();

    result_to_tool_result(result)
}

#[tauri::command]
fn tool_glob(pattern: String, path: Option<String>, workspace: Option<String>) -> ToolResult {
    let result = (|| -> Result<String, String> {
        let base = expand_path(workspace.as_deref(), path.as_deref().unwrap_or("."));
        if !base.is_dir() {
            return Err(format!("Error: {} is not a directory", base.display()));
        }

        let full_pattern = base.join(&pattern).to_string_lossy().into_owned();
        let mut hits = Vec::new();
        for entry in glob(&full_pattern).map_err(|e| e.to_string())? {
            if let Ok(path) = entry {
                hits.push(path);
            }
        }

        hits.sort_by(|a, b| {
            let b_time = b.metadata().and_then(|m| m.modified()).ok();
            let a_time = a.metadata().and_then(|m| m.modified()).ok();
            b_time.cmp(&a_time)
        });

        let total = hits.len();
        let mut lines: Vec<String> = hits
            .into_iter()
            .take(MAX_GLOB_RESULTS)
            .map(|item| item.display().to_string())
            .collect();
        if total > MAX_GLOB_RESULTS {
            lines.push(format!(
                "... ({} matches, showing first {})",
                total, MAX_GLOB_RESULTS
            ));
        }

        if lines.is_empty() {
            Ok(String::from("No files matched."))
        } else {
            Ok(lines.join("\n"))
        }
    })();

    result_to_tool_result(result)
}

#[tauri::command]
fn tool_skill(
    app: AppHandle,
    skill: String,
    task: Option<String>,
    args: Option<String>,
) -> ToolResult {
    let result = (|| -> Result<String, String> {
        let normalized = skill.trim().trim_start_matches('/');
        if normalized.is_empty() {
            return Err(String::from("Error: skill is required"));
        }

        let skills = discover_skills(Some(&app));
        let Some(selected) = skills.iter().find(|item| {
            item.name.eq_ignore_ascii_case(normalized)
                || item
                    .path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.eq_ignore_ascii_case(normalized))
        }) else {
            let available = if skills.is_empty() {
                String::from("(none)")
            } else {
                skills
                    .iter()
                    .map(|item| item.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            return Err(format!(
                "Error: unknown skill \"{}\". Available skills: {}",
                normalized, available
            ));
        };

        let skill_doc = selected.path.join("SKILL.md");
        let mut skill_body = fs::read_to_string(&skill_doc).map_err(|e| e.to_string())?;
        skill_body = truncate_chars(&skill_body, 20_000);
        let task_text = task.or(args).unwrap_or_default();

        let mut lines = vec![
            format!("Skill \"{}\" selected.", selected.name),
            format!("Description: {}", selected.description),
            format!("Path: {}", selected.path.display()),
        ];
        let files = list_skill_files(&selected.path);
        if !files.is_empty() {
            lines.push(String::from("Related files:"));
            lines.extend(files.into_iter().map(|file| format!("- {}", file)));
        }
        lines.push(String::new());
        lines.push(String::from("SKILL.md:"));
        lines.push(skill_body);
        if !task_text.trim().is_empty() {
            lines.push(String::new());
            lines.push(String::from("Apply this skill to the following task:"));
            lines.push(task_text);
        }
        lines.push(String::new());
        lines.push(String::from(
            "Follow the skill instructions above before continuing with the task.",
        ));
        Ok(lines.join("\n"))
    })();

    result_to_tool_result(result)
}

#[tauri::command]
fn tool_subagent(task: String) -> ToolResult {
    let output = if task.trim().is_empty() {
        String::from("Error: task is required")
    } else {
        String::from("Error: subagent must be executed from an active Agent chat run so it can reuse the parent model settings.")
    };

    ToolResult {
        success: false,
        output,
    }
}

#[tauri::command]
fn tool_todo(todos: Vec<TodoItem>) -> ToolResult {
    let mut in_progress_count = 0;
    for todo in &todos {
        if todo.content.trim().is_empty() || todo.active_form.trim().is_empty() {
            return ToolResult {
                success: false,
                output: String::from("Error: todo content and active_form are required"),
            };
        }
        match todo.status.as_str() {
            "pending" | "completed" => {}
            "in_progress" => in_progress_count += 1,
            _ => {
                return ToolResult {
                    success: false,
                    output: format!("Error: invalid todo status \"{}\"", todo.status),
                }
            }
        }
    }
    if in_progress_count > 1 {
        return ToolResult {
            success: false,
            output: String::from("Error: only one todo may be in_progress"),
        };
    }

    let remaining = todos
        .iter()
        .filter(|todo| todo.status != "completed")
        .count();
    let mut lines = vec![
        String::from("Todo list updated."),
        format!(
            "{} active todo(s), {} completed.",
            remaining,
            todos.len() - remaining
        ),
    ];
    lines.extend(
        todos
            .iter()
            .map(|todo| format!("- [{}] {}", todo.status, todo.content)),
    );

    ToolResult {
        success: true,
        output: lines.join("\n"),
    }
}

#[tauri::command]
fn list_agent_sessions(app: AppHandle) -> Result<Vec<AgentSessionSummary>, String> {
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
fn load_agent_session(app: AppHandle, id: String) -> Result<AgentSessionRecord, String> {
    let path = agent_session_path(&app, &id)?;
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_agent_session(
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
async fn summarize_text(request: SummarizeRequest) -> Result<String, String> {
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
fn update_agent_session_title(
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
fn start_chat_completion_stream(
    app: AppHandle,
    request: ChatStreamRequest,
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
            Ok(_) => emit_chat_event(&app, &spawned_run_id, "done", None, None, &AgentRunOptions::parent()),
            Err(error) => emit_chat_event(&app, &spawned_run_id, "error", None, Some(error), &AgentRunOptions::parent()),
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
fn stop_chat_stream(run_id: String, state: tauri::State<'_, ActiveStreams>) -> Result<(), String> {
    if let Some(handle) = state.0.lock().unwrap().remove(&run_id) {
        handle.abort();
    }
    Ok(())
}

async fn run_openai_agent_loop(
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
                        emit_chat_event(app, run_id, "thinking_delta", Some(reasoning), None, options);
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

async fn run_anthropic_agent_loop(
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

        let stream_result =
            stream_anthropic_round(app, run_id, response, &options).await?;
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
                            emit_chat_event(app, run_id, "thinking_delta", Some(thinking), None, options);
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

fn emit_chat_event(
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

fn emit_tool_event(
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
            delta = format!("\n[子工具 {} 执行完毕: {}]\n", tool_name, message.clone().unwrap_or_default());
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

fn approximate_token_count(text: &str) -> usize {
    (text.chars().count() + 3) / 4
}

fn chat_message_token_estimate(message: &ChatMessage) -> usize {
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

fn trim_history_to_context_budget(
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

fn openai_history_messages(system_prompt: &str, history: &[ChatMessage]) -> Vec<Value> {
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

fn anthropic_history_messages(history: &[ChatMessage]) -> Vec<Value> {
    let mut messages = Vec::new();
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
                    let mut content = Vec::new();
                    if !message.content.trim().is_empty() {
                        content.push(json!({
                            "type": "text",
                            "text": message.content,
                        }));
                    }
                    for call in tool_calls {
                        content.push(json!({
                            "type": "tool_use",
                            "id": call.id,
                            "name": call.name,
                            "input": parse_tool_arguments(&call.arguments),
                        }));
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

#[derive(Clone)]
struct AgentRunOptions {
    max_tool_rounds: usize,
    emit_events: bool,
    emit_todo_updates: bool,
    allowed_tools: Option<Vec<String>>,
    excluded_tools: Vec<String>,
    parent_tool_call_id: Option<String>,
}

impl AgentRunOptions {
    fn parent() -> Self {
        Self {
            max_tool_rounds: MAX_AGENT_TOOL_ROUNDS,
            emit_events: true,
            emit_todo_updates: true,
            allowed_tools: None,
            excluded_tools: vec![],
            parent_tool_call_id: None,
        }
    }

    fn subagent(parent_tool_call_id: Option<String>) -> Self {
        Self {
            max_tool_rounds: MAX_SUBAGENT_TOOL_ROUNDS,
            emit_events: parent_tool_call_id.is_some(),
            emit_todo_updates: false,
            allowed_tools: None,
            excluded_tools: vec!["subagent".to_string()],
            parent_tool_call_id,
        }
    }

    fn allows_tool(&self, name: &str) -> bool {
        if let Some(allowed) = &self.allowed_tools {
            if !allowed.iter().any(|s| s == name) {
                return false;
            }
        }
        !self.excluded_tools.iter().any(|s| s == name)
    }
}

#[derive(Clone)]
struct AgentToolDefinition {
    name: &'static str,
    description: &'static str,
    input_schema: Value,
}

#[derive(Default)]
struct OpenAiRoundResult {
    content: String,
    tool_calls: Vec<AgentToolCall>,
}

#[derive(Default)]
struct AnthropicRoundResult {
    content: String,
    tool_calls: Vec<AgentToolCall>,
    thinking_blocks: Vec<Value>,
}

#[derive(Clone, Default)]
struct AgentToolCall {
    index: usize,
    id: String,
    name: String,
    arguments: String,
}

struct AgentToolExecution {
    success: bool,
    model_output: String,
}

struct OpenAiStreamEvent {
    content: Option<String>,
    reasoning_content: Option<String>,
    tool_call_chunks: Vec<OpenAiToolCallChunk>,
}

struct OpenAiToolCallChunk {
    index: usize,
    id: Option<String>,
    name: Option<String>,
    arguments: Option<String>,
}

enum AnthropicStreamEvent {
    Text(String),
    ThinkingStart {
        index: usize,
    },
    ThinkingDelta {
        index: usize,
        thinking: String,
    },
    ThinkingSignature {
        index: usize,
        signature: String,
    },
    RedactedThinking {
        index: usize,
        data: String,
    },
    ToolStart {
        index: usize,
        id: String,
        name: String,
    },
    ToolInputDelta {
        index: usize,
        partial_json: String,
    },
}

impl OpenAiRoundResult {
    fn apply_tool_call_chunk(&mut self, chunk: OpenAiToolCallChunk) {
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
    fn start_thinking_block(&mut self, index: usize) {
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

    fn push_thinking_delta(&mut self, index: usize, delta: &str) {
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

    fn set_thinking_signature(&mut self, index: usize, signature: String) {
        self.start_thinking_block(index);
        if let Some(block) = self
            .thinking_blocks
            .iter_mut()
            .find(|block| block.get("_index").and_then(Value::as_u64) == Some(index as u64))
        {
            block["signature"] = json!(signature);
        }
    }

    fn push_redacted_thinking(&mut self, index: usize, data: String) {
        self.thinking_blocks.push(json!({
            "_index": index,
            "type": "redacted_thinking",
            "data": data,
        }));
    }

    fn finalized_thinking_blocks(&self) -> Vec<Value> {
        let mut blocks = self.thinking_blocks.clone();
        blocks.sort_by_key(|block| block.get("_index").and_then(Value::as_u64).unwrap_or(0));
        for block in &mut blocks {
            if let Some(object) = block.as_object_mut() {
                object.remove("_index");
            }
        }
        blocks
    }

    fn start_tool_call(&mut self, index: usize, id: String, name: String) {
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

    fn push_tool_arguments(&mut self, index: usize, partial_json: &str) {
        if let Some(call) = self.tool_calls.iter_mut().find(|call| call.index == index) {
            call.arguments.push_str(partial_json);
        }
    }
}

fn agent_tool_definitions() -> Vec<AgentToolDefinition> {
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
            description: r#"执行 shell 命令。返回 stdout、stderr 和退出码。
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
尽量使用绝对路径避免使用 `cd` 来保持当前工作目录。只有在用户明确要求时才使用 `cd`。"#,
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "要执行的 shell 命令。" },
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
    ]
}

fn filtered_agent_tool_definitions(options: &AgentRunOptions) -> Vec<AgentToolDefinition> {
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

fn openai_tool_definitions(options: &AgentRunOptions) -> Vec<Value> {
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

fn anthropic_tool_definitions(options: &AgentRunOptions) -> Vec<Value> {
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
    let execution =
        match execute_agent_tool_inner(app, run_id, request, options.clone(), tool_call_id, tool_name, &parsed)
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
            let result = tool_read(
                required_string(input, "file_path")?,
                optional_usize(input, "offset"),
                optional_usize(input, "limit"),
                request.workspace_path.clone(),
            );
            result_to_agent_execution(result).map(|output| (output, None))
        }
        "write" => {
            let file_path = required_string(input, "file_path")?;
            ensure_write_path_allowed(request, &file_path)?;
            let result = tool_write(app.clone(), file_path, required_string(input, "content")?, request.workspace_path.clone());
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
            let result = tool_grep(
                required_string(input, "pattern")?,
                optional_string(input, "path"),
                optional_string(input, "include"),
                request.workspace_path.clone(),
            );
            result_to_agent_execution(result).map(|output| (output, None))
        }
        "glob" => {
            let result = tool_glob(
                required_string(input, "pattern")?,
                optional_string(input, "path"),
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
            let output = run_subagent_agent_loop(app, run_id, request, task, tool_call_id.to_string()).await?;
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
                run_anthropic_agent_loop(app, run_id, &child_request, AgentRunOptions::subagent(Some(parent_tool_call_id)))
                    .await
            }
            _ => {
                run_openai_agent_loop(app, run_id, &child_request, AgentRunOptions::subagent(Some(parent_tool_call_id)))
                    .await
            }
        };

        match result {
            Ok(output) => Ok(format_subagent_success_output(&output)),
            Err(error) => Err(format_subagent_error_output(&error)),
        }
    })
}

fn format_subagent_success_output(output: &str) -> String {
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

fn format_subagent_error_output(error: &str) -> String {
    format!("Sub-agent error: {}", error)
}

fn append_subagent_system_prompt(system_prompt: &str) -> String {
    let mut prompt = system_prompt.trim().to_string();
    if !prompt.is_empty() {
        prompt.push_str("\n\n");
    }
    prompt.push_str(
        "## 子 Agent 模式\n你正在作为一个独立的子 Agent 执行父 Agent 交给你的子任务。请只围绕子任务工作，必要时使用可用工具，并在完成后返回清晰、简洁的结果。你不能再调用 subagent。",
    );
    prompt
}

fn result_to_agent_execution(result: ToolResult) -> Result<String, String> {
    if result.success {
        Ok(result.output)
    } else {
        Err(result.output)
    }
}

fn bash_result_to_agent_execution(result: BashToolResult) -> Result<String, String> {
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

fn normalize_agent_tool_output(success: bool, output: &str) -> String {
    let status = if success { "success" } else { "error" };
    let normalized = truncate_chars(output, MAX_AGENT_TOOL_OUTPUT_CHARS);
    format!("status: {}\n{}", status, normalized)
}

fn parse_tool_arguments(arguments: &str) -> Value {
    serde_json::from_str(arguments).unwrap_or_else(|_| json!({}))
}

fn required_string(input: &Value, key: &str) -> Result<String, String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(String::from)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Error: {} is required", key))
}

fn optional_string(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(String::from)
        .filter(|value| !value.trim().is_empty())
}

fn optional_usize(input: &Value, key: &str) -> Option<usize> {
    input
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
}

fn optional_u64(input: &Value, key: &str) -> Option<u64> {
    input.get(key).and_then(Value::as_u64)
}

fn parse_todos(input: &Value) -> Result<Vec<TodoItem>, String> {
    let todos = input
        .get("todos")
        .cloned()
        .ok_or_else(|| String::from("Error: todos is required"))?;
    serde_json::from_value(todos).map_err(|error| format!("Error: invalid todos: {}", error))
}

fn parse_openai_stream_event(data: &str) -> Option<OpenAiStreamEvent> {
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

fn parse_anthropic_stream_event(data: &str) -> Option<AnthropicStreamEvent> {
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

fn assemble_system_prompt(
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

    let sys_time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    prompt.push_str(&format!(
        "\n\n## 系统信息\n- **当前时间戳**：{}\n- **操作系统**：{}\n- **Python 环境**：{}\n- **可用 Skills**：\n",
        sys_time,
        std::env::consts::OS,
        get_python_info()
    ));

    let skills = discover_skills(app);
    if skills.is_empty() {
        prompt.push_str("  （无可用 skill）\n");
    } else {
        for skill in skills {
            prompt.push_str(&format!("  - `{}`: {}\n", skill.name, skill.description));
        }
    }

    Ok(prompt)
}

fn build_workspace_context(request: &ChatStreamRequest) -> String {
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

    if let Some(files) = &request.selected_reference_files {
        if !files.is_empty() {
            lines.push(String::from("\n## 范文参考"));
            lines.push(String::from("用户为你提供了以下范文作为写作参考，请仔细研读并在写作中参考其风格和结构："));
            for file_path in files {
                if let Ok(content) = std::fs::read_to_string(file_path) {
                    lines.push(format!("\n### 范文：{}\n```\n{}\n```", file_path, content));
                }
            }
        }
    }

    lines.join("\n")
}

fn build_openai_endpoint(base_url: &str) -> String {
    build_endpoint(base_url, "v1/chat/completions", "chat/completions")
}

fn build_anthropic_endpoint(base_url: &str) -> String {
    build_endpoint(base_url, "v1/messages", "messages")
}

fn anthropic_thinking_config(thinking_depth: Option<&str>, max_tokens: u32) -> Option<Value> {
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

fn build_endpoint(base_url: &str, default_path: &str, terminal_path: &str) -> String {
    let trimmed_base = base_url.trim().trim_end_matches('/');
    if trimmed_base.ends_with(terminal_path) {
        return trimmed_base.to_string();
    }
    if trimmed_base.ends_with("/v1") {
        return format!("{}/{}", trimmed_base, terminal_path);
    }
    format!("{}/{}", trimmed_base, default_path)
}

fn process_sse_buffer(buffer: &mut String, mut handle_data: impl FnMut(&str)) {
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

fn agent_sessions_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("agent-sessions"))
}

fn agent_session_path(app: &AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    let safe_id = sanitize_session_id(id)?;
    Ok(agent_sessions_dir(app)?.join(format!("{}.json", safe_id)))
}

fn sanitize_session_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err(String::from("session id 不能为空"));
    }
    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err(String::from("session id 包含非法字符"));
    }
    Ok(trimmed.to_string())
}

fn now_millis() -> Result<u64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    u64::try_from(millis).map_err(|_| String::from("当前时间戳过大"))
}

fn read_file_with_lines(file_path: &str, offset: usize, limit: usize) -> Result<String, String> {
    let path = expand_path(None, file_path);
    if !path.exists() {
        return Err(format!("Error: {} not found", path.display()));
    }
    if !path.is_file() {
        return Err(format!(
            "Error: {} is a directory, not a file",
            path.display()
        ));
    }

    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let lines: Vec<&str> = text.lines().collect();
    if lines.is_empty() {
        return Ok(String::from("(empty file)"));
    }

    let start = offset.saturating_sub(1);
    let limit = limit.clamp(1, MAX_READ_LINES);
    let chunk = lines.iter().skip(start).take(limit);
    let mut output = Vec::new();
    for (index, line) in chunk.enumerate() {
        output.push(format!("{}\t{}", start + index + 1, line));
    }
    if lines.len() > start + limit {
        output.push(format!(
            "... ({} lines total, showing {}-{})",
            lines.len(),
            start + 1,
            start + output.len()
        ));
    }

    Ok(output.join("\n"))
}

fn result_to_tool_result(result: Result<String, String>) -> ToolResult {
    match result {
        Ok(output) => ToolResult {
            success: true,
            output,
        },
        Err(output) => ToolResult {
            success: false,
            output,
        },
    }
}

fn expand_path(base_dir: Option<&str>, path: &str) -> std::path::PathBuf {
    if path == "~" {
        if let Some(home) = env::var_os("HOME") {
            return home.into();
        }
    }
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Some(home) = env::var_os("HOME") {
            return Path::new(&home).join(stripped);
        }
    }
    let p = Path::new(path);
    if p.is_absolute() {
        return p.to_path_buf();
    }
    if let Some(base) = base_dir {
        if !base.trim().is_empty() {
            return Path::new(base).join(p);
        }
    }
    std::env::current_dir().unwrap_or_default().join(p)
}

fn normalize_tool_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn ensure_write_path_allowed(request: &ChatStreamRequest, file_path: &str) -> Result<(), String> {
    let Some(allowed_paths) = &request.allowed_write_paths else {
        return Ok(());
    };

    let requested_path = normalize_tool_path(&expand_path(request.workspace_path.as_deref(), file_path));
    let is_allowed = allowed_paths
        .iter()
        .map(|path| normalize_tool_path(&expand_path(request.workspace_path.as_deref(), path)))
        .any(|allowed_path| allowed_path == requested_path);

    if is_allowed {
        Ok(())
    } else {
        Err(format!(
            "Error: this Agent run can only write the selected version file. Refused write to {}",
            requested_path
        ))
    }
}

fn count_lines(content: &str) -> usize {
    content.matches('\n').count() + usize::from(!content.is_empty() && !content.ends_with('\n'))
}

fn simple_diff(old: &str, new: &str) -> String {
    let old_lines: Vec<&str> = old.lines().collect();
    let new_lines: Vec<&str> = new.lines().collect();
    let mut lines = vec![String::from("--- before"), String::from("+++ after")];
    for line in old_lines
        .iter()
        .filter(|line| !new_lines.contains(line))
        .take(20)
    {
        lines.push(format!("-{}", line));
    }
    for line in new_lines
        .iter()
        .filter(|line| !old_lines.contains(line))
        .take(20)
    {
        lines.push(format!("+{}", line));
    }
    lines.join("\n")
}

fn dangerous_command_reason(command: &str) -> Option<&'static str> {
    let patterns = [
        (
            r"\brm\s+(-\w*)?-r\w*\s+(/|~|\$HOME)",
            "recursive delete on home/root",
        ),
        (r"\brm\s+(-\w*)?-rf\s", "force recursive delete"),
        (r"\bmkfs\b", "format filesystem"),
        (r"\bdd\s+.*of=/dev/", "raw disk write"),
        (r">\s*/dev/sd[a-z]", "overwrite block device"),
        (r"\bchmod\s+(-R\s+)?777\s+/", "chmod 777 on root"),
        (r":\(\)\s*\{.*:\|:.*\}", "fork bomb"),
        (r"\bcurl\b.*\|\s*(sudo\s+)?bash", "pipe curl to bash"),
        (r"\bwget\b.*\|\s*(sudo\s+)?bash", "pipe wget to bash"),
    ];

    patterns.iter().find_map(|(pattern, reason)| {
        Regex::new(pattern)
            .ok()
            .filter(|regex| regex.is_match(command))
            .map(|_| *reason)
    })
}

fn avoid_command_reason(command: &str) -> Option<&'static str> {
    let avoid_commands = ["cat", "head", "tail", "sed", "awk", "echo", "find", "grep"];

    for cmd in avoid_commands.iter() {
        // Match word boundaries to prevent matching sub-strings (e.g., "concatenate" shouldn't match "cat")
        let pattern = format!(r"\b{}\b", cmd);
        if let Ok(regex) = Regex::new(&pattern) {
            if regex.is_match(command) {
                return Some("Avoid using basic utility commands. Use dedicated tools (read, write, edit, grep, glob) instead.");
            }
        }
    }
    None
}

fn shell_path() -> String {
    env::var("SHELL").unwrap_or_else(|_| String::from("/bin/zsh"))
}

fn truncate_middle(content: String, max_chars: usize) -> String {
    let char_count = content.chars().count();
    if char_count <= max_chars {
        return content;
    }

    let head: String = content.chars().take(6000).collect();
    let tail: String = content
        .chars()
        .rev()
        .take(3000)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    format!(
        "{}\n\n... truncated ({} chars total) ...\n\n{}",
        head, char_count, tail
    )
}

fn truncate_chars(content: &str, max_chars: usize) -> String {
    if content.chars().count() <= max_chars {
        content.to_string()
    } else {
        format!(
            "{}\n... (truncated)",
            content.chars().take(max_chars).collect::<String>()
        )
    }
}

fn collect_grep_files(
    base: &Path,
    include: Option<&str>,
) -> Result<Vec<std::path::PathBuf>, String> {
    if base.is_file() {
        return Ok(vec![base.to_path_buf()]);
    }
    if !base.is_dir() {
        return Err(format!("Error: {} is not a directory", base.display()));
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(base).into_iter().filter_entry(|entry| {
        let name = entry.file_name().to_string_lossy();
        !matches!(
            name.as_ref(),
            ".git"
                | "node_modules"
                | "__pycache__"
                | ".venv"
                | "venv"
                | ".tox"
                | "dist"
                | "build"
                | "target"
        )
    }) {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Some(include) = include {
            let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !glob_match(include, file_name) {
                continue;
            }
        }
        files.push(path.to_path_buf());
        if files.len() >= 5000 {
            break;
        }
    }
    Ok(files)
}

fn glob_match(pattern: &str, file_name: &str) -> bool {
    let temp = env::temp_dir().join(file_name);
    glob::Pattern::new(pattern)
        .map(|pattern| pattern.matches_path(&temp) || pattern.matches(file_name))
        .unwrap_or(false)
}

static PYTHON_INFO: OnceLock<String> = OnceLock::new();

fn get_python_info() -> &'static str {
    PYTHON_INFO.get_or_init(|| {
        let output = std::process::Command::new("python3")
            .arg("--version")
            .output()
            .or_else(|_| {
                std::process::Command::new("python")
                    .arg("--version")
                    .output()
            });

        let version = match output {
            Ok(out) if out.status.success() => {
                let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if stdout.is_empty() {
                    String::from_utf8_lossy(&out.stderr).trim().to_string()
                } else {
                    stdout
                }
            }
            _ => String::from("未检测到 Python 环境"),
        };

        let path_output = std::process::Command::new("which")
            .arg("python3")
            .output()
            .or_else(|_| std::process::Command::new("which").arg("python").output());

        let path = match path_output {
            Ok(out) if out.status.success() => {
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            }
            _ => String::from("未知"),
        };

        if version.contains("未检测到") {
            version
        } else {
            format!("{} ({})", version, path)
        }
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillDefinition {
    name: String,
    description: String,
    path: std::path::PathBuf,
}

fn discover_skills(app: Option<&AppHandle>) -> Vec<SkillDefinition> {
    let mut roots = Vec::new();
    if let Some(app_handle) = app {
        if let Ok(dir) = app_handle.path().app_data_dir() {
            roots.push(dir.join("skills"));
        }
    }

    let mut skills = Vec::new();
    for root in roots {
        collect_skills_from_root(&root, &mut skills);
    }
    skills
}

fn collect_skills_from_root(root: &Path, skills: &mut Vec<SkillDefinition>) {
    if !root.is_dir() {
        return;
    }
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.join("SKILL.md").is_file() {
            if let Some(skill) = parse_skill_definition(&path) {
                skills.push(skill);
            }
            continue;
        }
        if path.is_dir() {
            let Ok(nested_entries) = fs::read_dir(path) else {
                continue;
            };
            for nested in nested_entries.flatten() {
                let nested_path = nested.path();
                if nested_path.join("SKILL.md").is_file() {
                    if let Some(skill) = parse_skill_definition(&nested_path) {
                        skills.push(skill);
                    }
                }
            }
        }
    }
}

fn parse_skill_definition(path: &Path) -> Option<SkillDefinition> {
    let body = fs::read_to_string(path.join("SKILL.md")).ok()?;
    let name = extract_frontmatter_value(&body, "name").or_else(|| {
        path.file_name()
            .and_then(|name| name.to_str())
            .map(String::from)
    })?;
    let description = extract_frontmatter_value(&body, "description").unwrap_or_default();
    Some(SkillDefinition {
        name,
        description,
        path: path.to_path_buf(),
    })
}

fn extract_frontmatter_value(body: &str, key: &str) -> Option<String> {
    body.lines().find_map(|line| {
        let (left, right) = line.split_once(':')?;
        if left.trim() == key {
            Some(right.trim().trim_matches('"').to_string())
        } else {
            None
        }
    })
}

fn list_skill_files(root: &Path) -> Vec<String> {
    let mut files = vec![root.join("SKILL.md").display().to_string()];
    for entry in WalkDir::new(root).max_depth(3).into_iter().flatten() {
        let path = entry.path();
        if !path.is_file() || path.file_name().is_some_and(|name| name == "SKILL.md") {
            continue;
        }
        files.push(path.display().to_string());
        if files.len() >= 24 {
            break;
        }
    }
    files
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in walkdir::WalkDir::new(src) {
        let entry = entry.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let ty = entry.file_type();
        let dest_path = dst.join(entry.path().strip_prefix(src).unwrap());
        if ty.is_dir() {
            fs::create_dir_all(&dest_path)?;
        } else if ty.is_file() {
            fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn import_skill(app: AppHandle, path: String) -> Result<SkillDefinition, String> {
    let source = Path::new(&path);
    if !source.is_dir() {
        return Err("指定的路径不是一个有效的文件夹".to_string());
    }
    if !source.join("SKILL.md").is_file() {
        return Err("文件夹中未找到 SKILL.md 文件".to_string());
    }

    let skill =
        parse_skill_definition(source).ok_or_else(|| "无法解析 SKILL.md 信息".to_string())?;

    let skills_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("skills");
    let dest = skills_dir.join(&skill.name);

    if dest.exists() {
        return Err(format!(
            "Skill '{}' 已存在，请先删除旧版本或重命名。",
            skill.name
        ));
    }

    copy_dir_recursive(source, &dest).map_err(|e| format!("复制文件夹失败: {}", e))?;

    parse_skill_definition(&dest).ok_or_else(|| "成功复制，但验证解析失败".to_string())
}

#[tauri::command]
fn delete_skill(app: AppHandle, name: String) -> Result<(), String> {
    let dest = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("skills")
        .join(&name);
    if !dest.exists() {
        return Err(format!("Skill '{}' 不存在", name));
    }
    fs::remove_dir_all(&dest).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_skills(app: AppHandle) -> Result<Vec<SkillDefinition>, String> {
    Ok(discover_skills(Some(&app)))
}

fn copy_md_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in walkdir::WalkDir::new(src) {
        let entry = entry.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        if entry
            .path()
            .components()
            .any(|component| component.as_os_str().to_string_lossy().starts_with('.'))
        {
            continue;
        }

        let ty = entry.file_type();
        let relative_path = entry.path().strip_prefix(src).unwrap();
        if relative_path.as_os_str().is_empty() {
            continue;
        }

        let dest_path = dst.join(relative_path);
        if ty.is_file() {
            if is_supported_content_file(entry.path()) {
                if let Some(parent) = dest_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::copy(entry.path(), &dest_path)?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn import_workspace_item(
    app: AppHandle,
    source_path: String,
    dir_type: String,
) -> Result<String, String> {
    let source = Path::new(&source_path);
    if !source.exists() {
        return Err("Source path does not exist".to_string());
    }

    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(&dir_type);

    fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;

    let file_name = source.file_name().ok_or("Invalid file name")?;
    let mut dest = base_dir.join(file_name);

    if dest.exists() {
        let stem = Path::new(file_name).file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let ext = Path::new(file_name).extension().and_then(|e| e.to_str()).map(|e| format!(".{}", e)).unwrap_or_default();
        let mut count = 1;
        loop {
            let new_name = format!("{} ({}){}", stem, count, ext);
            dest = base_dir.join(&new_name);
            if !dest.exists() {
                break;
            }
            count += 1;
        }
    }

    if source.is_file() {
        if !is_supported_content_file(source) {
            return Err("仅支持 Markdown 和图片文件".to_string());
        }
        fs::copy(source, &dest).map_err(|e| e.to_string())?;
    } else if source.is_dir() {
        copy_md_dir_recursive(source, &dest).map_err(|e| format!("Copy failed: {}", e))?;
    }

    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
fn delete_workspace_item(app: AppHandle, item_path: String) -> Result<(), String> {
    let target = Path::new(&item_path);
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
        
    let refs_dir = app_data_dir.join("references");
    let articles_dir = app_data_dir.join("articles");
    let outline_dir = app_data_dir.join("outline");

    if !target.starts_with(&refs_dir) && !target.starts_with(&articles_dir) && !target.starts_with(&outline_dir) {
        return Err("Cannot delete files outside of target directories".to_string());
    }

    if !target.exists() {
        return Ok(());
    }

    if target.is_dir() {
        fs::remove_dir_all(target).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_versions_meta_path(file_path: &Path) -> std::path::PathBuf {
    let parent = file_path.parent().unwrap_or(Path::new(""));
    let file_name = file_path.file_name().unwrap_or_default();
    parent
        .join(".versions")
        .join(format!("{}.meta.json", file_name.to_string_lossy()))
}

fn get_version_file_path(file_path: &Path, version_id: &str) -> std::path::PathBuf {
    let parent = file_path.parent().unwrap_or(Path::new(""));
    let file_name = file_path.file_name().unwrap_or_default();
    parent.join(".versions").join(file_name).join(version_id)
}

#[tauri::command]
fn list_file_versions(path: String) -> Result<Vec<VersionInfo>, String> {
    let target = Path::new(&path);
    let meta_path = get_versions_meta_path(target);
    if !meta_path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
    let meta: FileVersionsMetadata = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(meta.versions)
}

#[tauri::command]
fn create_file_version(path: String) -> Result<VersionInfo, String> {
    let target = Path::new(&path);
    if !target.exists() || !target.is_file() {
        return Err("Target file does not exist".to_string());
    }

    let version_id = Uuid::new_v4().to_string();
    let version_file_path = get_version_file_path(target, &version_id);

    if let Some(parent) = version_file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::copy(target, &version_file_path).map_err(|e| e.to_string())?;

    let meta_path = get_versions_meta_path(target);
    let mut meta = if meta_path.exists() {
        let content = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(FileVersionsMetadata {
            versions: Vec::new(),
        })
    } else {
        if let Some(parent) = meta_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        FileVersionsMetadata {
            versions: Vec::new(),
        }
    };

    let version_info = VersionInfo {
        id: version_id,
        timestamp: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        ai_score: None,
        suggestion: None,
    };

    meta.versions.push(version_info.clone());

    fs::write(&meta_path, serde_json::to_string(&meta).unwrap()).map_err(|e| e.to_string())?;

    Ok(version_info)
}

#[tauri::command]
fn read_file_version(path: String, version_id: String) -> Result<String, String> {
    let target = Path::new(&path);
    let version_file_path = get_version_file_path(target, &version_id);
    if !version_file_path.exists() {
        return Err("Version file does not exist".to_string());
    }
    fs::read_to_string(version_file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_file_version(path: String, version_id: String) -> Result<(), String> {
    let target = Path::new(&path);
    let version_file_path = get_version_file_path(target, &version_id);
    if version_file_path.exists() {
        fs::remove_file(version_file_path).map_err(|e| e.to_string())?;
    }

    let meta_path = get_versions_meta_path(target);
    if meta_path.exists() {
        let content = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
        let mut meta: FileVersionsMetadata =
            serde_json::from_str(&content).map_err(|e| e.to_string())?;
        meta.versions.retain(|v| v.id != version_id);
        fs::write(&meta_path, serde_json::to_string(&meta).unwrap()).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn update_version_ai_score(path: String, version_id: String, score: u32) -> Result<(), String> {
    update_version_ai_result(path, version_id, score, None)
}

#[tauri::command]
fn update_version_ai_result(
    path: String,
    version_id: String,
    score: u32,
    suggestion: Option<String>,
) -> Result<(), String> {
    let target = Path::new(&path);
    let meta_path = get_versions_meta_path(target);
    if !meta_path.exists() {
        return Err("Version metadata does not exist".to_string());
    }

    let content = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
    let mut meta: FileVersionsMetadata =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let mut found = false;
    for v in &mut meta.versions {
        if v.id == version_id {
            v.ai_score = Some(score);
            if let Some(next_suggestion) = suggestion {
                v.suggestion = Some(next_suggestion);
            }
            found = true;
            break;
        }
    }

    if !found {
        return Err("Version not found".to_string());
    }

    fs::write(&meta_path, serde_json::to_string(&meta).unwrap()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_workspace_dir(app: AppHandle, dir_type: String) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
        
    let old_de_ai = app_data_dir.join("de_ai");
    if old_de_ai.exists() {
        let old_ref = old_de_ai.join("references");
        let old_works = old_de_ai.join("works");
        
        let new_ref = app_data_dir.join("references");
        let new_articles = app_data_dir.join("articles");
        
        if old_ref.exists() && !new_ref.exists() {
            let _ = fs::rename(&old_ref, &new_ref);
        }
        if old_works.exists() && !new_articles.exists() {
            let _ = fs::rename(&old_works, &new_articles);
        }
        
        let _ = fs::remove_dir_all(&old_de_ai);
    }
    
    let dir = app_data_dir.join(&dir_type);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn rename_item(path: String, new_name: String) -> Result<(), String> {
    fs_commands::rename_item_cmd(path, new_name)
}

#[tauri::command]
fn move_item(app: AppHandle, source: String, target_dir: String) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let refs_dir = app_data_dir.join("references");
    let articles_dir = app_data_dir.join("articles");
    let outline_dir = app_data_dir.join("outline");
    let source_path = Path::new(&source);
    let target_path = Path::new(&target_dir);
    let source_canonical = source_path.canonicalize().map_err(|e| e.to_string())?;
    let target_canonical = target_path.canonicalize().map_err(|e| e.to_string())?;
    let roots = [refs_dir, articles_dir, outline_dir];
    let is_allowed_move = roots.iter().any(|root| {
        root.exists()
            && root
                .canonicalize()
                .map(|canonical_root| {
                    source_canonical.starts_with(&canonical_root)
                        && target_canonical.starts_with(&canonical_root)
                })
                .unwrap_or(false)
    });

    if !is_allowed_move {
        return Err("只能在同个工作区内部移动文件".to_string());
    }

    fs_commands::move_item_cmd(source, target_dir)
}

#[tauri::command]
fn import_local_folder_shallow(source: String, target_dir: String) -> Result<String, String> {
    fs_commands::import_local_folder_shallow_cmd(source, target_dir)
}

#[tauri::command]
fn crawl_fanqie_article(url: String, novel_type: String, target_dir: String) -> Result<String, String> {
    crawler::crawl_fanqie_article(&url, &novel_type, &target_dir)
}

#[tauri::command]
fn create_untitled_item(target_dir: String, is_dir: bool) -> Result<String, String> {
    fs_commands::create_untitled_item_cmd(target_dir, is_dir)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            list_dir,
            read_file,
            read_image_data_url,
            write_file,
            create_file,
            create_dir,
            rename_path,
            delete_path,
            file_modified_at,
            tool_read,
            tool_write,
            tool_edit,
            tool_bash,
            resolve_bash_permission,
            tool_grep,
            tool_glob,
            tool_skill,
            tool_subagent,
            tool_todo,
            create_file_version,
            read_file_version,
            list_file_versions,
            delete_file_version,
            update_version_ai_score,
            update_version_ai_result,
            list_agent_sessions,
            load_agent_session,
            save_agent_session,
            summarize_text,
            update_agent_session_title,
            start_chat_completion_stream,
            import_skill,
            delete_skill,
            get_skills,
            stop_chat_stream,
            import_workspace_item,
            delete_workspace_item,
            get_workspace_dir,
            rename_item,
            move_item,
            import_local_folder_shallow,
            crawl_fanqie_article,
            create_untitled_item
        ])
        .manage(ActiveStreams(Mutex::new(HashMap::new())))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    fn temp_path(name: &str) -> std::path::PathBuf {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be after epoch")
            .as_millis();
        env::temp_dir().join(format!("museai_tool_test_{}_{}", millis, name))
    }

    #[test]
    fn tool_read_returns_line_numbers() {
        let path = temp_path("read.txt");
        fs::write(&path, "line1\nline2\nline3\n").expect("write temp file");

        let result = tool_read(path.display().to_string(), Some(2), Some(1), None);

        assert!(result.success);
        assert_eq!(result.output, "2\tline2\n... (3 lines total, showing 2-2)");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn tool_write_creates_parent_dirs() {
        // Disabled since AppHandle is required
    }

    #[test]
    fn tool_edit_requires_unique_match() {
        // Disabled since AppHandle is required
    }

    #[test]
    fn tool_grep_finds_matching_lines() {
        let dir = temp_path("grep");
        fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("story.md");
        fs::write(&path, "第一行\n关键词\n").expect("write temp file");

        let result = tool_grep(
            "关键词".to_string(),
            Some(dir.display().to_string()),
            Some("*.md".to_string()),
            None
        );

        assert!(result.success);
        assert!(result.output.contains("story.md:2: 关键词"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn tool_bash_blocks_dangerous_command() {
        assert!(dangerous_command_reason("rm -rf /").is_some());
    }

    #[test]
    fn tool_todo_rejects_multiple_in_progress_items() {
        let result = tool_todo(vec![
            TodoItem {
                content: "A".to_string(),
                active_form: "Doing A".to_string(),
                status: "in_progress".to_string(),
            },
            TodoItem {
                content: "B".to_string(),
                active_form: "Doing B".to_string(),
                status: "in_progress".to_string(),
            },
        ]);

        assert!(!result.success);
        assert!(result.output.contains("only one todo"));
    }

    #[test]
    fn agent_tool_registry_includes_required_tools() {
        let tools = agent_tool_definitions();
        let names: Vec<&str> = tools.iter().map(|tool| tool.name).collect();

        for name in [
            "read", "write", "edit", "bash", "grep", "glob", "skill", "subagent", "todo",
        ] {
            assert!(names.contains(&name), "missing tool: {}", name);
        }
        assert!(openai_tool_definitions(&AgentRunOptions::parent())
            .iter()
            .any(|tool| tool["function"]["name"] == "read"));
        assert!(anthropic_tool_definitions(&AgentRunOptions::parent())
            .iter()
            .any(|tool| tool["name"] == "todo"));
    }

    #[test]
    fn subagent_tool_registry_omits_recursive_subagent() {
        let tools = filtered_agent_tool_definitions(&AgentRunOptions::subagent(None));
        let names: Vec<&str> = tools.iter().map(|tool| tool.name).collect();

        for name in [
            "read", "write", "edit", "bash", "grep", "glob", "skill", "todo",
        ] {
            assert!(names.contains(&name), "missing child tool: {}", name);
        }
        assert!(!names.contains(&"subagent"));
        assert!(!openai_tool_definitions(&AgentRunOptions::subagent(None))
            .iter()
            .any(|tool| tool["function"]["name"] == "subagent"));
        assert!(!anthropic_tool_definitions(&AgentRunOptions::subagent(None))
            .iter()
            .any(|tool| tool["name"] == "subagent"));
    }

    #[test]
    fn direct_subagent_command_requires_runtime_context() {
        let empty = tool_subagent("   ".to_string());
        assert!(!empty.success);
        assert!(empty.output.contains("task is required"));

        let direct = tool_subagent("检查一致性".to_string());
        assert!(!direct.success);
        assert!(direct.output.contains("active Agent chat run"));
    }

    #[test]
    fn subagent_output_truncation_adds_marker() {
        let output = format_subagent_success_output(&"x".repeat(MAX_SUBAGENT_OUTPUT_CHARS + 10));

        assert!(output.starts_with("[Sub-agent completed]"));
        assert!(output.contains("... (truncated)"));
        assert!(output.chars().count() < MAX_SUBAGENT_OUTPUT_CHARS + 60);
    }

    #[test]
    fn subagent_result_is_model_visible_tool_output() {
        let success = normalize_agent_tool_output(true, &format_subagent_success_output("done"));
        let error =
            normalize_agent_tool_output(false, &format_subagent_error_output("provider failed"));

        assert!(success.starts_with("status: success"));
        assert!(success.contains("[Sub-agent completed]\ndone"));
        assert!(error.starts_with("status: error"));
        assert!(error.contains("Sub-agent error: provider failed"));
    }

    #[test]
    fn subagent_options_disallow_recursive_tool() {
        let options = AgentRunOptions::subagent(None);

        assert!(options.allows_tool("read"));
        assert!(!options.allows_tool("subagent"));
        assert_eq!(options.max_tool_rounds, MAX_SUBAGENT_TOOL_ROUNDS);
        assert!(!options.emit_events);
        assert!(!options.emit_todo_updates);
    }

    #[test]
    fn normalizes_agent_tool_output_with_status_and_truncation() {
        let output =
            normalize_agent_tool_output(true, &"x".repeat(MAX_AGENT_TOOL_OUTPUT_CHARS + 10));

        assert!(output.starts_with("status: success"));
        assert!(output.contains("... (truncated)"));
    }

    #[test]
    fn parse_openai_stream_delta() {
        let data = r#"{"choices":[{"delta":{"content":"你好"}}]}"#;
        let event = parse_openai_stream_event(data).expect("parse event");

        assert_eq!(event.content, Some("你好".to_string()));
    }

    #[test]
    fn parse_openai_stream_tool_call_chunks() {
        let mut result = OpenAiRoundResult::default();
        let first = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read","arguments":"{\"file_path\""}}]}}]}"#;
        let second = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\"README.md\"}"}}]}}]}"#;

        for data in [first, second] {
            let event = parse_openai_stream_event(data).expect("parse event");
            for chunk in event.tool_call_chunks {
                result.apply_tool_call_chunk(chunk);
            }
        }

        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "call_1");
        assert_eq!(result.tool_calls[0].name, "read");
        assert_eq!(
            result.tool_calls[0].arguments,
            r#"{"file_path":"README.md"}"#
        );
    }

    #[test]
    fn parse_anthropic_stream_delta() {
        let data = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}"#;
        let event = parse_anthropic_stream_event(data).expect("parse event");

        match event {
            AnthropicStreamEvent::Text(delta) => assert_eq!(delta, "你好"),
            _ => panic!("expected text delta"),
        }
    }

    #[test]
    fn parse_anthropic_stream_thinking_with_signature() {
        let start = r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}"#;
        let thinking = r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"先分析"}}"#;
        let signature = r#"{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig_1"}}"#;
        let mut result = AnthropicRoundResult::default();

        match parse_anthropic_stream_event(start).expect("parse start") {
            AnthropicStreamEvent::ThinkingStart { index } => result.start_thinking_block(index),
            _ => panic!("expected thinking start"),
        }
        match parse_anthropic_stream_event(thinking).expect("parse thinking") {
            AnthropicStreamEvent::ThinkingDelta { index, thinking } => {
                result.push_thinking_delta(index, &thinking);
            }
            _ => panic!("expected thinking delta"),
        }
        match parse_anthropic_stream_event(signature).expect("parse signature") {
            AnthropicStreamEvent::ThinkingSignature { index, signature } => {
                result.set_thinking_signature(index, signature);
            }
            _ => panic!("expected thinking signature"),
        }

        let blocks = result.finalized_thinking_blocks();
        assert_eq!(blocks[0]["type"], "thinking");
        assert_eq!(blocks[0]["thinking"], "先分析");
        assert_eq!(blocks[0]["signature"], "sig_1");
    }

    #[test]
    fn parse_anthropic_stream_tool_use() {
        let start = r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"grep","input":{}}}"#;
        let input = r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"pattern\":\"Agent\"}"}}"#;
        let mut result = AnthropicRoundResult::default();

        match parse_anthropic_stream_event(start).expect("parse start") {
            AnthropicStreamEvent::ToolStart { index, id, name } => {
                result.start_tool_call(index, id, name);
            }
            _ => panic!("expected tool start"),
        }
        match parse_anthropic_stream_event(input).expect("parse input") {
            AnthropicStreamEvent::ToolInputDelta {
                index,
                partial_json,
            } => {
                result.push_tool_arguments(index, &partial_json);
            }
            _ => panic!("expected tool input delta"),
        }

        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "toolu_1");
        assert_eq!(result.tool_calls[0].name, "grep");
        assert_eq!(result.tool_calls[0].arguments, r#"{"pattern":"Agent"}"#);
    }

    #[test]
    fn openai_history_messages_preserve_tool_protocol() {
        let history = vec![
            ChatMessage {
                role: "user".to_string(),
                content: "读取文件".to_string(),
                tool_call_id: None,
                tool_calls: None,
            },
            ChatMessage {
                role: "assistant".to_string(),
                content: "我来读取。".to_string(),
                tool_call_id: None,
                tool_calls: Some(vec![ChatToolCall {
                    id: "call_1".to_string(),
                    name: "read".to_string(),
                    arguments: r#"{"file_path":"README.md"}"#.to_string(),
                }]),
            },
            ChatMessage {
                role: "tool".to_string(),
                content: r#"{"success":true,"output":"内容"}"#.to_string(),
                tool_call_id: Some("call_1".to_string()),
                tool_calls: None,
            },
        ];

        let messages = openai_history_messages("系统", &history);

        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[2]["role"], "assistant");
        assert_eq!(messages[2]["tool_calls"][0]["id"], "call_1");
        assert_eq!(messages[2]["tool_calls"][0]["function"]["name"], "read");
        assert_eq!(
            messages[2]["tool_calls"][0]["function"]["arguments"],
            r#"{"file_path":"README.md"}"#
        );
        assert_eq!(messages[3]["role"], "tool");
        assert_eq!(messages[3]["tool_call_id"], "call_1");
    }

    #[test]
    fn anthropic_history_messages_preserve_tool_protocol() {
        let history = vec![
            ChatMessage {
                role: "assistant".to_string(),
                content: "我来读取。".to_string(),
                tool_call_id: None,
                tool_calls: Some(vec![ChatToolCall {
                    id: "toolu_1".to_string(),
                    name: "read".to_string(),
                    arguments: r#"{"file_path":"README.md"}"#.to_string(),
                }]),
            },
            ChatMessage {
                role: "tool".to_string(),
                content: r#"{"success":true,"output":"内容"}"#.to_string(),
                tool_call_id: Some("toolu_1".to_string()),
                tool_calls: None,
            },
        ];

        let messages = anthropic_history_messages(&history);

        assert_eq!(messages[0]["role"], "assistant");
        assert_eq!(messages[0]["content"][0]["type"], "text");
        assert_eq!(messages[0]["content"][1]["type"], "tool_use");
        assert_eq!(messages[0]["content"][1]["id"], "toolu_1");
        assert_eq!(messages[0]["content"][1]["input"]["file_path"], "README.md");
        assert_eq!(messages[1]["role"], "user");
        assert_eq!(messages[1]["content"][0]["type"], "tool_result");
        assert_eq!(messages[1]["content"][0]["tool_use_id"], "toolu_1");
    }

    #[test]
    fn trims_history_to_context_budget_keeps_recent_messages() {
        let history = vec![
            ChatMessage {
                role: "user".to_string(),
                content: "很早以前的消息".repeat(80),
                tool_call_id: None,
                tool_calls: None,
            },
            ChatMessage {
                role: "assistant".to_string(),
                content: "中间回复".repeat(80),
                tool_call_id: None,
                tool_calls: None,
            },
            ChatMessage {
                role: "user".to_string(),
                content: "最新问题".to_string(),
                tool_call_id: None,
                tool_calls: None,
            },
        ];

        let trimmed = trim_history_to_context_budget("系统提示", &history, Some(24));

        assert_eq!(trimmed.len(), 1);
        assert_eq!(trimmed[0].content, "最新问题");
    }

    #[test]
    fn trims_history_to_context_budget_drops_leading_tool_result() {
        let history = vec![
            ChatMessage {
                role: "assistant".to_string(),
                content: "我来读取。".repeat(80),
                tool_call_id: None,
                tool_calls: Some(vec![ChatToolCall {
                    id: "call_1".to_string(),
                    name: "read".to_string(),
                    arguments: r#"{"file_path":"README.md"}"#.to_string(),
                }]),
            },
            ChatMessage {
                role: "tool".to_string(),
                content: "工具结果".to_string(),
                tool_call_id: Some("call_1".to_string()),
                tool_calls: None,
            },
            ChatMessage {
                role: "user".to_string(),
                content: "继续".to_string(),
                tool_call_id: None,
                tool_calls: None,
            },
        ];

        let trimmed = trim_history_to_context_budget("系统提示", &history, Some(24));

        assert_eq!(trimmed.len(), 1);
        assert_eq!(trimmed[0].role, "user");
        assert_eq!(trimmed[0].content, "继续");
    }

    #[test]
    fn builds_openai_endpoint_from_base_or_full_url() {
        assert_eq!(
            build_openai_endpoint("https://api.openai.com"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            build_openai_endpoint("https://api.openai.com/v1"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            build_openai_endpoint("https://api.openai.com/v1/chat/completions"),
            "https://api.openai.com/v1/chat/completions"
        );
    }

    #[test]
    fn builds_anthropic_endpoint_from_base_or_full_url() {
        assert_eq!(
            build_anthropic_endpoint("https://api.anthropic.com"),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            build_anthropic_endpoint("https://api.kimi.com/coding/"),
            "https://api.kimi.com/coding/v1/messages"
        );
        assert_eq!(
            build_anthropic_endpoint("https://api.kimi.com/coding/v1/messages"),
            "https://api.kimi.com/coding/v1/messages"
        );
    }

    #[test]
    fn assemble_system_prompt_injects_selected_reference_library() {
        let dir = temp_path("reference");
        fs::create_dir_all(&dir).expect("create temp dir");
        fs::write(dir.join("设定.md"), "主角住在雾港。").expect("write reference file");
        fs::write(dir.join("image.png"), "not text").expect("write skipped file");

        let request = ChatStreamRequest {
            model_interface: "OpenAI-compatible".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "test".to_string(),
            model: "gpt-test".to_string(),
            temperature: Some(0.7),
            max_output_tokens: Some(1024),
            max_context_tokens: Some(4096),
            thinking_depth: None,
            system_prompt: "你是写作助手。".to_string(),
            workspace_path: Some("/Users/test/小说工作区".to_string()),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: "继续写。".to_string(),
                tool_call_id: None,
                tool_calls: None,
            }],
            selected_reference_files: Some(vec![dir.join("test.md").display().to_string()]),
            allowed_tools: None,
            allowed_write_paths: None,
        };

        fs::write(dir.join("test.md"), "这是一篇范文。").expect("write test file");

        let prompt = assemble_system_prompt(None, &request).expect("assemble prompt");

        assert!(prompt.contains("你是写作助手。"));
        assert!(prompt.contains("当前工作空间路径：/Users/test/小说工作区"));
        assert!(prompt.contains("这是一篇范文。"));
        assert!(prompt.contains("范文参考"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn version_ai_result_persists_and_overwrites_suggestion() {
        let dir = temp_path("version_result");
        fs::create_dir_all(&dir).expect("create temp dir");
        let file = dir.join("作品.md");
        fs::write(&file, "初始内容").expect("write work file");

        let version = create_file_version(file.display().to_string()).expect("create version");
        update_version_ai_result(
            file.display().to_string(),
            version.id.clone(),
            72,
            Some("减少排比句。".to_string()),
        )
        .expect("save first detector result");
        update_version_ai_result(
            file.display().to_string(),
            version.id.clone(),
            41,
            Some("增加具体动作。".to_string()),
        )
        .expect("overwrite detector result");

        let versions = list_file_versions(file.display().to_string()).expect("list versions");
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].ai_score, Some(41));
        assert_eq!(versions[0].suggestion.as_deref(), Some("增加具体动作。"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn version_metadata_without_suggestion_stays_readable() {
        let dir = temp_path("legacy_version_result");
        fs::create_dir_all(dir.join(".versions")).expect("create versions dir");
        let file = dir.join("作品.md");
        fs::write(&file, "初始内容").expect("write work file");
        let meta_path = get_versions_meta_path(&file);
        fs::write(
            &meta_path,
            r#"{"versions":[{"id":"legacy","timestamp":1,"aiScore":88}]}"#,
        )
        .expect("write legacy metadata");

        let versions = list_file_versions(file.display().to_string()).expect("list versions");
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].ai_score, Some(88));
        assert_eq!(versions[0].suggestion, None);

        let _ = fs::remove_dir_all(dir);
    }
}
