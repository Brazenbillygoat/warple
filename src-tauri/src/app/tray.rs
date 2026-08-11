use log::{error, info};
use tauri::{
    menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use super::lifecycle;
use super::profile_selection::{ProfileSelection, SelectionOutcome, TraySelection};

pub const TRAY_ID: &str = "warple-tray";
pub const CHARACTER_MENU_ID: &str = "character";
pub const CHARACTER_ITEM_PREFIX: &str = "character:";

pub const TRAY_ACTIONS: [(&str, &str); 4] = [
    ("show_resume", "Show/Resume"),
    ("pause", "Pause"),
    ("restart", "Restart"),
    ("quit", "Quit"),
];

pub fn character_item_id(profile_id: &str) -> String {
    format!("{CHARACTER_ITEM_PREFIX}{profile_id}")
}

pub fn strip_character_prefix(id: &str) -> Option<&str> {
    id.strip_prefix(CHARACTER_ITEM_PREFIX)
}

pub fn escape_menu_label(label: &str) -> String {
    label.replace('&', "&&")
}

pub enum MenuRoute {
    Lifecycle,
    Character(String),
    Unknown,
}

pub fn route_menu_event(id: &str) -> MenuRoute {
    if let Some(profile_id) = strip_character_prefix(id) {
        return MenuRoute::Character(profile_id.to_string());
    }
    match id {
        "show_resume" | "pause" | "restart" | "quit" => MenuRoute::Lifecycle,
        _ => MenuRoute::Unknown,
    }
}

fn build_menu(app: &AppHandle, selection: &TraySelection) -> tauri::Result<Menu<tauri::Wry>> {
    let show_resume = MenuItemBuilder::with_id(TRAY_ACTIONS[0].0, TRAY_ACTIONS[0].1).build(app)?;
    let pause = MenuItemBuilder::with_id(TRAY_ACTIONS[1].0, TRAY_ACTIONS[1].1).build(app)?;
    let restart = MenuItemBuilder::with_id(TRAY_ACTIONS[2].0, TRAY_ACTIONS[2].1).build(app)?;

    let mut submenu_builder = SubmenuBuilder::with_id(app, CHARACTER_MENU_ID, "Character");
    for entry in &selection.catalog {
        let id = character_item_id(&entry.id);
        let label = escape_menu_label(&entry.display_name);
        let checked = entry.id == selection.checked_id;
        let item = CheckMenuItemBuilder::with_id(&id, label)
            .checked(checked)
            .build(app)?;
        submenu_builder = submenu_builder.item(&item);
    }
    let character_submenu = submenu_builder.build()?;

    let quit = MenuItemBuilder::with_id(TRAY_ACTIONS[3].0, TRAY_ACTIONS[3].1).build(app)?;

    MenuBuilder::new(app)
        .item(&show_resume)
        .item(&pause)
        .item(&restart)
        .item(&character_submenu)
        .item(&quit)
        .build()
}

fn handle_character_selection(app: &AppHandle, profile_id: &str) {
    let selection = app.state::<ProfileSelection>();
    let outcome = selection.select(profile_id);

    if let Some(tray_selection) = selection.tray_state() {
        if let Err(reason) = refresh_tray_menu(app, &tray_selection) {
            error!("Failed to refresh character menu: {reason}");
        }
    }

    match outcome {
        SelectionOutcome::Changed => lifecycle::request_relaunch(app),
        SelectionOutcome::UnknownItem => error!("Ignored unknown character selection"),
        SelectionOutcome::PersistenceFailure => error!("Failed to persist character selection"),
        SelectionOutcome::SameSelection => {}
    }
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match route_menu_event(id) {
        MenuRoute::Character(profile_id) => handle_character_selection(app, &profile_id),
        MenuRoute::Lifecycle => match id {
            "show_resume" => lifecycle::show_or_resume(app),
            "pause" => lifecycle::pause(app),
            "restart" => {
                info!("Restarting Warple");
                app.state::<lifecycle::OverlayLifecycle>()
                    .mark_explicit_exit();
                app.restart();
            }
            "quit" => {
                info!("Quitting Warple");
                app.state::<lifecycle::OverlayLifecycle>()
                    .mark_explicit_exit();
                app.exit(0);
            }
            _ => error!("Ignored unknown tray action"),
        },
        MenuRoute::Unknown => error!("Ignored unknown tray action"),
    }
}

pub fn init_system_tray(app: &AppHandle, selection: &TraySelection) -> tauri::Result<()> {
    let menu = build_menu(app, selection)?;
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
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

pub fn refresh_tray_menu(app: &AppHandle, selection: &TraySelection) -> tauri::Result<()> {
    let menu = build_menu(app, selection)?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_actions_remain_show_resume_pause_restart_quit() {
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

    #[test]
    fn character_item_ids_use_reserved_prefix() {
        assert_eq!(character_item_id("blooky"), "character:blooky");
        assert_eq!(character_item_id("jo"), "character:jo");
    }

    #[test]
    fn strip_character_prefix_extracts_profile_id() {
        assert_eq!(strip_character_prefix("character:blooky"), Some("blooky"));
        assert_eq!(strip_character_prefix("character:jo"), Some("jo"));
        assert_eq!(strip_character_prefix("show_resume"), None);
        assert_eq!(strip_character_prefix("character:"), Some(""));
    }

    #[test]
    fn escape_menu_label_doubles_ampersands() {
        assert_eq!(escape_menu_label("Blooky"), "Blooky");
        assert_eq!(escape_menu_label("Tom & Jerry"), "Tom && Jerry");
        assert_eq!(escape_menu_label("A & B & C"), "A && B && C");
        assert_eq!(escape_menu_label(""), "");
    }

    #[test]
    fn route_menu_event_routes_character_and_lifecycle_ids() {
        assert!(matches!(
            route_menu_event("character:blooky"),
            MenuRoute::Character(id) if id == "blooky"
        ));
        assert!(matches!(
            route_menu_event("show_resume"),
            MenuRoute::Lifecycle
        ));
        assert!(matches!(route_menu_event("pause"), MenuRoute::Lifecycle));
        assert!(matches!(route_menu_event("restart"), MenuRoute::Lifecycle));
        assert!(matches!(route_menu_event("quit"), MenuRoute::Lifecycle));
        assert!(matches!(route_menu_event("unknown"), MenuRoute::Unknown));
    }

    #[test]
    fn tray_selection_checks_exactly_one_entry() {
        let catalog = vec![
            super::super::profile_selection::ProfileCatalogEntry {
                id: "blooky".to_string(),
                display_name: "Blooky".to_string(),
            },
            super::super::profile_selection::ProfileCatalogEntry {
                id: "jo".to_string(),
                display_name: "Jo".to_string(),
            },
        ];
        let selection = TraySelection {
            catalog,
            checked_id: "blooky".to_string(),
        };

        let checked_count = selection
            .catalog
            .iter()
            .filter(|entry| entry.id == selection.checked_id)
            .count();
        assert_eq!(checked_count, 1);
        assert_eq!(selection.catalog[0].id, "blooky");
        assert_eq!(selection.catalog[1].id, "jo");
    }
}
