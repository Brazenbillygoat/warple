use log::{error, info};
use serde_json::{json, Value};
use std::{
    ffi::OsStr,
    fs,
    path::{Component, Path, PathBuf},
};

use tauri::{AppHandle, Manager};

// These are the only JSON files allowed directly under the application data root.
const ROOT_CONFIG_FILES: [&str; 3] = ["settings.json", "pets.json", "pet_linker.json"];

#[derive(Debug)]
pub struct AppConfig {
    theme: String,
}

impl AppConfig {
    pub fn new(app: &AppHandle) -> AppConfig {
        let theme = read_app_config(app.clone(), "settings.json")
            .ok()
            .flatten()
            .and_then(|settings| settings.get("theme")?.as_str().map(str::to_owned))
            .unwrap_or_else(|| "dark".to_string());

        AppConfig { theme }
    }

    pub fn get_theme(&self) -> &str {
        self.theme.as_str()
    }
}

pub fn convert_path(path_str: &str) -> Option<String> {
    if cfg!(target_os = "windows") {
        Some(path_str.replace('/', "\\"))
    } else {
        Some(path_str.replace('\\', "/"))
    }
}

pub fn app_config_root_from_base(config_dir: &Path, identifier: &str) -> PathBuf {
    config_dir.join(identifier)
}

pub fn app_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|err| format!("Could not resolve the Warple data directory: {err}"))
}

fn has_only_normal_components(path: &Path) -> bool {
    // Reject roots, parent traversal, and platform prefixes before joining untrusted paths.
    path.components()
        .all(|component| matches!(component, Component::Normal(_)))
}

fn is_file_in_bucket(path: &Path, bucket: &str, extension: &str) -> bool {
    has_only_normal_components(path)
        && path.parent() == Some(Path::new(bucket))
        && path.extension() == Some(OsStr::new(extension))
        && path.file_stem().is_some_and(|stem| !stem.is_empty())
}

fn is_allowed_config_path(path: &Path) -> bool {
    ROOT_CONFIG_FILES
        .iter()
        .any(|allowed| path == Path::new(allowed))
        || is_file_in_bucket(path, "custom-pets", "json")
}

fn is_allowed_asset_path(path: &Path) -> bool {
    is_file_in_bucket(path, "assets", "png")
}

fn relative_to_app_root(root: &Path, path_str: &str) -> Result<PathBuf, String> {
    let supplied = PathBuf::from(path_str);
    if supplied.is_absolute() {
        // Absolute paths are accepted only when they already point inside this app's data root.
        supplied
            .strip_prefix(root)
            .map(Path::to_path_buf)
            .map_err(|_| "Path is outside the Warple data directory".to_string())
    } else {
        Ok(supplied)
    }
}

fn resolve_config_path(root: &Path, config_name: &str) -> Result<PathBuf, String> {
    // Keep the allowlist here so every read and write command shares the same boundary.
    let relative = relative_to_app_root(root, config_name)?;
    if !is_allowed_config_path(&relative) {
        return Err(format!("Config path is not allowed: {config_name}"));
    }

    Ok(root.join(relative))
}

fn resolve_app_path(root: &Path, path_str: &str) -> Result<PathBuf, String> {
    let relative = relative_to_app_root(root, path_str)?;
    if !is_allowed_config_path(&relative) && !is_allowed_asset_path(&relative) {
        return Err(format!("App data path is not allowed: {path_str}"));
    }

    Ok(root.join(relative))
}

#[tauri::command(rename_all = "snake_case")]
pub fn combine_config_path(app: AppHandle, config_name: &str) -> Result<String, String> {
    let root = app_root(&app)?;
    let path = resolve_app_path(&root, config_name)?;
    convert_path(
        path.to_str()
            .ok_or_else(|| "App data path contains invalid characters".to_string())?,
    )
    .ok_or_else(|| "Could not convert app data path".to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn read_app_config(app: AppHandle, config_name: &str) -> Result<Option<Value>, String> {
    let root = app_root(&app)?;
    let path = resolve_config_path(&root, config_name)?;
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&path)
        .map_err(|err| format!("Could not read '{}': {err}", path.display()))?;
    let document: Value = serde_json::from_str(&contents)
        .map_err(|err| format!("Could not parse '{}': {err}", path.display()))?;

    Ok(document.get("app").cloned())
}

#[tauri::command(rename_all = "snake_case")]
pub fn write_app_config(app: AppHandle, config_name: &str, value: Value) -> Result<(), String> {
    let root = app_root(&app)?;
    let path = resolve_config_path(&root, config_name)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Config path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("Could not create '{}': {err}", parent.display()))?;

    // Preserve the upstream file shape while exposing only the nested app value to the frontend.
    let document = serde_json::to_string_pretty(&json!({ "app": value }))
        .map_err(|err| format!("Could not serialize '{}': {err}", path.display()))?;
    fs::write(&path, document).map_err(|err| format!("Could not write '{}': {err}", path.display()))
}

pub fn if_app_config_does_not_exist_create_default(app: &AppHandle, config_name: &str) {
    let root = match app_root(app) {
        Ok(root) => root,
        Err(err) => {
            error!("{err}");
            return;
        }
    };
    let path = match resolve_config_path(&root, config_name) {
        Ok(path) => path,
        Err(err) => {
            error!("{err}");
            return;
        }
    };

    if path.exists() {
        return;
    }

    let default_config = match config_name {
        "settings.json" => include_str!("default/settings.json"),
        "pets.json" => include_str!("default/pets.json"),
        _ => return,
    };
    let json_data: Value = serde_json::from_str(default_config).unwrap();

    if let Err(err) = write_app_config(app.clone(), config_name, json_data) {
        error!("Could not create default config file '{config_name}': {err}");
        return;
    }

    info!("Create default config file: {config_name}");
}

#[cfg(test)]
mod tests {
    use super::{is_allowed_asset_path, is_allowed_config_path, relative_to_app_root};
    use std::path::Path;

    #[test]
    fn config_paths_stay_in_named_buckets() {
        assert!(is_allowed_config_path(Path::new("settings.json")));
        assert!(is_allowed_config_path(Path::new("custom-pets/warple.json")));

        assert!(!is_allowed_config_path(Path::new("../settings.json")));
        assert!(!is_allowed_config_path(Path::new(
            "custom-pets/../../outside.json"
        )));
        assert!(!is_allowed_config_path(Path::new(
            "custom-pets/nested/warple.json"
        )));
        assert!(!is_allowed_config_path(Path::new("custom-pets/warple.png")));
    }

    #[test]
    fn assets_only_allow_png_files_in_the_asset_bucket() {
        assert!(is_allowed_asset_path(Path::new("assets/warple.png")));
        assert!(!is_allowed_asset_path(Path::new("../warple.png")));
        assert!(!is_allowed_asset_path(Path::new("assets/warple.json")));
        assert!(!is_allowed_asset_path(Path::new(
            "assets/nested/warple.png"
        )));
    }

    #[test]
    fn absolute_paths_must_stay_under_the_resolved_app_root() {
        let root = std::env::temp_dir().join("warple-config-root");
        let allowed = root.join("assets").join("warple.png");
        let outside = std::env::temp_dir().join("outside").join("warple.png");

        assert_eq!(
            relative_to_app_root(&root, allowed.to_str().unwrap()).unwrap(),
            Path::new("assets").join("warple.png")
        );
        assert!(relative_to_app_root(&root, outside.to_str().unwrap()).is_err());
    }
}
