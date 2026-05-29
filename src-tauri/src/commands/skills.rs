use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

use crate::models::*;
use crate::utils::*;

const BUILTIN_SKILL_NAMES: &[&str] = &[
    "kitt-writer",
    "fanqie-short-nuexin-outline",
    "fanqie-short-nuexin-writer",
    "fanqie-xuanhuan-outline",
    "fanqie-xuanhuan-writer",
];

static BUILTIN_SKILLS_SYNCED: OnceLock<()> = OnceLock::new();

pub fn discover_skills(app: Option<&AppHandle>) -> Vec<SkillDefinition> {
    let mut roots = Vec::new();
    if let Some(app_handle) = app {
        if let Ok(dir) = app_handle.path().app_data_dir() {
            let skills_dir = dir.join("skills");
            ensure_builtin_skills_synced(app_handle, &skills_dir);
            roots.push(skills_dir);
        }
    }

    let mut skills = Vec::new();
    for root in roots {
        if root.join("SKILL.md").is_file() {
            if let Some(skill) = parse_skill_definition(&root) {
                skills.push(skill);
            }
        } else {
            collect_skills_from_root(&root, &mut skills);
        }
    }
    skills
}
fn ensure_builtin_skills_synced(app: &AppHandle, skills_dir: &Path) {
    BUILTIN_SKILLS_SYNCED.get_or_init(|| {
        if let Err(error) = sync_builtin_skills(app, skills_dir) {
            eprintln!("同步内置 Skill 失败: {}", error);
        }
    });
}
fn sync_builtin_skills(app: &AppHandle, skills_dir: &Path) -> Result<(), String> {
    let source_dir = builtin_skills_source_dir(app)?;
    fs::create_dir_all(skills_dir).map_err(|e| e.to_string())?;

    for skill_name in BUILTIN_SKILL_NAMES {
        let source = source_dir.join(skill_name);
        if !source.join("SKILL.md").is_file() {
            return Err(format!("内置 Skill '{}' 缺少 SKILL.md", skill_name));
        }

        let dest = skills_dir.join(skill_name);
        if dest.exists() {
            if dest.is_dir() {
                fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(&dest).map_err(|e| e.to_string())?;
            }
        }
        copy_dir_recursive(&source, &dest).map_err(|e| e.to_string())?;
    }

    Ok(())
}
fn builtin_skills_source_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resolve("skills", BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    if bundled.is_dir() {
        return Ok(bundled);
    }

    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("skills");
    if dev.is_dir() {
        return Ok(dev);
    }

    Err(format!("未找到内置 Skill 资源目录: {}", bundled.display()))
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
pub fn list_skill_files(root: &Path) -> Vec<String> {
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
#[tauri::command]
pub fn import_skill(app: AppHandle, path: String) -> Result<SkillDefinition, String> {
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
pub fn delete_skill(app: AppHandle, name: String) -> Result<(), String> {
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
pub fn get_skills(app: AppHandle) -> Result<Vec<SkillDefinition>, String> {
    Ok(discover_skills(Some(&app)))
}
