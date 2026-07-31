use super::utils::{open_setting_window, reopen_main_window};
use log::info;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager,
};
use tauri_plugin_dialog::DialogExt;

fn show_message(app: &AppHandle, message: &str) {
    app.dialog()
        .message(message)
        .title("Warple Dialog")
        .show(|_| {});
}

fn open_or_focus_setting_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("setting") {
        let _ = window.set_focus();
        show_message(app, "Warple settings already exist");
    } else {
        open_setting_window(app.clone());
    }
}

fn handle_tray_menu_event(app: &AppHandle, id: &str) {
    match id {
        "show" => match app.get_webview_window("main") {
            Some(window) => {
                let _ = window.set_focus();
                show_message(app, "Pet already exists");
            }
            None => {
                tauri::async_runtime::spawn(reopen_main_window(app.clone()));
            }
        },
        "pause" => match app.get_webview_window("main") {
            Some(window) => {
                window.close().expect("failed to close frontend window");
            }
            None => {
                println!("Window not found");
            }
        },
        "setting" => open_or_focus_setting_window(app),
        "restart" => {
            info!("Restart Warple");
            app.restart();
        }
        "quit" => {
            info!("Quit Warple");
            app.exit(0);
        }
        _ => {}
    }
}

pub fn init_system_tray(app: &mut App) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("show", "Show").build(app)?;
    let pause = MenuItemBuilder::with_id("pause", "Pause (Free Memory)").build(app)?;
    let setting = MenuItemBuilder::with_id("setting", "Setting").build(app)?;
    let restart = MenuItemBuilder::with_id("restart", "Restart").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&pause)
        .item(&setting)
        .separator()
        .item(&restart)
        .item(&quit)
        .build()?;

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_tray_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                open_or_focus_setting_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}
