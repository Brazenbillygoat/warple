use serde::Serialize;
use tauri::State;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "windows")]
pub use windows::DesktopObserver;

const MAX_SEQUENCE: u64 = i64::MAX as u64;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalRectangle {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundWindowCandidate {
    pub id: String,
    pub bounds: PhysicalRectangle,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopItemAttributes {
    pub file_system: bool,
    pub folder: bool,
    pub shortcut: bool,
    pub hidden: bool,
    pub read_only: bool,
    pub shared: bool,
    pub copyable: bool,
    pub movable: bool,
    pub linkable: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutSummary {
    pub target: Option<String>,
    pub arguments: Option<String>,
    pub working_directory: Option<String>,
    pub description: Option<String>,
    pub icon_location: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopItemSummary {
    pub id: String,
    pub display_name: String,
    pub editing_name: String,
    pub position: PhysicalPoint,
    pub bounds: PhysicalRectangle,
    pub selected: bool,
    pub focused: bool,
    pub source_order: u32,
    pub shell_kinds: Vec<String>,
    pub file_system_path: Option<String>,
    pub parsing_path: String,
    pub shortcut: Option<ShortcutSummary>,
    pub attributes: DesktopItemAttributes,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopEnvironmentObservation {
    pub available: bool,
    pub sequence: u64,
    pub foreground_window: Option<ForegroundWindowCandidate>,
    pub desktop_shell_active: bool,
    pub desktop_items: Vec<DesktopItemSummary>,
}

impl DesktopEnvironmentObservation {
    fn unavailable(sequence: u64) -> Self {
        Self {
            available: false,
            sequence,
            foreground_window: None,
            desktop_shell_active: false,
            desktop_items: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum PropertyValue {
    Boolean(bool),
    Number(f64),
    Text(String),
    Booleans(Vec<bool>),
    Numbers(Vec<f64>),
    Texts(Vec<String>),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyRecord {
    pub canonical_name: String,
    pub display_name: Option<String>,
    pub value: PropertyValue,
    pub formatted_value: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopItemDetails {
    pub item_id: String,
    pub properties: Vec<PropertyRecord>,
}

pub(crate) struct NativeSnapshot {
    pub foreground_window: Option<ForegroundWindowCandidate>,
    pub desktop_shell_active: bool,
    pub desktop_items: Vec<DesktopItemSummary>,
}

pub(crate) trait DesktopBackend {
    fn observe(&mut self) -> Result<NativeSnapshot, ()>;
    fn details(&mut self, item_id: &str) -> Option<DesktopItemDetails>;
}

pub(crate) struct ObserverCore<B> {
    backend: B,
    sequence: u64,
}

impl<B: DesktopBackend> ObserverCore<B> {
    pub(crate) fn new(backend: B) -> Self {
        Self {
            backend,
            sequence: 0,
        }
    }

    pub(crate) fn observe(&mut self) -> DesktopEnvironmentObservation {
        self.sequence = if self.sequence >= MAX_SEQUENCE {
            1
        } else {
            self.sequence + 1
        };
        match self.backend.observe() {
            Ok(snapshot) => DesktopEnvironmentObservation {
                available: true,
                sequence: self.sequence,
                foreground_window: snapshot.foreground_window,
                desktop_shell_active: snapshot.desktop_shell_active,
                desktop_items: snapshot.desktop_items,
            },
            Err(()) => DesktopEnvironmentObservation::unavailable(self.sequence),
        }
    }

    pub(crate) fn details(&mut self, item_id: &str) -> Option<DesktopItemDetails> {
        self.backend.details(item_id)
    }
}

#[cfg(not(target_os = "windows"))]
#[derive(Default)]
pub struct DesktopObserver {
    sequence: std::sync::atomic::AtomicU64,
}

#[cfg(not(target_os = "windows"))]
impl DesktopObserver {
    async fn environment(&self) -> DesktopEnvironmentObservation {
        let sequence = self
            .sequence
            .fetch_update(
                std::sync::atomic::Ordering::Relaxed,
                std::sync::atomic::Ordering::Relaxed,
                |value| Some(if value >= MAX_SEQUENCE { 1 } else { value + 1 }),
            )
            .map(|value| if value >= MAX_SEQUENCE { 1 } else { value + 1 })
            .unwrap_or(1);
        DesktopEnvironmentObservation::unavailable(sequence)
    }

    async fn item_details(&self, _item_id: String) -> Option<DesktopItemDetails> {
        None
    }
}

#[tauri::command]
pub async fn get_desktop_environment(
    observer: State<'_, DesktopObserver>,
) -> Result<DesktopEnvironmentObservation, String> {
    Ok(observer.environment().await)
}

#[tauri::command]
pub async fn get_desktop_item_details(
    item_id: String,
    observer: State<'_, DesktopObserver>,
) -> Result<Option<DesktopItemDetails>, String> {
    if item_id.is_empty() || item_id.len() > 128 {
        return Ok(None);
    }
    Ok(observer.item_details(item_id).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct FakeBackend {
        fail: bool,
        items: Vec<DesktopItemSummary>,
        details: HashMap<String, DesktopItemDetails>,
    }

    impl DesktopBackend for FakeBackend {
        fn observe(&mut self) -> Result<NativeSnapshot, ()> {
            if self.fail {
                return Err(());
            }
            Ok(NativeSnapshot {
                foreground_window: None,
                desktop_shell_active: true,
                desktop_items: self.items.clone(),
            })
        }

        fn details(&mut self, item_id: &str) -> Option<DesktopItemDetails> {
            self.details.get(item_id).cloned()
        }
    }

    fn item(id: &str) -> DesktopItemSummary {
        DesktopItemSummary {
            id: id.to_owned(),
            display_name: "fixture".to_owned(),
            editing_name: "fixture".to_owned(),
            position: PhysicalPoint::default(),
            bounds: PhysicalRectangle {
                width: 64.0,
                height: 80.0,
                ..PhysicalRectangle::default()
            },
            selected: false,
            focused: false,
            source_order: 0,
            shell_kinds: vec!["item".to_owned()],
            file_system_path: None,
            parsing_path: "shell:fixture".to_owned(),
            shortcut: None,
            attributes: DesktopItemAttributes::default(),
        }
    }

    #[test]
    fn observations_have_increasing_sequences_and_do_not_retain_stale_data() {
        let mut core = ObserverCore::new(FakeBackend {
            fail: false,
            items: vec![item("one")],
            details: HashMap::new(),
        });

        let first = core.observe();
        assert!(first.available);
        assert_eq!(first.sequence, 1);
        assert_eq!(first.desktop_items.len(), 1);

        core.backend.fail = true;
        let unavailable = core.observe();
        assert!(!unavailable.available);
        assert_eq!(unavailable.sequence, 2);
        assert!(unavailable.desktop_items.is_empty());
    }

    #[test]
    fn details_resolve_only_from_the_backend_current_map() {
        let detail = DesktopItemDetails {
            item_id: "current".to_owned(),
            properties: Vec::new(),
        };
        let mut core = ObserverCore::new(FakeBackend {
            fail: false,
            items: Vec::new(),
            details: HashMap::from([("current".to_owned(), detail.clone())]),
        });

        assert_eq!(core.details("current"), Some(detail));
        assert_eq!(core.details("expired"), None);
    }

    #[test]
    fn backend_snapshots_preserve_desktop_item_contract_fields() {
        let mut fixture = item("opaque");
        fixture.source_order = 7;
        fixture.selected = true;
        fixture.focused = true;
        fixture.attributes.shortcut = true;
        fixture.shortcut = Some(ShortcutSummary {
            target: Some("opaque target".to_owned()),
            arguments: Some("--fixture".to_owned()),
            ..ShortcutSummary::default()
        });
        let mut core = ObserverCore::new(FakeBackend {
            fail: false,
            items: vec![fixture.clone()],
            details: HashMap::new(),
        });

        let observed = core.observe();
        assert_eq!(observed.desktop_items, vec![fixture]);
        assert_eq!(observed.desktop_items[0].source_order, 7);
        assert!(observed.desktop_items[0].selected);
        assert!(observed.desktop_items[0].focused);
        assert!(observed.desktop_items[0].file_system_path.is_none());
    }
}
