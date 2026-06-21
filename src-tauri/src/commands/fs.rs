use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::{engine::general_purpose, Engine as _};
use serde::Deserialize;
use tauri::{Emitter, Manager};

use crate::models::*;
use crate::utils::*;

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<FileNode>, String> {
    let mut nodes = Vec::new();
    let dir_path = Path::new(&path);

    if !dir_path.exists() || !dir_path.is_dir() {
        return Err(format!("Path {} is not a valid directory", path));
    }

    match fs::read_dir(dir_path) {
        Ok(entries) => {
            for entry in entries.flatten() {
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
            nodes.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
            Ok(nodes)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    read_text_file(path)
}

fn read_text_file(path: impl AsRef<Path>) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    decode_text_bytes(&bytes)
}

fn decode_text_bytes(bytes: &[u8]) -> Result<String, String> {
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        return String::from_utf8(bytes[3..].to_vec()).map_err(|e| e.to_string());
    }
    if bytes.starts_with(&[0xff, 0xfe]) {
        return decode_utf16_bytes(&bytes[2..], true);
    }
    if bytes.starts_with(&[0xfe, 0xff]) {
        return decode_utf16_bytes(&bytes[2..], false);
    }

    String::from_utf8(bytes.to_vec()).map_err(|e| e.to_string())
}

fn decode_utf16_bytes(bytes: &[u8], little_endian: bool) -> Result<String, String> {
    if !bytes.len().is_multiple_of(2) {
        return Err("UTF-16 文件字节长度不完整".to_string());
    }

    let code_units = bytes
        .chunks_exact(2)
        .map(|chunk| {
            let pair = [chunk[0], chunk[1]];
            if little_endian {
                u16::from_le_bytes(pair)
            } else {
                u16::from_be_bytes(pair)
            }
        })
        .collect::<Vec<_>>();

    String::from_utf16(&code_units).map_err(|e| format!("UTF-16 解码失败: {}", e))
}

#[tauri::command]
pub fn read_image_data_url(path: String) -> Result<String, String> {
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
pub fn write_file(app: tauri::AppHandle, path: String, content: String) -> Result<u64, String> {
    fs::write(&path, content).map_err(|e| e.to_string())?;
    let _ = app.emit("workspace-changed", ());
    file_modified_at(path)
}

fn sanitize_download_file_name(file_name: &str) -> String {
    let mut sanitized = file_name
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();

    if sanitized.is_empty() {
        sanitized = "museai-export.json".to_string();
    }
    if !sanitized.to_ascii_lowercase().ends_with(".json") {
        sanitized.push_str(".json");
    }
    sanitized
}

fn sanitize_path_component(name: &str, fallback: &str) -> String {
    let sanitized = name
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();

    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn unique_download_path(download_dir: &Path, file_name: &str) -> PathBuf {
    let candidate = download_dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(file_name);
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("museai-export");
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("json");
    let mut index = 1;
    loop {
        let next = download_dir.join(format!("{} ({}).{}", stem, index, extension));
        if !next.exists() {
            return next;
        }
        index += 1;
    }
}

fn unique_dir_path(parent: &Path, dir_name: &str) -> PathBuf {
    let candidate = parent.join(dir_name);
    if !candidate.exists() {
        return candidate;
    }

    let mut index = 1;
    loop {
        let next = parent.join(format!("{} ({})", dir_name, index));
        if !next.exists() {
            return next;
        }
        index += 1;
    }
}

#[tauri::command]
pub fn export_json_to_downloads(
    app: tauri::AppHandle,
    file_name: String,
    content: String,
) -> Result<String, String> {
    let download_dir = app.path().download_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;
    let safe_file_name = sanitize_download_file_name(&file_name);
    let path = unique_download_path(&download_dir, &safe_file_name);
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadExportFile {
    relative_path: String,
    content: String,
}

#[tauri::command]
pub fn export_json_files_to_downloads(
    app: tauri::AppHandle,
    directory_name: Option<String>,
    files: Vec<DownloadExportFile>,
) -> Result<Vec<String>, String> {
    if files.is_empty() {
        return Err("没有可导出的文件".to_string());
    }

    let download_dir = app.path().download_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;

    let base_dir = if let Some(name) = directory_name {
        let safe_dir_name = sanitize_path_component(&name, "MuseAI导出");
        let dir = unique_dir_path(&download_dir, &safe_dir_name);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        dir
    } else {
        download_dir
    };

    let mut written_paths = Vec::with_capacity(files.len());
    for file in files {
        let parts = file
            .relative_path
            .split('/')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        let (file_name, parent_parts) = parts
            .split_last()
            .ok_or_else(|| "导出文件名不能为空".to_string())?;
        let mut parent = base_dir.clone();
        for part in parent_parts {
            parent = parent.join(sanitize_path_component(part, "文件夹"));
        }
        fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
        let safe_file_name = sanitize_download_file_name(file_name);
        let path = unique_download_path(&parent, &safe_file_name);
        fs::write(&path, file.content).map_err(|e| e.to_string())?;
        written_paths.push(path.to_string_lossy().into_owned());
    }

    Ok(written_paths)
}

#[tauri::command]
pub fn create_file(app: tauri::AppHandle, path: String) -> Result<u64, String> {
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
pub fn create_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = Path::new(&path);
    if path.exists() {
        return Err("文件夹已存在".to_string());
    }
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    let _ = app.emit("workspace-changed", ());
    Ok(())
}

#[tauri::command]
pub fn rename_path(
    app: tauri::AppHandle,
    path: String,
    new_name: String,
) -> Result<String, String> {
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
pub fn delete_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
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
pub fn file_modified_at(path: String) -> Result<u64, String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("museai-fs-{}-{}", name, nanos));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn sanitize_download_file_name_keeps_json_and_removes_path_chars() {
        assert_eq!(
            sanitize_download_file_name("museai-world-book-坏/标题?:.json"),
            "museai-world-book-坏_标题__.json"
        );
        assert_eq!(sanitize_download_file_name("角色卡"), "角色卡.json");
        assert_eq!(sanitize_download_file_name("..."), "museai-export.json");
    }

    #[test]
    fn unique_download_path_avoids_overwriting_existing_files() {
        let dir = temp_dir("unique-download");
        let first = dir.join("export.json");
        fs::write(&first, "{}").expect("write first");

        let next = unique_download_path(&dir, "export.json");

        assert_eq!(next.file_name().and_then(|value| value.to_str()), Some("export (1).json"));
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn read_file_decodes_utf16le_with_bom() {
        let dir = temp_dir("utf16le");
        let path = dir.join("default.txt");
        let mut bytes = vec![0xff, 0xfe];
        for unit in "标题\n正文".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        fs::write(&path, bytes).expect("write utf16le file");

        assert_eq!(
            read_file(path.to_string_lossy().into_owned()).unwrap(),
            "标题\n正文"
        );
        fs::remove_dir_all(dir).expect("cleanup");
    }
}
