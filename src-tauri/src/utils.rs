use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use std::sync::OnceLock;
use tauri::{AppHandle, Manager, Runtime};
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

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn resolve_document_dir_with_fallback(
    system_result: Result<PathBuf, String>,
    home: Option<PathBuf>,
    allow_linux_fallback: bool,
) -> Result<PathBuf, String> {
    match system_result {
        Ok(path) => Ok(path),
        Err(error) => {
            if allow_linux_fallback {
                if let Some(home) = home.filter(|path| !path.as_os_str().is_empty()) {
                    return Ok(home.join("Documents"));
                }
            }
            Err(error)
        }
    }
}

pub fn resolve_document_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    resolve_document_dir_with_fallback(
        app.path().document_dir().map_err(|error| error.to_string()),
        env::var_os("HOME").map(PathBuf::from),
        cfg!(target_os = "linux"),
    )
}

pub fn expand_path(base_dir: Option<&str>, path: &str) -> std::path::PathBuf {
    if path == "~" {
        if let Some(home) = home_dir() {
            return home;
        }
    }
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(stripped);
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
            std::path::Component::Prefix(p) => {
                result.push(p.as_os_str());
                if cfg!(target_os = "windows") {
                    match p.kind() {
                        std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_) => {
                            result.push("\\");
                        }
                        _ => {}
                    }
                }
            }
            std::path::Component::RootDir => {
                if !cfg!(target_os = "windows") || result.as_os_str().is_empty() {
                    result.push(std::path::MAIN_SEPARATOR_STR);
                }
            }
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

        let path_output = if cfg!(target_os = "windows") {
            std::process::Command::new("where").arg("python").output()
        } else {
            std::process::Command::new("which")
                .arg("python3")
                .output()
                .or_else(|_| std::process::Command::new("which").arg("python").output())
        };

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
        let entry = entry.map_err(std::io::Error::other)?;
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
        let entry = entry.map_err(std::io::Error::other)?;
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
        if ty.is_file()
            && is_supported_content_file(entry.path()) {
                if let Some(parent) = dest_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::copy(entry.path(), &dest_path)?;
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
    let doc_dir = resolve_document_dir(app)?;
    Ok(doc_dir.join("MuseAI").join("agent-sessions"))
}

pub fn agent_session_path(app: &AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    let safe_id = sanitize_session_id(id)?;
    Ok(agent_sessions_dir(app)?.join(format!("{}.json", safe_id)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_is_supported_content_file() {
        assert!(is_supported_content_file(Path::new("article.md")));
        assert!(is_supported_content_file(Path::new("notes.txt")));
        assert!(is_supported_content_file(Path::new("image.PNG")));
        assert!(is_supported_content_file(Path::new("photo.jpg")));
        assert!(!is_supported_content_file(Path::new("script.py")));
        assert!(!is_supported_content_file(Path::new("data.json")));
        assert!(!is_supported_content_file(Path::new("no_extension")));
    }

    #[test]
    fn test_expand_path_home() {
        let home = home_dir().expect("home dir should be resolvable");
        let result = expand_path(None, "~");
        assert_eq!(result, home);

        let result = expand_path(None, "~/Documents");
        assert_eq!(result, home.join("Documents"));
    }

    #[test]
    fn test_expand_path_absolute() {
        if cfg!(target_os = "windows") {
            let result = expand_path(None, "C:\\Program Files\\app");
            assert_eq!(result, PathBuf::from("C:\\Program Files\\app"));
        } else {
            let result = expand_path(None, "/usr/local/bin");
            assert_eq!(result, PathBuf::from("/usr/local/bin"));
        }
    }

    #[test]
    fn test_expand_path_relative_with_base() {
        if cfg!(target_os = "windows") {
            let result = expand_path(Some("C:\\base"), "subdir\\file.txt");
            assert_eq!(result, PathBuf::from("C:\\base\\subdir\\file.txt"));
        } else {
            let result = expand_path(Some("/base"), "subdir/file.txt");
            assert_eq!(result, PathBuf::from("/base/subdir/file.txt"));
        }
    }

    #[test]
    fn test_resolve_document_dir_prefers_system_path() {
        let system_dir = PathBuf::from("/custom/documents");
        let result = resolve_document_dir_with_fallback(
            Ok(system_dir.clone()),
            Some(PathBuf::from("/home/test")),
            true,
        );

        assert_eq!(result, Ok(system_dir));
    }

    #[test]
    fn test_resolve_document_dir_falls_back_on_linux() {
        let result = resolve_document_dir_with_fallback(
            Err("unknown path".to_string()),
            Some(PathBuf::from("/home/test")),
            true,
        );

        assert_eq!(result, Ok(PathBuf::from("/home/test/Documents")));
    }

    #[test]
    fn test_resolve_document_dir_rejects_empty_linux_home() {
        let result = resolve_document_dir_with_fallback(
            Err("unknown path".to_string()),
            Some(PathBuf::new()),
            true,
        );

        assert_eq!(result, Err("unknown path".to_string()));
    }

    #[test]
    fn test_resolve_document_dir_does_not_fallback_off_linux() {
        let result = resolve_document_dir_with_fallback(
            Err("unknown path".to_string()),
            Some(PathBuf::from("/home/test")),
            false,
        );

        assert_eq!(result, Err("unknown path".to_string()));
    }

    #[test]
    fn test_normalize_tool_path() {
        let path = Path::new("dir\\subdir\\file.txt");
        assert_eq!(normalize_tool_path(path), "dir/subdir/file.txt");
    }

    #[test]
    fn test_normalize_path() {
        let path = Path::new("/a/b/../c");
        assert_eq!(normalize_path(path), PathBuf::from("/a/c"));

        let path = Path::new("/a/./b/c");
        assert_eq!(normalize_path(path), PathBuf::from("/a/b/c"));
    }

    #[test]
    fn test_count_lines() {
        assert_eq!(count_lines(""), 0);
        assert_eq!(count_lines("single"), 1);
        assert_eq!(count_lines("line1\nline2\nline3"), 3);
        assert_eq!(count_lines("line1\nline2\n"), 2);
    }

    #[test]
    fn test_simple_diff() {
        let old = "apple\nbanana";
        let new = "apple\ncherry";
        let diff = simple_diff(old, new);
        assert!(diff.contains("--- before"));
        assert!(diff.contains("+++ after"));
        assert!(diff.contains("-banana"));
        assert!(diff.contains("+cherry"));
    }

    #[test]
    fn test_truncate_chars_short() {
        let text = "short";
        assert_eq!(truncate_chars(text, 100), "short");
    }

    #[test]
    fn test_truncate_chars_long() {
        let text = "a".repeat(200);
        let result = truncate_chars(&text, 100);
        assert!(result.starts_with("a".repeat(100).as_str()));
        assert!(result.contains("... (truncated)"));
    }

    #[test]
    fn test_glob_match() {
        assert!(glob_match("*.md", "file.md"));
        assert!(glob_match("*.rs", "main.rs"));
        assert!(!glob_match("*.md", "file.txt"));
        assert!(glob_match("test_*", "test_something"));
    }

    #[test]
    fn test_extract_frontmatter_value() {
        let body = r#"name: "Test Skill"
description: "A test skill"
version: "1.0.0"
"#;
        assert_eq!(
            extract_frontmatter_value(body, "name"),
            Some("Test Skill".to_string())
        );
        assert_eq!(
            extract_frontmatter_value(body, "version"),
            Some("1.0.0".to_string())
        );
        assert_eq!(extract_frontmatter_value(body, "missing"), None);
    }

    #[test]
    fn test_sanitize_session_id_valid() {
        assert_eq!(sanitize_session_id("session-123").unwrap(), "session-123");
        assert_eq!(
            sanitize_session_id("  session_456  ").unwrap(),
            "session_456"
        );
    }

    #[test]
    fn test_sanitize_session_id_invalid() {
        assert!(sanitize_session_id("").is_err());
        assert!(sanitize_session_id("   ").is_err());
        assert!(sanitize_session_id("session@123").is_err());
        assert!(sanitize_session_id("session 123").is_err());
    }
}
