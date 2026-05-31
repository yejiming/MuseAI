use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;

use crate::models::*;

#[tauri::command]
pub fn get_versions_meta_path(file_path: &Path) -> std::path::PathBuf {
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
pub fn list_file_versions(path: String) -> Result<Vec<VersionInfo>, String> {
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
pub fn create_file_version(path: String) -> Result<VersionInfo, String> {
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
pub fn read_file_version(path: String, version_id: String) -> Result<String, String> {
    let target = Path::new(&path);
    let version_file_path = get_version_file_path(target, &version_id);
    if !version_file_path.exists() {
        return Err("Version file does not exist".to_string());
    }
    fs::read_to_string(version_file_path).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn delete_file_version(path: String, version_id: String) -> Result<(), String> {
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
pub fn update_version_ai_score(path: String, version_id: String, score: u32) -> Result<(), String> {
    update_version_ai_result(path, version_id, score, None)
}
#[tauri::command]
pub fn update_version_ai_result(
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn get_versions_meta_path_basic() {
        let path = Path::new("/home/user/documents/story.md");
        let meta = get_versions_meta_path(path);
        assert_eq!(meta, PathBuf::from("/home/user/documents/.versions/story.md.meta.json"));
    }

    #[test]
    fn get_version_file_path_basic() {
        let path = Path::new("/home/user/documents/story.md");
        let version = get_version_file_path(path, "v1");
        assert_eq!(version, PathBuf::from("/home/user/documents/.versions/story.md/v1"));
    }

    #[test]
    fn get_versions_meta_path_no_parent() {
        let path = Path::new("story.md");
        let meta = get_versions_meta_path(path);
        assert_eq!(meta, PathBuf::from(".versions/story.md.meta.json"));
    }
}
