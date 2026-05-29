use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

use crate::models::*;

pub fn is_supported_content_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("md" | "txt" | "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg")
    )
}

#[tauri::command]
pub fn read_file_with_lines(
    file_path: &str,
    offset: usize,
    limit: usize,
) -> Result<String, String> {
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

pub fn result_to_tool_result(result: Result<String, String>) -> ToolResult {
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

pub fn expand_path(base_dir: Option<&str>, path: &str) -> std::path::PathBuf {
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

pub fn normalize_tool_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn normalize_path(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for comp in path.components() {
        match comp {
            std::path::Component::Prefix(p) => result.push(p.as_os_str()),
            std::path::Component::RootDir => result.push("/"),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                result.pop();
            }
            std::path::Component::Normal(name) => result.push(name),
        }
    }
    result
}

pub fn count_lines(content: &str) -> usize {
    content.matches('\n').count() + usize::from(!content.is_empty() && !content.ends_with('\n'))
}

pub fn simple_diff(old: &str, new: &str) -> String {
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

pub fn truncate_middle(content: String, max_chars: usize) -> String {
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
pub fn truncate_chars(content: &str, max_chars: usize) -> String {
    if content.chars().count() <= max_chars {
        content.to_string()
    } else {
        format!(
            "{}\n... (truncated)",
            content.chars().take(max_chars).collect::<String>()
        )
    }
}
pub fn collect_grep_files(
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
pub fn glob_match(pattern: &str, file_name: &str) -> bool {
    let temp = env::temp_dir().join(file_name);
    glob::Pattern::new(pattern)
        .map(|pattern| pattern.matches_path(&temp) || pattern.matches(file_name))
        .unwrap_or(false)
}
static PYTHON_INFO: OnceLock<String> = OnceLock::new();

pub fn get_python_info() -> &'static str {
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
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
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
pub fn copy_md_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
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
pub fn extract_frontmatter_value(body: &str, key: &str) -> Option<String> {
    body.lines().find_map(|line| {
        let (left, right) = line.split_once(':')?;
        if left.trim() == key {
            Some(right.trim().trim_matches('"').to_string())
        } else {
            None
        }
    })
}
pub fn now_millis() -> Result<u64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    u64::try_from(millis).map_err(|_| String::from("当前时间戳过大"))
}

pub fn sanitize_session_id(id: &str) -> Result<String, String> {
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
pub fn agent_sessions_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("agent-sessions"))
}

pub fn agent_session_path(app: &AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    let safe_id = sanitize_session_id(id)?;
    Ok(agent_sessions_dir(app)?.join(format!("{}.json", safe_id)))
}
