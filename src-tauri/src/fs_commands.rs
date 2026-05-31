use std::fs;
use std::path::Path;

fn is_importable_text_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("md" | "txt" | "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg")
    )
}

fn copy_importable_text_files_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if path.is_dir() {
            copy_importable_text_files_recursive(&path, &dest_path)?;
        } else if path.is_file() && is_importable_text_file(&path) {
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(&path, &dest_path).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn rename_item_cmd(path: String, new_name: String) -> Result<(), String> {
    let source = Path::new(&path);
    if !source.exists() {
        return Err("Path does not exist".to_string());
    }
    let parent = source.parent().unwrap_or(Path::new(""));
    let dest = parent.join(new_name);
    if dest.exists() {
        return Err("A file or folder with the new name already exists".to_string());
    }
    fs::rename(source, dest).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_item_cmd(source: String, target_dir: String) -> Result<(), String> {
    let src = Path::new(&source);
    let target = Path::new(&target_dir);
    if !src.exists() {
        return Err("Source does not exist".to_string());
    }
    if !target.exists() || !target.is_dir() {
        return Err("Target directory does not exist or is not a directory".to_string());
    }
    let file_name = src.file_name().ok_or("Invalid source file name")?;
    let dest = target.join(file_name);
    if dest.exists() {
        return Err(
            "A file or folder with the same name already exists in the target directory"
                .to_string(),
        );
    }
    fs::rename(src, dest).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_local_folder_shallow_cmd(
    source: String,
    target_dir: String,
) -> Result<String, String> {
    let src = Path::new(&source);
    let target = Path::new(&target_dir);
    if !src.exists() || !src.is_dir() {
        return Err("Source must be a directory".to_string());
    }
    fs::create_dir_all(target).map_err(|e| e.to_string())?;

    let folder_name = src.file_name().ok_or("Invalid source folder name")?;
    let dest_folder = target.join(folder_name);

    let mut actual_dest = dest_folder.clone();
    let mut counter = 1;
    while actual_dest.exists() {
        actual_dest = target.join(format!("{} ({})", folder_name.to_string_lossy(), counter));
        counter += 1;
    }

    fs::create_dir_all(&actual_dest).map_err(|e| e.to_string())?;
    copy_importable_text_files_recursive(src, &actual_dest)?;

    Ok(actual_dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn create_untitled_item_cmd(target_dir: String, is_dir: bool) -> Result<String, String> {
    let target = Path::new(&target_dir);
    if !target.exists() || !target.is_dir() {
        return Err("Target directory does not exist or is not a directory".to_string());
    }

    let base_name = if is_dir {
        "未命名文件夹"
    } else {
        "未命名文件"
    };
    let ext = if is_dir { "" } else { ".md" };

    let mut item_path = target.join(format!("{}{}", base_name, ext));
    let mut counter = 1;

    while item_path.exists() {
        item_path = target.join(format!("{} ({}){}", base_name, counter, ext));
        counter += 1;
    }

    if is_dir {
        fs::create_dir(&item_path).map_err(|e| e.to_string())?;
    } else {
        fs::write(&item_path, "").map_err(|e| e.to_string())?;
    }

    Ok(item_path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn is_importable_text_file_md() {
        assert!(is_importable_text_file(Path::new("test.md")));
        assert!(is_importable_text_file(Path::new("test.txt")));
        assert!(is_importable_text_file(Path::new("test.png")));
        assert!(is_importable_text_file(Path::new("test.jpg")));
        assert!(is_importable_text_file(Path::new("test.jpeg")));
        assert!(is_importable_text_file(Path::new("test.gif")));
        assert!(is_importable_text_file(Path::new("test.webp")));
        assert!(is_importable_text_file(Path::new("test.bmp")));
        assert!(is_importable_text_file(Path::new("test.svg")));
    }

    #[test]
    fn is_importable_text_file_not_importable() {
        assert!(!is_importable_text_file(Path::new("test.rs")));
        assert!(!is_importable_text_file(Path::new("test.js")));
        assert!(!is_importable_text_file(Path::new("test")));
        assert!(!is_importable_text_file(Path::new("")));
    }

    #[test]
    fn is_importable_text_file_case_insensitive() {
        assert!(is_importable_text_file(Path::new("test.MD")));
        assert!(is_importable_text_file(Path::new("test.PNG")));
        assert!(is_importable_text_file(Path::new("test.JpG")));
    }

    #[test]
    fn rename_item_cmd_success() {
        let tmp = std::env::temp_dir().join(format!("museai_test_rename_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
        fs::create_dir_all(&tmp).unwrap();
        let source = tmp.join("old.txt");
        fs::write(&source, "content").unwrap();

        let result = rename_item_cmd(source.to_string_lossy().into_owned(), "new.txt".to_string());
        assert!(result.is_ok());
        assert!(!source.exists());
        assert!(tmp.join("new.txt").exists());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn rename_item_cmd_nonexistent() {
        let result = rename_item_cmd("/nonexistent/path/file.txt".to_string(), "new.txt".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn rename_item_cmd_duplicate_name() {
        let tmp = std::env::temp_dir().join(format!("museai_test_rename_dup_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("a.txt"), "a").unwrap();
        fs::write(tmp.join("b.txt"), "b").unwrap();

        let result = rename_item_cmd(tmp.join("a.txt").to_string_lossy().into_owned(), "b.txt".to_string());
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn move_item_cmd_success() {
        let tmp = std::env::temp_dir().join(format!("museai_test_move_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
        let src_dir = tmp.join("src");
        let dest_dir = tmp.join("dest");
        fs::create_dir_all(&src_dir).unwrap();
        fs::create_dir_all(&dest_dir).unwrap();
        let file = src_dir.join("file.txt");
        fs::write(&file, "content").unwrap();

        let result = move_item_cmd(file.to_string_lossy().into_owned(), dest_dir.to_string_lossy().into_owned());
        assert!(result.is_ok());
        assert!(!file.exists());
        assert!(dest_dir.join("file.txt").exists());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn create_untitled_item_cmd_file() {
        let tmp = std::env::temp_dir().join(format!("museai_test_untitled_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
        fs::create_dir_all(&tmp).unwrap();

        let name = create_untitled_item_cmd(tmp.to_string_lossy().into_owned(), false).unwrap();
        assert_eq!(name, "未命名文件.md");
        assert!(tmp.join("未命名文件.md").exists());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn create_untitled_item_cmd_dir() {
        let tmp = std::env::temp_dir().join(format!("museai_test_untitled_dir_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
        fs::create_dir_all(&tmp).unwrap();

        let name = create_untitled_item_cmd(tmp.to_string_lossy().into_owned(), true).unwrap();
        assert_eq!(name, "未命名文件夹");
        assert!(tmp.join("未命名文件夹").is_dir());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn create_untitled_item_cmd_dedup() {
        let tmp = std::env::temp_dir().join(format!("museai_test_untitled_dedup_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("未命名文件.md"), "").unwrap();

        let name = create_untitled_item_cmd(tmp.to_string_lossy().into_owned(), false).unwrap();
        assert_eq!(name, "未命名文件 (1).md");
        assert!(tmp.join("未命名文件 (1).md").exists());

        let _ = fs::remove_dir_all(&tmp);
    }
}
