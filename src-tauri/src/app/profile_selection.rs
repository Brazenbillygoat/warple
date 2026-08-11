use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Deserialize;

const RECORD_NAME: &str = "selected-profile-id";
const MAX_RECORD_BYTES: usize = 256;
const MAX_CATALOG_SIZE: usize = 64;
const MAX_ID_LENGTH: usize = 64;
const MAX_DISPLAY_NAME_LENGTH: usize = 80;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCatalogEntry {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Clone)]
pub struct TraySelection {
    pub catalog: Vec<ProfileCatalogEntry>,
    pub checked_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectionOutcome {
    SameSelection,
    Changed,
    UnknownItem,
    PersistenceFailure,
}

#[derive(Default)]
struct SelectionInner {
    record_existed: bool,
    record_path: Option<PathBuf>,
    selected_id: Option<String>,
    active_id: Option<String>,
    catalog: Vec<ProfileCatalogEntry>,
    selection_pending: bool,
}

pub struct ProfileSelection {
    inner: Mutex<SelectionInner>,
}

impl Default for ProfileSelection {
    fn default() -> Self {
        Self {
            inner: Mutex::new(SelectionInner::default()),
        }
    }
}

fn is_kebab_case(value: &str) -> bool {
    let chars: Vec<char> = value.chars().collect();
    if chars.is_empty() {
        return false;
    }
    let mut prev_was_hyphen = false;
    for (i, &c) in chars.iter().enumerate() {
        if c == '-' {
            if i == 0 || prev_was_hyphen {
                return false;
            }
            prev_was_hyphen = true;
        } else if c.is_ascii_lowercase() || c.is_ascii_digit() {
            prev_was_hyphen = false;
        } else {
            return false;
        }
    }
    !prev_was_hyphen
}

fn is_valid_profile_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_ID_LENGTH && is_kebab_case(value)
}

fn load_record(path: &Path) -> (bool, Option<String>) {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(reason) if reason.kind() == std::io::ErrorKind::NotFound => return (false, None),
        Err(_) => return (true, None),
    };
    let mut bytes = Vec::with_capacity(MAX_RECORD_BYTES + 1);
    if file
        .take((MAX_RECORD_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .is_err()
    {
        return (true, None);
    }
    if bytes.len() > MAX_RECORD_BYTES {
        return (true, None);
    }
    let text = match std::str::from_utf8(&bytes) {
        Ok(s) => s.trim(),
        Err(_) => return (true, None),
    };
    if !is_valid_profile_id(text) {
        return (true, None);
    }
    (true, Some(text.to_string()))
}

fn write_record(path: &Path, id: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "selection record has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "failed to access selection directory".to_string())?;
    fs::write(path, id).map_err(|_| "failed to write selection record".to_string())
}

fn validate_catalog(
    entries: &[ProfileCatalogEntry],
    active_id: &str,
) -> Result<Vec<ProfileCatalogEntry>, String> {
    if entries.is_empty() || entries.len() > MAX_CATALOG_SIZE {
        return Err("catalog must contain 1 to 64 entries".to_string());
    }
    let mut seen_ids = std::collections::HashSet::new();
    for entry in entries {
        if !is_valid_profile_id(&entry.id) {
            return Err("catalog entry has an invalid profile id".to_string());
        }
        if !seen_ids.insert(entry.id.as_str()) {
            return Err("catalog contains duplicate profile ids".to_string());
        }
        let name = entry.display_name.trim();
        if name.is_empty()
            || name != entry.display_name
            || entry.display_name.chars().count() > MAX_DISPLAY_NAME_LENGTH
        {
            return Err("catalog entry has an invalid display name".to_string());
        }
    }
    if !seen_ids.contains(active_id) {
        return Err("active profile id is not in the catalog".to_string());
    }
    Ok(entries.to_vec())
}

impl ProfileSelection {
    pub fn init(&self, config_dir: Option<PathBuf>) {
        let record_path = config_dir.map(|dir| dir.join(RECORD_NAME));
        let (record_existed, selected_id) = match &record_path {
            Some(path) => load_record(path),
            None => (false, None),
        };
        if let Ok(mut inner) = self.inner.lock() {
            inner.record_existed = record_existed;
            inner.record_path = record_path;
            inner.selected_id = selected_id;
        }
    }

    pub fn startup_candidate(&self) -> Option<String> {
        self.inner
            .lock()
            .ok()
            .and_then(|inner| inner.selected_id.clone())
    }

    pub fn accept_ready_catalog(
        &self,
        entries: &[ProfileCatalogEntry],
        active_id: &str,
    ) -> Result<Option<TraySelection>, String> {
        let catalog = validate_catalog(entries, active_id)?;
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "selection state is unavailable".to_string())?;

        if inner.selection_pending && inner.selected_id.as_deref() != Some(active_id) {
            inner.catalog = catalog;
            return Ok(None);
        }

        let needs_heal = inner.record_existed && inner.selected_id.as_deref() != Some(active_id);

        inner.active_id = Some(active_id.to_string());
        inner.catalog = catalog.clone();
        inner.selected_id = Some(active_id.to_string());
        inner.selection_pending = false;

        if needs_heal {
            if let Some(path) = inner.record_path.clone() {
                let _ = write_record(&path, active_id);
            }
        }

        Ok(Some(TraySelection {
            catalog,
            checked_id: active_id.to_string(),
        }))
    }

    pub fn select(&self, profile_id: &str) -> SelectionOutcome {
        let mut inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(_) => return SelectionOutcome::PersistenceFailure,
        };

        if !inner.catalog.iter().any(|entry| entry.id == profile_id) {
            return SelectionOutcome::UnknownItem;
        }

        if inner.selected_id.as_deref() == Some(profile_id) {
            return SelectionOutcome::SameSelection;
        }

        if let Some(path) = inner.record_path.clone() {
            if write_record(&path, profile_id).is_err() {
                return SelectionOutcome::PersistenceFailure;
            }
        } else {
            return SelectionOutcome::PersistenceFailure;
        }

        inner.selected_id = Some(profile_id.to_string());
        inner.record_existed = true;
        inner.selection_pending = true;
        SelectionOutcome::Changed
    }

    pub fn tray_state(&self) -> Option<TraySelection> {
        let inner = self.inner.lock().ok()?;
        if inner.catalog.is_empty() {
            return None;
        }
        let checked_id = inner
            .selected_id
            .clone()
            .or_else(|| inner.active_id.clone())
            .unwrap_or_default();
        Some(TraySelection {
            catalog: inner.catalog.clone(),
            checked_id,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_config_dir() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("warple-test-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn temp_record_path() -> PathBuf {
        temp_config_dir().join(RECORD_NAME)
    }

    fn cleanup(path: &Path) {
        let _ = fs::remove_file(path);
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir(parent);
        }
    }

    fn cleanup_dir(path: &Path) {
        let _ = fs::remove_dir_all(path);
    }

    fn blooky_entry() -> ProfileCatalogEntry {
        ProfileCatalogEntry {
            id: "blooky".to_string(),
            display_name: "Blooky".to_string(),
        }
    }

    fn jo_entry() -> ProfileCatalogEntry {
        ProfileCatalogEntry {
            id: "jo".to_string(),
            display_name: "Jo".to_string(),
        }
    }

    fn blooky_catalog() -> Vec<ProfileCatalogEntry> {
        vec![blooky_entry()]
    }

    fn multi_catalog() -> Vec<ProfileCatalogEntry> {
        vec![blooky_entry(), jo_entry()]
    }

    #[test]
    fn kebab_case_validator_matches_profile_id_rules() {
        assert!(is_valid_profile_id("blooky"));
        assert!(is_valid_profile_id("jo"));
        assert!(is_valid_profile_id("a"));
        assert!(is_valid_profile_id("alpha-numeric-1"));
        assert!(!is_valid_profile_id(""));
        assert!(!is_valid_profile_id("Blooky"));
        assert!(!is_valid_profile_id("blooky "));
        assert!(!is_valid_profile_id("-blooky"));
        assert!(!is_valid_profile_id("blooky-"));
        assert!(!is_valid_profile_id("blooky--double"));
        assert!(!is_valid_profile_id("blooky_underscore"));
        assert!(!is_valid_profile_id("blooky!"));
    }

    #[test]
    fn missing_record_loads_no_candidate() {
        let path = temp_record_path();
        let (existed, candidate) = load_record(&path);
        assert!(!existed);
        assert!(candidate.is_none());
        cleanup(&path);
    }

    #[test]
    fn valid_record_round_trips() {
        let path = temp_record_path();
        write_record(&path, "blooky").unwrap();

        let (existed, candidate) = load_record(&path);
        assert!(existed);
        assert_eq!(candidate.as_deref(), Some("blooky"));

        cleanup(&path);
    }

    #[test]
    fn oversized_record_is_malformed() {
        let path = temp_record_path();
        let oversized = "a".repeat(MAX_RECORD_BYTES + 1);
        fs::write(&path, &oversized).unwrap();

        let (existed, candidate) = load_record(&path);
        assert!(existed);
        assert!(candidate.is_none());

        cleanup(&path);
    }

    #[test]
    fn non_kebab_record_is_malformed() {
        let path = temp_record_path();
        fs::write(&path, "Not Kebab").unwrap();

        let (existed, candidate) = load_record(&path);
        assert!(existed);
        assert!(candidate.is_none());

        cleanup(&path);
    }

    #[test]
    fn empty_record_is_malformed() {
        let path = temp_record_path();
        fs::write(&path, "").unwrap();

        let (existed, candidate) = load_record(&path);
        assert!(existed);
        assert!(candidate.is_none());

        cleanup(&path);
    }

    #[test]
    fn init_loads_candidate_from_config_dir() {
        let config_dir = temp_config_dir();
        let record_path = config_dir.join(RECORD_NAME);
        fs::write(&record_path, "blooky").unwrap();

        let selection = ProfileSelection::default();
        selection.init(Some(config_dir.clone()));
        assert_eq!(selection.startup_candidate().as_deref(), Some("blooky"));

        cleanup(&record_path);
        cleanup_dir(&config_dir);
    }

    #[test]
    fn init_without_config_dir_has_no_candidate() {
        let selection = ProfileSelection::default();
        selection.init(None);
        assert!(selection.startup_candidate().is_none());
    }

    #[test]
    fn accept_ready_catalog_returns_validated_tray_selection() {
        let selection = ProfileSelection::default();
        let tray = selection
            .accept_ready_catalog(&blooky_catalog(), "blooky")
            .unwrap()
            .unwrap();

        assert_eq!(tray.checked_id, "blooky");
        assert_eq!(tray.catalog.len(), 1);
        assert_eq!(tray.catalog[0].id, "blooky");
    }

    #[test]
    fn accept_ready_catalog_with_multi_profile_preserves_order() {
        let selection = ProfileSelection::default();
        let tray = selection
            .accept_ready_catalog(&multi_catalog(), "jo")
            .unwrap()
            .unwrap();

        assert_eq!(tray.catalog.len(), 2);
        assert_eq!(tray.catalog[0].id, "blooky");
        assert_eq!(tray.catalog[1].id, "jo");
        assert_eq!(tray.checked_id, "jo");
    }

    #[test]
    fn accept_ready_catalog_rejects_empty_catalog() {
        let selection = ProfileSelection::default();
        assert!(selection.accept_ready_catalog(&[], "blooky").is_err());
    }

    #[test]
    fn accept_ready_catalog_rejects_oversized_catalog() {
        let selection = ProfileSelection::default();
        let entries: Vec<ProfileCatalogEntry> = (0..MAX_CATALOG_SIZE + 1)
            .map(|i| ProfileCatalogEntry {
                id: format!("p{i}"),
                display_name: format!("P{i}"),
            })
            .collect();
        assert!(selection.accept_ready_catalog(&entries, "p0").is_err());
    }

    #[test]
    fn accept_ready_catalog_rejects_duplicate_ids() {
        let selection = ProfileSelection::default();
        let entries = vec![
            blooky_entry(),
            ProfileCatalogEntry {
                id: "blooky".to_string(),
                display_name: "Other".to_string(),
            },
        ];
        assert!(selection.accept_ready_catalog(&entries, "blooky").is_err());
    }

    #[test]
    fn accept_ready_catalog_rejects_malformed_id() {
        let selection = ProfileSelection::default();
        let entries = vec![ProfileCatalogEntry {
            id: "Not Kebab".to_string(),
            display_name: "Bad".to_string(),
        }];
        assert!(selection
            .accept_ready_catalog(&entries, "Not Kebab")
            .is_err());
    }

    #[test]
    fn accept_ready_catalog_rejects_empty_display_name() {
        let selection = ProfileSelection::default();
        let entries = vec![ProfileCatalogEntry {
            id: "blooky".to_string(),
            display_name: "  ".to_string(),
        }];
        assert!(selection.accept_ready_catalog(&entries, "blooky").is_err());
    }

    #[test]
    fn accept_ready_catalog_rejects_untrimmed_display_name() {
        let selection = ProfileSelection::default();
        let entries = vec![ProfileCatalogEntry {
            id: "blooky".to_string(),
            display_name: " Blooky ".to_string(),
        }];
        assert!(selection.accept_ready_catalog(&entries, "blooky").is_err());
    }

    #[test]
    fn accept_ready_catalog_counts_unicode_display_name_characters() {
        let selection = ProfileSelection::default();
        let entries = vec![ProfileCatalogEntry {
            id: "blooky".to_string(),
            display_name: "é".repeat(MAX_DISPLAY_NAME_LENGTH),
        }];
        assert!(selection
            .accept_ready_catalog(&entries, "blooky")
            .unwrap()
            .is_some());

        let oversized = vec![ProfileCatalogEntry {
            id: "blooky".to_string(),
            display_name: "é".repeat(MAX_DISPLAY_NAME_LENGTH + 1),
        }];
        assert!(selection
            .accept_ready_catalog(&oversized, "blooky")
            .is_err());
    }

    #[test]
    fn accept_ready_catalog_rejects_active_id_not_in_catalog() {
        let selection = ProfileSelection::default();
        assert!(selection
            .accept_ready_catalog(&blooky_catalog(), "jo")
            .is_err());
    }

    #[test]
    fn first_launch_does_not_write_default_record() {
        let config_dir = temp_config_dir();
        let record_path = config_dir.join(RECORD_NAME);
        let selection = ProfileSelection::default();
        selection.init(Some(config_dir.clone()));

        selection
            .accept_ready_catalog(&blooky_catalog(), "blooky")
            .unwrap();

        assert!(!record_path.exists());

        cleanup_dir(&config_dir);
    }

    #[test]
    fn stale_record_self_heals_after_readiness() {
        let config_dir = temp_config_dir();
        let record_path = config_dir.join(RECORD_NAME);
        fs::write(&record_path, "ghost").unwrap();

        let selection = ProfileSelection::default();
        selection.init(Some(config_dir.clone()));

        assert_eq!(selection.startup_candidate().as_deref(), Some("ghost"));

        selection
            .accept_ready_catalog(&blooky_catalog(), "blooky")
            .unwrap();

        let (_, candidate) = load_record(&record_path);
        assert_eq!(candidate.as_deref(), Some("blooky"));

        cleanup(&record_path);
        cleanup_dir(&config_dir);
    }

    #[test]
    fn valid_record_does_not_rewrite_after_readiness() {
        let config_dir = temp_config_dir();
        let record_path = config_dir.join(RECORD_NAME);
        fs::write(&record_path, "blooky").unwrap();
        let original_mtime = fs::metadata(&record_path).unwrap().modified().unwrap();

        let selection = ProfileSelection::default();
        selection.init(Some(config_dir.clone()));

        selection
            .accept_ready_catalog(&blooky_catalog(), "blooky")
            .unwrap();

        let current_mtime = fs::metadata(&record_path).unwrap().modified().unwrap();
        assert_eq!(original_mtime, current_mtime);

        cleanup(&record_path);
        cleanup_dir(&config_dir);
    }

    #[test]
    fn select_same_profile_is_noop() {
        let config_dir = temp_config_dir();
        let record_path = config_dir.join(RECORD_NAME);
        let selection = ProfileSelection::default();
        selection.init(Some(config_dir.clone()));
        selection
            .accept_ready_catalog(&multi_catalog(), "blooky")
            .unwrap();

        assert_eq!(selection.select("blooky"), SelectionOutcome::SameSelection);
        assert!(!record_path.exists());

        cleanup_dir(&config_dir);
    }

    #[test]
    fn select_different_profile_persists_and_changes() {
        let config_dir = temp_config_dir();
        let record_path = config_dir.join(RECORD_NAME);
        let selection = ProfileSelection::default();
        selection.init(Some(config_dir.clone()));
        selection
            .accept_ready_catalog(&multi_catalog(), "blooky")
            .unwrap();

        assert_eq!(selection.select("jo"), SelectionOutcome::Changed);

        let (_, candidate) = load_record(&record_path);
        assert_eq!(candidate.as_deref(), Some("jo"));
        assert_eq!(selection.tray_state().unwrap().checked_id, "jo");

        cleanup(&record_path);
        cleanup_dir(&config_dir);
    }

    #[test]
    fn newer_selection_supersedes_an_older_ready_profile() {
        let config_dir = temp_config_dir();
        let record_path = config_dir.join(RECORD_NAME);
        let selection = ProfileSelection::default();
        selection.init(Some(config_dir.clone()));
        selection
            .accept_ready_catalog(&multi_catalog(), "blooky")
            .unwrap();

        assert_eq!(selection.select("jo"), SelectionOutcome::Changed);
        assert!(selection
            .accept_ready_catalog(&multi_catalog(), "blooky")
            .unwrap()
            .is_none());
        assert_eq!(selection.startup_candidate().as_deref(), Some("jo"));
        assert_eq!(selection.tray_state().unwrap().checked_id, "jo");
        let (_, candidate) = load_record(&record_path);
        assert_eq!(candidate.as_deref(), Some("jo"));

        cleanup(&record_path);
        cleanup_dir(&config_dir);
    }

    #[test]
    fn matching_ready_profile_completes_a_pending_selection() {
        let config_dir = temp_config_dir();
        let record_path = config_dir.join(RECORD_NAME);
        let selection = ProfileSelection::default();
        selection.init(Some(config_dir.clone()));
        selection
            .accept_ready_catalog(&multi_catalog(), "blooky")
            .unwrap();

        assert_eq!(selection.select("jo"), SelectionOutcome::Changed);
        let tray = selection
            .accept_ready_catalog(&multi_catalog(), "jo")
            .unwrap()
            .unwrap();
        assert_eq!(tray.checked_id, "jo");

        cleanup(&record_path);
        cleanup_dir(&config_dir);
    }

    #[test]
    fn select_unknown_profile_returns_unknown() {
        let config_dir = temp_config_dir();
        let record_path = config_dir.join(RECORD_NAME);
        let selection = ProfileSelection::default();
        selection.init(Some(config_dir.clone()));
        selection
            .accept_ready_catalog(&multi_catalog(), "blooky")
            .unwrap();

        assert_eq!(selection.select("ghost"), SelectionOutcome::UnknownItem);
        assert_eq!(selection.tray_state().unwrap().checked_id, "blooky");
        assert!(!record_path.exists());

        cleanup_dir(&config_dir);
    }

    #[test]
    fn select_without_config_dir_fails_persistence() {
        let selection = ProfileSelection::default();
        selection.init(None);
        selection
            .accept_ready_catalog(&multi_catalog(), "blooky")
            .unwrap();

        assert_eq!(selection.select("jo"), SelectionOutcome::PersistenceFailure);
        assert_eq!(selection.tray_state().unwrap().checked_id, "blooky");
    }

    #[test]
    fn select_round_trips_across_reinit() {
        let config_dir = temp_config_dir();
        let record_path = config_dir.join(RECORD_NAME);

        let selection = ProfileSelection::default();
        selection.init(Some(config_dir.clone()));
        selection
            .accept_ready_catalog(&multi_catalog(), "blooky")
            .unwrap();
        assert_eq!(selection.select("jo"), SelectionOutcome::Changed);

        let reloaded = ProfileSelection::default();
        reloaded.init(Some(config_dir.clone()));
        assert_eq!(reloaded.startup_candidate().as_deref(), Some("jo"));

        cleanup(&record_path);
        cleanup_dir(&config_dir);
    }
}
