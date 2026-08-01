#![cfg_attr(all(target_os = "windows", not(test)), windows_subsystem = "windows")]

mod app;

use app::{cmd, desktop, lifecycle};
use lifecycle::OverlayLifecycle;
use log::{error, info};
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

fn build_app() {
    let context = tauri::generate_context!();
    let builder = tauri::Builder::default()
        .manage(OverlayLifecycle::default())
        .manage(desktop::DesktopObserver::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            lifecycle::show_or_resume(app);
        }))
        .plugin(
            tauri_plugin_log::Builder::default()
                .clear_targets()
                .targets([
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Stdout),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            if let Err(reason) = lifecycle::create_initial_overlay(app.handle()) {
                error!("{reason}");
                app.state::<OverlayLifecycle>().mark_explicit_exit();
                app.handle().exit(1);
                return Ok(());
            }
            info!("Warple startup is awaiting frontend readiness");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd::get_mouse_position,
            desktop::get_desktop_environment,
            desktop::get_desktop_item_details,
            lifecycle::startup_ready,
            lifecycle::abort_startup,
        ]);

    let app = match builder.build(context) {
        Ok(app) => app,
        Err(reason) => {
            eprintln!("Failed to initialize Warple: {reason}");
            std::process::exit(1);
        }
    };

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if app_handle.state::<OverlayLifecycle>().should_prevent_exit() {
                api.prevent_exit();
            }
        }
    });
}

fn main() {
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--ignore-gpu-blocklist",
    );
    build_app();
}

#[cfg(test)]
mod tests {
    #[test]
    fn generated_identity_is_warple() {
        let context: tauri::Context<tauri::Wry> = tauri::generate_context!();

        assert_eq!(context.config().product_name.as_deref(), Some("Warple"));
        assert_eq!(context.config().main_binary_name.as_deref(), Some("Warple"));
        assert_eq!(
            context.config().identifier,
            "io.github.brazenbillygoat.warple"
        );
    }
}
