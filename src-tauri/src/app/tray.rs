use log::{error, info};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use super::lifecycle::{self, OverlayLifecycle};

pub const TRAY_ACTIONS: [(&str, &str); 4] = [
    ("show_resume", "Show/Resume"),
    ("pause", "Pause"),
    ("restart", "Restart"),
    ("quit", "Quit"),
];

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "show_resume" => lifecycle::show_or_resume(app),
        "pause" => lifecycle::pause(app),
        "restart" => {
            info!("Restarting Warple");
            app.state::<OverlayLifecycle>().mark_explicit_exit();
            app.restart();
        }
        "quit" => {
            info!("Quitting Warple");
            app.state::<OverlayLifecycle>().mark_explicit_exit();
            app.exit(0);
        }
        _ => error!("Ignored unknown tray action"),
    }
}

pub fn init_system_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_resume = MenuItemBuilder::with_id(TRAY_ACTIONS[0].0, TRAY_ACTIONS[0].1).build(app)?;
    let pause = MenuItemBuilder::with_id(TRAY_ACTIONS[1].0, TRAY_ACTIONS[1].1).build(app)?;
    let restart = MenuItemBuilder::with_id(TRAY_ACTIONS[2].0, TRAY_ACTIONS[2].1).build(app)?;
    let quit = MenuItemBuilder::with_id(TRAY_ACTIONS[3].0, TRAY_ACTIONS[3].1).build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show_resume)
        .item(&pause)
        .item(&restart)
        .item(&quit)
        .build()?;

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                lifecycle::show_or_resume(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_contains_only_the_lifecycle_actions() {
        assert_eq!(
            TRAY_ACTIONS,
            [
                ("show_resume", "Show/Resume"),
                ("pause", "Pause"),
                ("restart", "Restart"),
                ("quit", "Quit"),
            ]
        );
    }
}
