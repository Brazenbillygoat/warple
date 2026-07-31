use super::conf::AppConfig;
use log::info;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub async fn reopen_main_window(app: tauri::AppHandle) -> Result<(), String> {
    // Reuse the single overlay because duplicate fullscreen windows double the Phaser workload.
    if let Some(window) = app.get_webview_window("main") {
        window.set_focus().map_err(|e| e.to_string())?;
        info!("Main window already exists, brought to focus");
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::App("/".into()))
        .fullscreen(true)
        .resizable(false)
        .transparent(true)
        .always_on_top(true)
        .title("Warple")
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;

    // Start click-through and let the frontend enable input only over visible pet pixels.
    window
        .set_ignore_cursor_events(true)
        .map_err(|e| e.to_string())?;
    info!("Reopened main window");

    Ok(())
}

pub fn open_setting_window(app: tauri::AppHandle) {
    let settings = AppConfig::new(&app);
    let _window = WebviewWindowBuilder::new(&app, "setting", WebviewUrl::App("/setting".into()))
        .title("Warple Settings")
        .inner_size(1000.0, 650.0)
        .theme(if settings.get_theme() == "dark" {
            Some(tauri::Theme::Dark)
        } else {
            Some(tauri::Theme::Light)
        })
        .build()
        .unwrap_or_else(|e| {
            log::error!("Failed to create setting window: {}", e);
            panic!("Window creation failed: {}", e);
        });
    info!("open setting window");
}
