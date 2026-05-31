mod crawler;
mod fs_commands;

#[macro_use]
mod agent;
#[macro_use]
mod commands;
mod llm;
mod models;
#[macro_use]
mod tools;
mod utils;

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::OnceLock;

use tokio::sync::oneshot;

pub use agent::sessions::*;
pub use commands::fs::*;
pub use commands::skills::*;
pub use commands::versions::*;
pub use commands::workspace::*;
pub use models::{WritingStats, DailyActivity};
pub use tools::*;

use tauri::{AppHandle, Manager};

static BASH_PERMISSION_CHANNELS: OnceLock<Mutex<HashMap<String, oneshot::Sender<bool>>>> =
    OnceLock::new();

pub fn bash_permission_channels() -> &'static Mutex<HashMap<String, oneshot::Sender<bool>>> {
    BASH_PERMISSION_CHANNELS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub struct ActiveStreams(Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>);

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn rename_item(path: String, new_name: String) -> Result<(), String> {
    fs_commands::rename_item_cmd(path, new_name)
}

#[tauri::command]
fn move_item(app: AppHandle, source: String, target_dir: String) -> Result<(), String> {
    let doc_dir = app.path().document_dir().map_err(|e| e.to_string())?;
    let museai_dir = doc_dir.join("MuseAI");
    let refs_dir = museai_dir.join("references");
    let articles_dir = museai_dir.join("articles");
    let outline_dir = museai_dir.join("outline");
    let source_path = std::path::Path::new(&source);
    let target_path = std::path::Path::new(&target_dir);
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
fn crawl_fanqie_article(
    url: String,
    novel_type: String,
    target_dir: String,
) -> Result<String, String> {
    crawler::crawl_fanqie_article(&url, &novel_type, &target_dir)
}

#[tauri::command]
fn build_full_system_prompt(
    app: AppHandle,
    system_prompt: String,
    workspace_path: Option<String>,
    selected_reference_files: Option<Vec<String>>,
) -> Result<String, String> {
    let request = models::ChatStreamRequest {
        model_interface: String::new(),
        base_url: String::new(),
        api_key: String::new(),
        model: String::new(),
        temperature: None,
        max_output_tokens: None,
        max_context_tokens: None,
        thinking_depth: None,
        system_prompt,
        workspace_path,
        messages: vec![],
        selected_reference_files,
        allowed_tools: None,
        allowed_write_paths: None,
    };

    let mut full = agent::assemble_system_prompt(Some(&app), &request)?;

    let reference_ctx = agent::build_reference_context(&request);
    if !reference_ctx.is_empty() {
        full.push_str(&reference_ctx);
    }

    Ok(full)
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
            delete_agent_session,
            summarize_text,
            update_agent_session_title,
            analyze_character_memory,
            start_chat_completion_stream,
            import_skill,
            delete_skill,
            get_skills,
            stop_chat_stream,
            import_workspace_item,
            delete_workspace_item,
            get_workspace_dir,
            get_writing_stats,
            save_work_summary_result,
            load_work_summary_result,
            rename_item,
            move_item,
            import_local_folder_shallow,
            crawl_fanqie_article,
            create_untitled_item,
            build_full_system_prompt,
            generate_background_items,
            optimize_character_memories,
            test_llm_connection,
        ])
        .manage(ActiveStreams(Mutex::new(HashMap::new())))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs;
    use std::time::SystemTime;

    fn temp_path(name: &str) -> std::path::PathBuf {
        let millis = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
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
    fn tool_grep_finds_matching_lines() {
        let dir = temp_path("grep");
        fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("story.md");
        fs::write(&path, "第一行\n关键词\n").expect("write temp file");

        let result = tool_grep(
            "关键词".to_string(),
            Some(dir.display().to_string()),
            Some("*.md".to_string()),
            None,
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
            models::TodoItem {
                content: "A".to_string(),
                active_form: "Doing A".to_string(),
                status: "in_progress".to_string(),
            },
            models::TodoItem {
                content: "B".to_string(),
                active_form: "Doing B".to_string(),
                status: "in_progress".to_string(),
            },
        ]);

        assert!(!result.success);
        assert!(result.output.contains("only one todo"));
    }
}
