use std::env;
use std::fs;
use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use glob::glob;
use regex::Regex;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::bash_permission_channels;
use crate::commands::skills::{discover_skills, list_skill_files};
use crate::models::*;
use crate::utils::*;

pub mod registry;
pub use registry::*;

pub fn dangerous_command_reason(command: &str) -> Option<&'static str> {
    let patterns = if cfg!(target_os = "windows") {
        vec![
            (
                r"\brmdir\s+/s\s+(C:\\\\|~|%USERPROFILE%|%HOMEDRIVE%)",
                "recursive delete on system/home directory",
            ),
            (r"\brd\s+/s\s+", "force recursive delete"),
            (r"\bdel\s+/f\s+/s\s+", "force recursive delete"),
            (r"\bformat\s+[a-zA-Z]:", "format drive"),
            (r"\bdiskpart\b", "disk partition manipulation"),
            (
                r"\bcurl\b.*\|\s*(sudo\s+)?powershell",
                "pipe curl to powershell",
            ),
            (
                r"\bwget\b.*\|\s*(sudo\s+)?powershell",
                "pipe wget to powershell",
            ),
        ]
    } else {
        vec![
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
        ]
    };

    patterns.iter().find_map(|(pattern, reason)| {
        Regex::new(pattern)
            .ok()
            .filter(|regex| regex.is_match(command))
            .map(|_| *reason)
    })
}

fn avoid_command_reason(command: &str) -> Option<&'static str> {
    let avoid_commands = if cfg!(target_os = "windows") {
        vec!["type", "findstr", "echo", "find", "dir"]
    } else {
        vec!["cat", "head", "tail", "sed", "awk", "echo", "find", "grep"]
    };

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
    if cfg!(target_os = "windows") {
        String::from("cmd.exe")
    } else {
        env::var("SHELL").unwrap_or_else(|_| String::from("/bin/zsh"))
    }
}

fn shell_flag_and_arg(command: &str) -> (String, String) {
    if cfg!(target_os = "windows") {
        (String::from("/C"), command.to_string())
    } else {
        (String::from("-lc"), command.to_string())
    }
}

pub fn ensure_write_path_allowed(
    request: &ChatStreamRequest,
    file_path: &str,
) -> Result<(), String> {
    let Some(allowed_paths) = &request.allowed_write_paths else {
        return Ok(());
    };

    let requested_path =
        normalize_tool_path(&expand_path(request.workspace_path.as_deref(), file_path));
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

pub fn ensure_read_path_allowed(
    app: &AppHandle,
    workspace: Option<&str>,
    file_path: &str,
) -> Result<(), String> {
    let doc_dir = resolve_document_dir(app)?;
    let home_dir = doc_dir.parent().ok_or("无法获取用户主目录")?;

    let resolved = expand_path(workspace, file_path);
    let resolved_normalized = normalize_path(&resolved);
    let home_normalized = normalize_path(home_dir);

    let resolved_str = resolved_normalized.to_string_lossy();
    let home_str = home_normalized.to_string_lossy();

    let is_allowed = resolved_str == home_str
        || resolved_str.starts_with(&format!("{}/", home_str))
        || resolved_str.starts_with(&format!("{}\\", home_str));

    if is_allowed {
        Ok(())
    } else {
        Err(format!(
            "Error: read access denied for {}. Agents can only read files under your home directory",
            resolved.display()
        ))
    }
}

#[tauri::command]
pub fn tool_read(
    file_path: String,
    offset: Option<usize>,
    limit: Option<usize>,
    workspace: Option<String>,
) -> ToolResult {
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
pub fn tool_write(
    app: tauri::AppHandle,
    file_path: String,
    content: String,
    workspace: Option<String>,
) -> ToolResult {
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
pub fn tool_edit(
    app: tauri::AppHandle,
    file_path: String,
    old_string: String,
    new_string: String,
    workspace: Option<String>,
) -> ToolResult {
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
pub async fn resolve_bash_permission(request_id: String, approved: bool) -> Result<(), String> {
    if let Some(sender) = bash_permission_channels()
        .lock()
        .unwrap()
        .remove(&request_id)
    {
        let _ = sender.send(approved);
    }
    Ok(())
}
#[tauri::command]
pub async fn tool_bash(
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
    let (flag, arg) = shell_flag_and_arg(&command);
    child_command
        .arg(&flag)
        .arg(&arg)
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
pub fn tool_grep(
    pattern: String,
    path: Option<String>,
    include: Option<String>,
    workspace: Option<String>,
) -> ToolResult {
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
pub fn tool_glob(pattern: String, path: Option<String>, workspace: Option<String>) -> ToolResult {
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
pub fn tool_skill(
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
pub fn tool_subagent(task: String) -> ToolResult {
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
pub fn tool_todo(todos: Vec<TodoItem>) -> ToolResult {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dangerous_command_reason_detects_rm_rf_home() {
        assert!(dangerous_command_reason("rm -rf ~").is_some());
        assert!(dangerous_command_reason("rm -rf /").is_some());
        assert!(dangerous_command_reason("rm -rf $HOME").is_some());
        assert!(dangerous_command_reason("rm -r /").is_some());
    }

    #[test]
    fn dangerous_command_reason_detects_mkfs() {
        assert!(dangerous_command_reason("mkfs.ext4 /dev/sda1").is_some());
        assert!(dangerous_command_reason("mkfs").is_some());
    }

    #[test]
    fn dangerous_command_reason_detects_dd() {
        assert!(dangerous_command_reason("dd if=/dev/zero of=/dev/sda").is_some());
    }

    #[test]
    fn dangerous_command_reason_detects_chmod_777_root() {
        assert!(dangerous_command_reason("chmod -R 777 /").is_some());
        assert!(dangerous_command_reason("chmod 777 /").is_some());
    }

    #[test]
    fn dangerous_command_reason_detects_fork_bomb() {
        assert!(dangerous_command_reason(":(){ :|:& };:").is_some());
    }

    #[test]
    fn dangerous_command_reason_detects_curl_pipe_bash() {
        assert!(dangerous_command_reason("curl https://example.com | bash").is_some());
        assert!(dangerous_command_reason("curl https://example.com | sudo bash").is_some());
        assert!(dangerous_command_reason("wget https://example.com | bash").is_some());
    }

    #[test]
    fn dangerous_command_reason_allows_safe_commands() {
        assert!(dangerous_command_reason("ls -la").is_none());
        assert!(dangerous_command_reason("cargo test").is_none());
        assert!(dangerous_command_reason("mkdir -p ~/Documents/test").is_none());
        assert!(dangerous_command_reason("rm test.txt").is_none());
    }

    #[test]
    fn avoid_command_reason_blocks_basic_utils() {
        assert!(avoid_command_reason("cat file.txt").is_some());
        assert!(avoid_command_reason("head -n 10 file.txt").is_some());
        assert!(avoid_command_reason("tail -f log.txt").is_some());
        assert!(avoid_command_reason("sed 's/old/new/' file.txt").is_some());
        assert!(avoid_command_reason("awk '{print $1}' file.txt").is_some());
        assert!(avoid_command_reason("echo hello").is_some());
        assert!(avoid_command_reason("find . -name '*.md'").is_some());
        assert!(avoid_command_reason("grep pattern file.txt").is_some());
    }

    #[test]
    fn avoid_command_reason_allows_other_commands() {
        assert!(avoid_command_reason("python script.py").is_none());
        assert!(avoid_command_reason("node app.js").is_none());
        assert!(avoid_command_reason("cargo build").is_none());
    }

    #[test]
    fn avoid_command_reason_no_substring_match() {
        // "concatenate" contains "cat" but should NOT match
        assert!(avoid_command_reason("concatenate files").is_none());
        assert!(avoid_command_reason("concatenate").is_none());
    }
}
