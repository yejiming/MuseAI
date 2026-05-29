use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::utils::*;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkSummaryResultFile {
    article_path: String,
    updated_at: u64,
    score_json: Value,
}

#[tauri::command]
pub fn import_workspace_item(
    app: AppHandle,
    source_path: String,
    dir_type: String,
) -> Result<String, String> {
    let source = Path::new(&source_path);
    if !source.exists() {
        return Err("Source path does not exist".to_string());
    }

    let doc_dir = app.path().document_dir().map_err(|e| e.to_string())?;
    let base_dir = doc_dir.join("MuseAI").join(&dir_type);

    fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;

    let file_name = source.file_name().ok_or("Invalid file name")?;
    let mut dest = base_dir.join(file_name);

    if dest.exists() {
        let stem = Path::new(file_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        let ext = Path::new(file_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_default();
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
pub fn delete_workspace_item(app: AppHandle, item_path: String) -> Result<(), String> {
    let target = Path::new(&item_path);
    let doc_dir = app.path().document_dir().map_err(|e| e.to_string())?;
    let museai_dir = doc_dir.join("MuseAI");
    let refs_dir = museai_dir.join("references");
    let articles_dir = museai_dir.join("articles");
    let outline_dir = museai_dir.join("outline");

    if !target.starts_with(&refs_dir)
        && !target.starts_with(&articles_dir)
        && !target.starts_with(&outline_dir)
    {
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
pub fn get_workspace_dir(app: AppHandle, dir_type: String) -> Result<String, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let doc_dir = app.path().document_dir().map_err(|e| e.to_string())?;
    let museai_dir = doc_dir.join("MuseAI");

    // Migrate from old app_data_dir locations to ~/Documents/MuseAI
    for dir_name in ["articles", "references", "outline"] {
        let old = app_data_dir.join(dir_name);
        let new = museai_dir.join(dir_name);
        if old.exists() && !new.exists() {
            let _ = fs::create_dir_all(&museai_dir);
            let _ = fs::rename(&old, &new);
        }
    }

    // Also migrate from the very old de_ai directory
    let old_de_ai = app_data_dir.join("de_ai");
    if old_de_ai.exists() {
        let old_ref = old_de_ai.join("references");
        let old_works = old_de_ai.join("works");
        let new_ref = museai_dir.join("references");
        let new_articles = museai_dir.join("articles");
        if old_ref.exists() && !new_ref.exists() {
            let _ = fs::create_dir_all(&museai_dir);
            let _ = fs::rename(&old_ref, &new_ref);
        }
        if old_works.exists() && !new_articles.exists() {
            let _ = fs::create_dir_all(&museai_dir);
            let _ = fs::rename(&old_works, &new_articles);
        }
        let _ = fs::remove_dir_all(&old_de_ai);
    }

    let dir = museai_dir.join(&dir_type);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

fn now_millis() -> Result<u64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    u64::try_from(millis).map_err(|_| "Timestamp is too large".to_string())
}

fn articles_root(app: &AppHandle) -> Result<PathBuf, String> {
    let doc_dir = app.path().document_dir().map_err(|e| e.to_string())?;
    let articles_dir = doc_dir.join("MuseAI").join("articles");
    fs::create_dir_all(&articles_dir).map_err(|e| e.to_string())?;
    articles_dir.canonicalize().map_err(|e| e.to_string())
}

fn validate_article_path(articles_dir: &Path, article_path: &Path) -> Result<PathBuf, String> {
    if !article_path.exists() || !article_path.is_file() {
        return Err("作品文件不存在".to_string());
    }
    let canonical_article = article_path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_article.starts_with(articles_dir) {
        return Err("只能保存作品目录内的总结结果".to_string());
    }
    if canonical_article
        .components()
        .any(|component| component.as_os_str().to_str() == Some(".versions"))
    {
        return Err("作品总结结果不能关联版本文件".to_string());
    }
    Ok(canonical_article)
}

fn work_summary_result_path_for(
    articles_dir: &Path,
    article_path: &Path,
) -> Result<PathBuf, String> {
    let canonical_article = validate_article_path(articles_dir, article_path)?;
    let file_name = canonical_article
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("作品文件名不合法")?;
    let parent = canonical_article.parent().ok_or("无法获取作品所在目录")?;
    Ok(parent
        .join(".work-summary-results")
        .join(format!("{}.summary.json", file_name)))
}

fn save_work_summary_result_for_root(
    articles_dir: &Path,
    article_path: &Path,
    score_json: &str,
) -> Result<(), String> {
    let canonical_article = validate_article_path(articles_dir, article_path)?;
    let parsed: Value = serde_json::from_str(score_json).map_err(|e| e.to_string())?;
    let result_path = work_summary_result_path_for(articles_dir, &canonical_article)?;
    if let Some(parent) = result_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let result = WorkSummaryResultFile {
        article_path: canonical_article.to_string_lossy().into_owned(),
        updated_at: now_millis()?,
        score_json: parsed,
    };
    let content = serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?;
    fs::write(result_path, content).map_err(|e| e.to_string())
}

fn load_work_summary_result_for_root(
    articles_dir: &Path,
    article_path: &Path,
) -> Result<Option<String>, String> {
    let result_path = work_summary_result_path_for(articles_dir, article_path)?;
    if !result_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(result_path).map_err(|e| e.to_string())?;
    let result: WorkSummaryResultFile =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;
    serde_json::to_string(&result.score_json)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_work_summary_result(
    app: AppHandle,
    article_path: String,
    score_json: String,
) -> Result<(), String> {
    let articles_dir = articles_root(&app)?;
    save_work_summary_result_for_root(&articles_dir, Path::new(&article_path), &score_json)
}

#[tauri::command]
pub fn load_work_summary_result(
    app: AppHandle,
    article_path: String,
) -> Result<Option<String>, String> {
    let articles_dir = articles_root(&app)?;
    load_work_summary_result_for_root(&articles_dir, Path::new(&article_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn temp_path(name: &str) -> PathBuf {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be after epoch")
            .as_nanos();
        env::temp_dir().join(format!("museai_summary_test_{}_{}", millis, name))
    }

    #[test]
    fn work_summary_result_round_trips_under_articles() {
        let root = temp_path("articles");
        let article = root.join("story.md");
        fs::create_dir_all(&root).expect("create root");
        fs::write(&article, "正文").expect("write article");
        let canonical_root = root.canonicalize().expect("canonical root");

        save_work_summary_result_for_root(
            &canonical_root,
            &article,
            r#"{"情节架构与长期张力": 18.0, "优化建议": "继续加强冲突"}"#,
        )
        .expect("save summary result");

        let loaded = load_work_summary_result_for_root(&canonical_root, &article)
            .expect("load result")
            .expect("result exists");
        assert!(loaded.contains("情节架构与长期张力"));
        assert!(!article.parent().unwrap().join(".versions").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn work_summary_result_rejects_path_outside_articles() {
        let root = temp_path("articles");
        let outside = temp_path("outside.md");
        fs::create_dir_all(&root).expect("create root");
        fs::write(&outside, "正文").expect("write outside article");
        let canonical_root = root.canonicalize().expect("canonical root");

        let err =
            save_work_summary_result_for_root(&canonical_root, &outside, r#"{"优化建议": "无"}"#)
                .expect_err("outside path should be rejected");
        assert!(err.contains("作品目录"));
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_file(outside);
    }
}
