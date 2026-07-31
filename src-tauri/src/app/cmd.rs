use log::{error, info};
use mouse_position::mouse_position::Mouse;
use serde_json::json;
use tauri::AppHandle;

use super::conf::app_root;

#[tauri::command]
pub fn get_mouse_position() -> serde_json::Value {
    // Click-through webviews cannot report pointer movement, so read the OS cursor position here.
    let position = Mouse::get_mouse_position();
    match position {
        Mouse::Position { x, y } => {
            json!({
                "clientX": x,
                "clientY": y
            })
        }
        Mouse::Error => {
            error!("Error getting mouse position");
            println!("Error getting mouse position");
            json!(null)
        }
    }
}

#[tauri::command]
pub fn open_config_folder(app: AppHandle) {
    let path = match app_root(&app) {
        Ok(path) => path,
        Err(err) => {
            error!("{err}");
            return;
        }
    };
    match open::that(&path) {
        Ok(()) => info!("Open config folder: {}", path.display()),
        Err(err) => error!(
            "An error occurred when opening '{}': {}",
            path.display(),
            err
        ),
    }
}
