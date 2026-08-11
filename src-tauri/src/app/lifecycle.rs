use std::sync::Mutex;

use log::{error, info};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalRect, PhysicalSize, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

use super::profile_selection::{ProfileCatalogEntry, ProfileSelection};
use super::tray;

const OVERLAY_LABEL: &str = "main";

#[derive(Debug, Clone, Copy, PartialEq)]
struct Rectangle {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct DisplayGeometry {
    scale_factor: f64,
    monitor: Rectangle,
    work_area: Rectangle,
}

impl DisplayGeometry {
    fn from_physical(
        scale_factor: f64,
        monitor_position: PhysicalPosition<i32>,
        monitor_size: PhysicalSize<u32>,
        work_area: PhysicalRect<i32, u32>,
    ) -> Result<Self, String> {
        if !scale_factor.is_finite() || scale_factor <= 0.0 {
            return Err("primary display reported an invalid scale factor".into());
        }

        let monitor = Rectangle {
            x: f64::from(monitor_position.x) / scale_factor,
            y: f64::from(monitor_position.y) / scale_factor,
            width: f64::from(monitor_size.width) / scale_factor,
            height: f64::from(monitor_size.height) / scale_factor,
        };
        let work_area = Rectangle {
            x: f64::from(work_area.position.x - monitor_position.x) / scale_factor,
            y: f64::from(work_area.position.y - monitor_position.y) / scale_factor,
            width: f64::from(work_area.size.width) / scale_factor,
            height: f64::from(work_area.size.height) / scale_factor,
        };
        if work_area.x < 0.0
            || work_area.y < 0.0
            || work_area.width <= 0.0
            || work_area.height <= 0.0
            || work_area.x + work_area.width > monitor.width
            || work_area.y + work_area.height > monitor.height
        {
            return Err("primary display reported an invalid work area".into());
        }

        Ok(Self {
            scale_factor,
            monitor,
            work_area,
        })
    }

    fn startup_url(self, generation: u64, profile_id: Option<&str>) -> String {
        let mut url = format!(
            "/?generation={generation}&scaleFactor={}&monitorX={}&monitorY={}&monitorWidth={}&monitorHeight={}&workAreaX={}&workAreaY={}&workAreaWidth={}&workAreaHeight={}",
            self.scale_factor,
            self.monitor.x,
            self.monitor.y,
            self.monitor.width,
            self.monitor.height,
            self.work_area.x,
            self.work_area.y,
            self.work_area.width,
            self.work_area.height,
        );
        if let Some(id) = profile_id {
            url.push_str("&profileId=");
            url.push_str(id);
        }
        url
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LaunchKind {
    Initial,
    Resume,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DisplayFailureAction {
    ExitWithoutTray,
    KeepTrayPaused,
}

impl LaunchKind {
    fn display_failure_action(self) -> DisplayFailureAction {
        match self {
            Self::Initial => DisplayFailureAction::ExitWithoutTray,
            Self::Resume => DisplayFailureAction::KeepTrayPaused,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReadinessAction {
    Ignore,
    CreateTrayAndShow,
    Show,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PendingReadiness {
    Awaiting,
    Claimed,
}

#[derive(Debug, Clone, Copy)]
struct PendingOverlay {
    generation: u64,
    readiness: PendingReadiness,
}

#[derive(Default)]
struct LifecycleState {
    next_generation: u64,
    pending: Option<PendingOverlay>,
    overlay_visible: bool,
    tray_created: bool,
    explicit_exit: bool,
    relaunch_intent: bool,
}

impl LifecycleState {
    fn begin_overlay(&mut self) -> u64 {
        self.next_generation = self.next_generation.saturating_add(1).max(1);
        self.pending = Some(PendingOverlay {
            generation: self.next_generation,
            readiness: PendingReadiness::Awaiting,
        });
        self.next_generation
    }

    fn claim_readiness(&mut self, generation: u64) -> ReadinessAction {
        let Some(pending) = self.pending.as_mut() else {
            return ReadinessAction::Ignore;
        };
        if pending.generation != generation || pending.readiness != PendingReadiness::Awaiting {
            return ReadinessAction::Ignore;
        }
        pending.readiness = PendingReadiness::Claimed;
        if self.tray_created {
            ReadinessAction::Show
        } else {
            ReadinessAction::CreateTrayAndShow
        }
    }

    fn finish_readiness(&mut self, generation: u64, tray_created: bool) {
        if self
            .pending
            .is_some_and(|pending| pending.generation == generation)
        {
            self.pending = None;
            self.overlay_visible = true;
            self.tray_created |= tray_created;
        }
    }

    fn claim_abort(&mut self, generation: u64) -> bool {
        if self
            .pending
            .is_some_and(|pending| pending.generation == generation)
        {
            self.pending = None;
            self.overlay_visible = false;
            self.explicit_exit = true;
            true
        } else {
            false
        }
    }

    fn overlay_closed(&mut self, generation: u64) {
        if self
            .pending
            .is_some_and(|pending| pending.generation == generation)
        {
            self.pending = None;
        }
        self.overlay_visible = false;
    }

    fn set_relaunch_intent(&mut self) -> bool {
        if self.overlay_visible || self.pending.is_some() {
            self.relaunch_intent = true;
            true
        } else {
            false
        }
    }

    fn clear_relaunch_intent(&mut self) {
        self.relaunch_intent = false;
    }

    fn consume_relaunch_intent(&mut self) -> bool {
        let intent = self.relaunch_intent;
        self.relaunch_intent = false;
        intent
    }
}

#[derive(Default)]
pub struct OverlayLifecycle {
    state: Mutex<LifecycleState>,
}

impl OverlayLifecycle {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, LifecycleState>, String> {
        self.state
            .lock()
            .map_err(|_| "overlay lifecycle state is unavailable".to_string())
    }

    pub fn mark_explicit_exit(&self) {
        match self.lock() {
            Ok(mut state) => state.explicit_exit = true,
            Err(reason) => error!("{reason}"),
        }
    }

    pub fn should_prevent_exit(&self) -> bool {
        self.lock().map_or(true, |state| !state.explicit_exit)
    }
}

fn resolve_primary_display(app: &AppHandle) -> Result<DisplayGeometry, String> {
    let monitor = app
        .primary_monitor()
        .map_err(|reason| format!("failed to query primary display: {reason}"))?
        .ok_or_else(|| "primary display is unavailable".to_string())?;
    DisplayGeometry::from_physical(
        monitor.scale_factor(),
        *monitor.position(),
        *monitor.size(),
        *monitor.work_area(),
    )
}

fn create_overlay(app: &AppHandle, launch_kind: LaunchKind) -> Result<bool, String> {
    let lifecycle = app.state::<OverlayLifecycle>();
    let mut state = lifecycle.lock()?;
    if app.get_webview_window(OVERLAY_LABEL).is_some() {
        return Ok(false);
    }

    let geometry = resolve_primary_display(app).map_err(|reason| {
        match launch_kind.display_failure_action() {
            DisplayFailureAction::ExitWithoutTray => {
                format!("initial primary-display resolution failed: {reason}")
            }
            DisplayFailureAction::KeepTrayPaused => {
                format!("resume primary-display resolution failed: {reason}")
            }
        }
    })?;
    let generation = state.begin_overlay();
    let profile_id = app.state::<ProfileSelection>().startup_candidate();
    let url = geometry.startup_url(generation, profile_id.as_deref());

    let window = match WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App(url.into()))
        .title("Warple")
        .position(geometry.monitor.x, geometry.monitor.y)
        .inner_size(geometry.monitor.width, geometry.monitor.height)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .focused(false)
        .focusable(false)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .use_https_scheme(true)
        .build()
    {
        Ok(window) => window,
        Err(reason) => {
            state.overlay_closed(generation);
            return Err(format!("failed to create companion overlay: {reason}"));
        }
    };

    if let Err(reason) = window.set_ignore_cursor_events(true) {
        state.overlay_closed(generation);
        let _ = window.close();
        return Err(format!(
            "failed to make companion overlay click-through: {reason}"
        ));
    }

    #[cfg(all(debug_assertions, feature = "desktop-diagnostics"))]
    window.open_devtools();

    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            let lifecycle = app_handle.state::<OverlayLifecycle>();
            let should_relaunch = match lifecycle.lock() {
                Ok(mut state) => {
                    state.overlay_closed(generation);
                    state.consume_relaunch_intent()
                }
                Err(reason) => {
                    error!("{reason}");
                    false
                }
            };
            if should_relaunch {
                show_or_resume(&app_handle);
            }
        }
    });
    Ok(true)
}

pub fn create_initial_overlay(app: &AppHandle) -> Result<(), String> {
    create_overlay(app, LaunchKind::Initial).map(|_| ())
}

pub fn show_or_resume(app: &AppHandle) {
    match create_overlay(app, LaunchKind::Resume) {
        Ok(true) => info!("Companion overlay is awaiting frontend readiness"),
        Ok(false) => {}
        Err(reason) => error!("{reason}"),
    }
}

pub fn pause(app: &AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        if let Ok(mut state) = app.state::<OverlayLifecycle>().lock() {
            state.clear_relaunch_intent();
        }
        return;
    };
    if let Ok(mut state) = app.state::<OverlayLifecycle>().lock() {
        state.clear_relaunch_intent();
    }
    if let Err(reason) = window.close() {
        error!("Failed to pause companion overlay: {reason}");
    }
}

pub fn request_relaunch(app: &AppHandle) {
    let should_close = match app.state::<OverlayLifecycle>().lock() {
        Ok(mut state) => state.set_relaunch_intent(),
        Err(reason) => {
            error!("{reason}");
            return;
        }
    };
    if !should_close {
        return;
    }
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        if let Ok(mut state) = app.state::<OverlayLifecycle>().lock() {
            state.clear_relaunch_intent();
        }
        return;
    };
    if let Err(reason) = window.close() {
        error!("Failed to close companion overlay for replacement: {reason}");
        if let Ok(mut state) = app.state::<OverlayLifecycle>().lock() {
            state.clear_relaunch_intent();
        }
    }
}

fn fail_claimed_startup(app: &AppHandle, generation: u64, reason: &str) {
    error!("{reason}");
    let lifecycle = app.state::<OverlayLifecycle>();
    if let Ok(mut state) = lifecycle.lock() {
        state.claim_abort(generation);
    }
    lifecycle.mark_explicit_exit();
    app.exit(1);
}

#[tauri::command(rename_all = "camelCase")]
pub fn startup_ready(
    app: AppHandle,
    window: WebviewWindow,
    lifecycle: State<'_, OverlayLifecycle>,
    selection: State<'_, ProfileSelection>,
    generation: u64,
    profiles: Vec<ProfileCatalogEntry>,
    active_profile_id: String,
) -> Result<(), String> {
    if window.label() != OVERLAY_LABEL {
        return Err("startup readiness is restricted to the companion overlay".into());
    }

    let action = lifecycle.lock()?.claim_readiness(generation);
    if action == ReadinessAction::Ignore {
        return Ok(());
    }

    let tray_selection = match selection.accept_ready_catalog(&profiles, &active_profile_id) {
        Ok(Some(tray_selection)) => tray_selection,
        Ok(None) => {
            request_relaunch(&app);
            return Ok(());
        }
        Err(reason) => {
            fail_claimed_startup(&app, generation, "Companion startup catalog is invalid");
            return Err(reason);
        }
    };

    let created_tray = action == ReadinessAction::CreateTrayAndShow;
    if created_tray {
        if let Err(reason) = tray::init_system_tray(&app, &tray_selection) {
            fail_claimed_startup(&app, generation, "Failed to create lifecycle tray");
            return Err(reason.to_string());
        }
    } else if let Err(reason) = tray::refresh_tray_menu(&app, &tray_selection) {
        fail_claimed_startup(&app, generation, "Failed to refresh character tray menu");
        return Err(reason.to_string());
    }
    if let Err(reason) = window.show() {
        fail_claimed_startup(&app, generation, "Failed to show ready companion overlay");
        return Err(reason.to_string());
    }

    lifecycle.lock()?.finish_readiness(generation, created_tray);
    info!("Companion overlay is ready");
    Ok(())
}

#[tauri::command]
pub fn abort_startup(
    app: AppHandle,
    window: WebviewWindow,
    lifecycle: State<'_, OverlayLifecycle>,
    generation: u64,
) -> Result<(), String> {
    if window.label() != OVERLAY_LABEL {
        return Err("startup abort is restricted to the companion overlay".into());
    }
    if lifecycle.lock()?.claim_abort(generation) {
        error!("Companion frontend startup validation failed");
        app.exit(1);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_monitor_and_work_area_from_physical_coordinates() {
        let geometry = DisplayGeometry::from_physical(
            1.5,
            PhysicalPosition::new(-1920, 0),
            PhysicalSize::new(1920, 1080),
            PhysicalRect {
                position: PhysicalPosition::new(-1860, 36),
                size: PhysicalSize::new(1800, 984),
            },
        )
        .unwrap();

        assert_eq!(
            geometry,
            DisplayGeometry {
                scale_factor: 1.5,
                monitor: Rectangle {
                    x: -1280.0,
                    y: 0.0,
                    width: 1280.0,
                    height: 720.0,
                },
                work_area: Rectangle {
                    x: 40.0,
                    y: 24.0,
                    width: 1200.0,
                    height: 656.0,
                },
            }
        );
        let url = geometry.startup_url(9, None);
        assert!(url.contains("generation=9"));
        assert!(url.contains("workAreaX=40"));
        assert!(url.contains("workAreaHeight=656"));
        assert!(!url.contains("profileId"));

        let url_with_profile = geometry.startup_url(9, Some("blooky"));
        assert!(url_with_profile.contains("profileId=blooky"));
    }

    #[test]
    fn initial_and_resume_display_failures_have_distinct_outcomes() {
        assert_eq!(
            LaunchKind::Initial.display_failure_action(),
            DisplayFailureAction::ExitWithoutTray
        );
        assert_eq!(
            LaunchKind::Resume.display_failure_action(),
            DisplayFailureAction::KeepTrayPaused
        );
    }

    #[test]
    fn readiness_is_one_shot_per_overlay_generation() {
        let mut state = LifecycleState::default();
        let generation = state.begin_overlay();
        assert_eq!(
            state.claim_readiness(generation),
            ReadinessAction::CreateTrayAndShow
        );
        assert_eq!(state.claim_readiness(generation), ReadinessAction::Ignore);
        state.finish_readiness(generation, true);

        let resumed_generation = state.begin_overlay();
        assert_eq!(state.claim_readiness(generation), ReadinessAction::Ignore);
        assert_eq!(
            state.claim_readiness(resumed_generation),
            ReadinessAction::Show
        );
    }

    #[test]
    fn explicit_exit_is_distinct_from_implicit_last_window_exit() {
        let lifecycle = OverlayLifecycle::default();
        assert!(lifecycle.should_prevent_exit());
        lifecycle.mark_explicit_exit();
        assert!(!lifecycle.should_prevent_exit());
    }

    #[test]
    fn relaunch_intent_is_set_while_overlay_is_visible() {
        let mut state = LifecycleState::default();

        assert!(!state.set_relaunch_intent());

        let generation = state.begin_overlay();
        state.claim_readiness(generation);
        state.finish_readiness(generation, true);

        assert!(state.overlay_visible);
        assert!(state.set_relaunch_intent());
        assert!(state.relaunch_intent);
    }

    #[test]
    fn relaunch_intent_is_set_while_overlay_is_awaiting_readiness() {
        let mut state = LifecycleState::default();
        state.begin_overlay();

        assert!(!state.overlay_visible);
        assert!(state.pending.is_some());
        assert!(state.set_relaunch_intent());
        assert!(state.relaunch_intent);
    }

    #[test]
    fn relaunch_intent_is_consumed_once_on_overlay_close() {
        let mut state = LifecycleState::default();
        let generation = state.begin_overlay();
        state.claim_readiness(generation);
        state.finish_readiness(generation, true);
        state.set_relaunch_intent();

        state.overlay_closed(generation);
        assert!(state.consume_relaunch_intent());
        assert!(!state.consume_relaunch_intent());
    }

    #[test]
    fn relaunch_intent_is_cleared_on_pause() {
        let mut state = LifecycleState::default();
        let generation = state.begin_overlay();
        state.claim_readiness(generation);
        state.finish_readiness(generation, true);
        state.set_relaunch_intent();

        state.clear_relaunch_intent();
        assert!(!state.relaunch_intent);
    }

    #[test]
    fn paused_selection_does_not_request_relaunch() {
        let mut state = LifecycleState::default();
        let generation = state.begin_overlay();
        state.claim_readiness(generation);
        state.finish_readiness(generation, true);
        state.overlay_closed(generation);

        assert!(!state.overlay_visible);
        assert!(!state.set_relaunch_intent());
    }

    #[test]
    fn repeated_relaunch_requests_converge_on_one_intent() {
        let mut state = LifecycleState::default();
        let generation = state.begin_overlay();
        state.claim_readiness(generation);
        state.finish_readiness(generation, true);

        assert!(state.set_relaunch_intent());
        assert!(state.set_relaunch_intent());

        state.overlay_closed(generation);
        assert!(state.consume_relaunch_intent());
        assert!(!state.consume_relaunch_intent());
    }
}
