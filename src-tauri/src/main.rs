// Release builds hide the extra Windows console while debug builds keep terminal logs visible.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
use app::{cmd, conf, tray, utils};
use log::info;
use tauri::{Emitter, Manager};
use tauri_plugin_log::{Target, TargetKind};

#[derive(Clone, serde::Serialize)]
struct Payload {
    args: Vec<String>,
    cwd: String,
}

fn build_app() {
    let context = tauri::generate_context!();
    let log_root = conf::app_config_root_from_base(
        &dirs::config_dir().expect("operating system config directory is unavailable"),
        &context.config().identifier,
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            println!("{}, {argv:?}, {cwd}", app.package_info().name);

            app.emit("single-instance", Payload { args: argv, cwd })
                .unwrap();
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .clear_targets()
                .targets([
                    Target::new(TargetKind::Folder {
                        path: log_root,
                        file_name: None,
                    }),
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::Webview),
                ])
                .level(log::LevelFilter::Info)
                // Raise this temporarily when native diagnostics need more detail.
                // .level(log::LevelFilter::Debug)
                .build(),
        )
        .setup(move |app| {
            let window = app.get_webview_window("main").unwrap();
            window
                .set_ignore_cursor_events(true)
                .unwrap_or_else(|err| println!("{:?}", err));

            let app_handle = app.handle().clone();
            conf::if_app_config_does_not_exist_create_default(&app_handle, "settings.json");
            conf::if_app_config_does_not_exist_create_default(&app_handle, "pets.json");
            tray::init_system_tray(app)?;
            info!("app started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            conf::combine_config_path,
            conf::read_app_config,
            conf::write_app_config,
            cmd::get_mouse_position,
            cmd::open_config_folder,
            utils::reopen_main_window,
        ])
        .build(context)
        .expect("error while running tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                // Closing a window pauses its UI; only the tray Quit action terminates the process.
                api.prevent_exit();
            }
        });
}

fn main() {
    // WebView2 needs this override for transparent hardware rendering on some Windows systems.
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--ignore-gpu-blocklist",
    );

    build_app();
}

#[cfg(test)]
mod tests {
    use super::app::conf;
    use std::path::Path;

    #[test]
    fn generated_identity_derives_the_warple_app_config_root() {
        let context: tauri::Context<tauri::Wry> = tauri::generate_context!();

        assert_eq!(context.config().product_name.as_deref(), Some("Warple"));
        assert_eq!(context.config().main_binary_name.as_deref(), Some("Warple"));
        assert_eq!(
            context.config().identifier,
            "io.github.brazenbillygoat.warple"
        );
        assert_eq!(
            conf::app_config_root_from_base(Path::new("config"), &context.config().identifier),
            Path::new("config").join("io.github.brazenbillygoat.warple")
        );
    }
}
