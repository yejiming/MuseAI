use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::models;
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

    let doc_dir = resolve_document_dir(&app)?;
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
    let doc_dir = resolve_document_dir(&app)?;
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
    let doc_dir = resolve_document_dir(&app)?;
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
    let doc_dir = resolve_document_dir(app)?;
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

fn count_words_in_content(content: &str) -> usize {
    content.chars().filter(|c| c.is_alphanumeric()).count()
}

fn collect_writing_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    if !dir.exists() || !dir.is_dir() {
        return Ok(files);
    }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().into_string().unwrap_or_default();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            files.extend(collect_writing_files(&path)?);
        } else if is_supported_content_file(&path) {
            files.push(path);
        }
    }
    Ok(files)
}

#[tauri::command]
pub fn get_writing_stats(app: AppHandle) -> Result<models::WritingStats, String> {
    let doc_dir = resolve_document_dir(&app)?;
    let articles_dir = doc_dir.join("MuseAI").join("articles");

    let files = collect_writing_files(&articles_dir)?;
    let total_works = files.len();

    let mut total_word_count: usize = 0;
    let now = SystemTime::now();
    let now_secs = now
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;
    let today_start = now_secs - (now_secs % 86400);

    // Initialize daily counts for last 30 days
    let mut daily_counts: HashMap<String, usize> = HashMap::new();
    for i in (0..30).rev() {
        let day_start = today_start - i * 86400;
        let date_str = chrono::DateTime::from_timestamp(day_start, 0)
            .map(|dt| dt.format("%Y-%m-%d").to_string())
            .unwrap_or_default();
        daily_counts.insert(date_str, 0);
    }

    for file_path in &files {
        // Count words
        if let Ok(content) = fs::read_to_string(file_path) {
            total_word_count += count_words_in_content(&content);
        }

        // Track daily activity based on modification time
        if let Ok(metadata) = fs::metadata(file_path) {
            if let Ok(modified) = metadata.modified() {
                if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
                    let modified_secs = duration.as_secs() as i64;
                    let day_start = modified_secs - (modified_secs % 86400);
                    if let Some(date_str) = chrono::DateTime::from_timestamp(day_start, 0)
                        .map(|dt| dt.format("%Y-%m-%d").to_string())
                    {
                        if let Some(counter) = daily_counts.get_mut(&date_str) {
                            *counter += 1;
                        }
                    }
                }
            }
        }
    }

    // Build ordered daily activity (oldest to newest)
    let mut daily_activity = Vec::new();
    for i in (0..30).rev() {
        let day_start = today_start - i * 86400;
        let date_str = chrono::DateTime::from_timestamp(day_start, 0)
            .map(|dt| dt.format("%Y-%m-%d").to_string())
            .unwrap_or_default();
        let count = daily_counts.get(&date_str).copied().unwrap_or(0);
        daily_activity.push(models::DailyActivity {
            date: date_str,
            count,
        });
    }

    Ok(models::WritingStats {
        total_works,
        total_word_count,
        daily_activity,
    })
}

fn build_empty_daily_counts(now_secs: i64) -> HashMap<String, usize> {
    let today_start = now_secs - (now_secs % 86400);
    let mut daily_counts = HashMap::new();
    for i in (0..30).rev() {
        let day_start = today_start - i * 86400;
        let date_str = chrono::DateTime::from_timestamp(day_start, 0)
            .map(|dt| dt.format("%Y-%m-%d").to_string())
            .unwrap_or_default();
        daily_counts.insert(date_str, 0);
    }
    daily_counts
}

fn build_daily_activity(
    now_secs: i64,
    daily_counts: &HashMap<String, usize>,
) -> Vec<models::DailyActivity> {
    let today_start = now_secs - (now_secs % 86400);
    let mut daily_activity = Vec::new();
    for i in (0..30).rev() {
        let day_start = today_start - i * 86400;
        let date_str = chrono::DateTime::from_timestamp(day_start, 0)
            .map(|dt| dt.format("%Y-%m-%d").to_string())
            .unwrap_or_default();
        let count = daily_counts.get(&date_str).copied().unwrap_or(0);
        daily_activity.push(models::DailyActivity {
            date: date_str,
            count,
        });
    }
    daily_activity
}

fn persisted_state_value(text: &str) -> Option<Value> {
    let parsed: Value = serde_json::from_str(text).ok()?;
    if let Some(state) = parsed.get("state") {
        Some(state.clone())
    } else {
        Some(parsed)
    }
}

fn count_state_array(base: &Path, store_name: &str, key: &str) -> usize {
    load_app_state_path(base, store_name)
        .ok()
        .and_then(|text| persisted_state_value(&text))
        .and_then(|state| {
            state
                .get(key)
                .and_then(|value| value.as_array())
                .map(Vec::len)
        })
        .unwrap_or(0)
}

fn add_daily_activity(daily_counts: &mut HashMap<String, usize>, timestamp_millis: u64) {
    let secs = (timestamp_millis / 1000) as i64;
    let day_start = secs - (secs % 86400);
    if let Some(date_str) = chrono::DateTime::from_timestamp(day_start, 0)
        .map(|dt| dt.format("%Y-%m-%d").to_string())
    {
        if let Some(counter) = daily_counts.get_mut(&date_str) {
            *counter += 1;
        }
    }
}

fn count_book_travel_saved_progresses(
    base: &Path,
    daily_counts: &mut HashMap<String, usize>,
) -> usize {
    let Some(state) = load_app_state_path(base, "book-travel-store")
        .ok()
        .and_then(|text| persisted_state_value(&text))
    else {
        return 0;
    };
    let Some(saved_progresses) = state.get("savedProgresses").and_then(|value| value.as_array())
    else {
        return 0;
    };
    for progress in saved_progresses {
        if let Some(saved_at) = progress.get("savedAt").and_then(|value| value.as_u64()) {
            add_daily_activity(daily_counts, saved_at);
        }
    }
    saved_progresses.len()
}

fn count_sessions(base: &Path, daily_counts: &mut HashMap<String, usize>) -> (usize, usize) {
    let dir = base.join("MuseAI").join("agent-sessions");
    let Ok(entries) = fs::read_dir(dir) else {
        return (0, 0);
    };

    let mut chat_count = 0;
    let mut adventure_count = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(path) else {
            continue;
        };
        let Ok(record) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let Some(id) = record.get("id").and_then(|value| value.as_str()) else {
            continue;
        };
        let session_kind = record.get("sessionKind").and_then(|value| value.as_str());
        let is_chat = id.starts_with("partner-session-");
        let is_adventure = id.starts_with("story-session-")
            && (session_kind == Some("story") || session_kind.is_none());
        if !is_chat && !is_adventure {
            continue;
        }

        if is_chat {
            chat_count += 1;
        } else {
            adventure_count += 1;
        }
        if let Some(saved_at) = record.get("savedAt").and_then(|value| value.as_u64()) {
            add_daily_activity(daily_counts, saved_at);
        }
    }

    (chat_count, adventure_count)
}

fn get_interaction_stats_for_root(
    base: &Path,
    now: SystemTime,
) -> Result<models::InteractionStats, String> {
    let now_secs = now
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;
    let mut daily_counts = build_empty_daily_counts(now_secs);
    let world_count = count_state_array(base, "partner-store", "worldBooks");
    let character_count = count_state_array(base, "partner-store", "characterCards");
    let (chat_count, adventure_count) = count_sessions(base, &mut daily_counts);
    let book_travel_count = count_book_travel_saved_progresses(base, &mut daily_counts);

    Ok(models::InteractionStats {
        world_count,
        character_count,
        chat_count,
        adventure_count,
        book_travel_count,
        daily_activity: build_daily_activity(now_secs, &daily_counts),
    })
}

#[tauri::command]
pub fn get_interaction_stats(app: AppHandle) -> Result<models::InteractionStats, String> {
    let doc_dir = resolve_document_dir(&app)?;
    get_interaction_stats_for_root(&doc_dir, SystemTime::now())
}

pub fn load_app_state_path(base: &Path, name: &str) -> Result<String, String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("非法的状态名称".to_string());
    }
    let path = base
        .join("MuseAI")
        .join("config")
        .join(format!("{}.json", name));
    fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn save_app_state_path(base: &Path, name: &str, content: &str) -> Result<(), String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("非法的状态名称".to_string());
    }
    let dir = base.join("MuseAI").join("config");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", name));
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_app_state(app: AppHandle, name: String) -> Result<String, String> {
    let doc_dir = resolve_document_dir(&app)?;
    load_app_state_path(&doc_dir, &name)
}

#[tauri::command]
pub fn save_app_state(app: AppHandle, name: String, content: String) -> Result<(), String> {
    let doc_dir = resolve_document_dir(&app)?;
    save_app_state_path(&doc_dir, &name, &content)
}

pub fn migrate_agent_sessions_dir(old_dir: &Path, new_dir: &Path) -> Result<(), String> {
    if !old_dir.exists() || new_dir.exists() {
        return Ok(());
    }
    fs::create_dir_all(new_dir).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(old_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
            let dest = new_dir.join(entry.file_name());
            fs::copy(&path, &dest).map_err(|e| e.to_string())?;
            let _ = fs::remove_file(&path);
        }
    }
    let _ = fs::remove_dir(old_dir);
    Ok(())
}

pub fn migrate_agent_sessions(app: &AppHandle) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let doc_dir = resolve_document_dir(app)?;
    let old_dir = app_data_dir.join("agent-sessions");
    let new_dir = doc_dir.join("MuseAI").join("agent-sessions");
    migrate_agent_sessions_dir(&old_dir, &new_dir)
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

    #[test]
    fn save_app_state_creates_json_file() {
        let root = temp_path("config");
        let dir = root.join("MuseAI").join("config");

        save_app_state_path(&root, "test-state", r#"{"key": "value"}"#).expect("save state");

        let path = dir.join("test-state.json");
        assert!(path.exists());
        let content = fs::read_to_string(&path).expect("read state");
        assert_eq!(content, r#"{"key": "value"}"#);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn load_app_state_reads_saved_content() {
        let root = temp_path("config");
        let dir = root.join("MuseAI").join("config");
        fs::create_dir_all(&dir).expect("create config dir");
        let path = dir.join("my-state.json");
        fs::write(&path, r#"{"data": 1}"#).expect("write state");

        let result = load_app_state_path(&root, "my-state");
        assert_eq!(result.unwrap(), r#"{"data": 1}"#);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn load_app_state_rejects_invalid_name() {
        let root = temp_path("config");
        assert!(load_app_state_path(&root, "../etc/passwd").is_err());
        assert!(load_app_state_path(&root, "foo/bar").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn interaction_stats_returns_empty_counts_without_data() {
        let root = temp_path("interaction-empty");
        let now = UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);

        let stats = get_interaction_stats_for_root(&root, now).expect("stats");

        assert_eq!(stats.world_count, 0);
        assert_eq!(stats.character_count, 0);
        assert_eq!(stats.chat_count, 0);
        assert_eq!(stats.adventure_count, 0);
        assert_eq!(stats.book_travel_count, 0);
        assert_eq!(stats.daily_activity.len(), 30);
        assert!(stats.daily_activity.iter().all(|day| day.count == 0));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn interaction_stats_counts_partner_sessions_and_book_travel_progress() {
        let root = temp_path("interaction-data");
        let config_dir = root.join("MuseAI").join("config");
        let sessions_dir = root.join("MuseAI").join("agent-sessions");
        fs::create_dir_all(&config_dir).expect("create config");
        fs::create_dir_all(&sessions_dir).expect("create sessions");

        fs::write(
            config_dir.join("partner-store.json"),
            r#"{"state":{"worldBooks":[{"id":"w1"},{"id":"w2"}],"characterCards":[{"id":"c1"},{"id":"c2"},{"id":"c3"}]}}"#,
        )
        .expect("write partner store");

        let now_secs = 1_700_000_000_u64;
        let today_millis = now_secs * 1000;
        let yesterday_millis = (now_secs - 86_400) * 1000;
        fs::write(
            config_dir.join("book-travel-store.json"),
            format!(
                r#"{{"state":{{"savedProgresses":[{{"id":"p1","savedAt":{today_millis}}},{{"id":"p2","savedAt":{yesterday_millis}}}]}}}}"#
            ),
        )
        .expect("write book travel store");

        fs::write(
            sessions_dir.join("partner-session-1.json"),
            format!(r#"{{"id":"partner-session-1","savedAt":{today_millis}}}"#),
        )
        .expect("write chat session");
        fs::write(
            sessions_dir.join("story-session-1.json"),
            format!(
                r#"{{"id":"story-session-1","sessionKind":"story","savedAt":{yesterday_millis}}}"#
            ),
        )
        .expect("write adventure session");
        fs::write(
            sessions_dir.join("story-session-book.json"),
            format!(
                r#"{{"id":"story-session-book","sessionKind":"bookTravel","savedAt":{today_millis}}}"#
            ),
        )
        .expect("write ignored book travel session");
        fs::write(sessions_dir.join("note.txt"), "{}").expect("write ignored text");

        let now = UNIX_EPOCH + std::time::Duration::from_secs(now_secs);
        let stats = get_interaction_stats_for_root(&root, now).expect("stats");

        assert_eq!(stats.world_count, 2);
        assert_eq!(stats.character_count, 3);
        assert_eq!(stats.chat_count, 1);
        assert_eq!(stats.adventure_count, 1);
        assert_eq!(stats.book_travel_count, 2);
        assert_eq!(stats.daily_activity.len(), 30);
        assert_eq!(stats.daily_activity[28].count, 2);
        assert_eq!(stats.daily_activity[29].count, 2);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn migrate_agent_sessions_copies_files() {
        let old_dir = temp_path("old-sessions");
        let new_dir = temp_path("new-sessions");
        fs::create_dir_all(&old_dir).expect("create old dir");
        fs::write(old_dir.join("session-1.json"), r#"{"id": "1"}"#).expect("write session 1");
        fs::write(old_dir.join("session-2.json"), r#"{"id": "2"}"#).expect("write session 2");

        migrate_agent_sessions_dir(&old_dir, &new_dir).expect("migrate");

        assert!(!old_dir.exists());
        assert!(new_dir.join("session-1.json").exists());
        assert!(new_dir.join("session-2.json").exists());
        assert_eq!(
            fs::read_to_string(new_dir.join("session-1.json")).unwrap(),
            r#"{"id": "1"}"#
        );
        let _ = fs::remove_dir_all(new_dir);
    }

    #[test]
    fn migrate_agent_sessions_skips_if_new_exists() {
        let old_dir = temp_path("old-sessions-skip");
        let new_dir = temp_path("new-sessions-skip");
        fs::create_dir_all(&old_dir).expect("create old dir");
        fs::create_dir_all(&new_dir).expect("create new dir");
        fs::write(old_dir.join("session.json"), "{}").expect("write old");

        migrate_agent_sessions_dir(&old_dir, &new_dir).expect("migrate");

        // old dir should remain because new dir already existed
        assert!(old_dir.exists());
        let _ = fs::remove_dir_all(old_dir);
        let _ = fs::remove_dir_all(new_dir);
    }

    #[test]
    fn migrate_agent_sessions_skips_if_old_missing() {
        let old_dir = temp_path("old-sessions-missing");
        let new_dir = temp_path("new-sessions-missing");

        migrate_agent_sessions_dir(&old_dir, &new_dir).expect("migrate");

        assert!(!new_dir.exists());
    }
}
