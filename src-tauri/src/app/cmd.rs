use log::error;
use mouse_position::mouse_position::Mouse;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MousePosition {
    client_x: i32,
    client_y: i32,
}

#[tauri::command]
pub fn get_mouse_position() -> Option<MousePosition> {
    match Mouse::get_mouse_position() {
        Mouse::Position { x, y } => Some(MousePosition {
            client_x: x,
            client_y: y,
        }),
        Mouse::Error => {
            error!("Failed to read native cursor position");
            None
        }
    }
}
