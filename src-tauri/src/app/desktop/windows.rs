use super::{
    DesktopBackend, DesktopEnvironmentObservation, DesktopItemAttributes, DesktopItemDetails,
    DesktopItemSummary, ForegroundWindowCandidate, NativeSnapshot, ObserverCore, PhysicalPoint,
    PhysicalRectangle, PropertyRecord, PropertyValue, ShortcutSummary,
};
use log::error;
use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    ffi::c_void,
    hash::{Hash, Hasher},
    os::windows::ffi::OsStrExt,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender, TrySendError},
        Arc,
    },
    thread,
    time::Duration,
};
use windows::{
    core::{Interface, PCWSTR, PWSTR},
    Win32::{
        Foundation::{HWND, POINT, PROPERTYKEY, RECT},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
            Gdi::{
                ClientToScreen, GetMonitorInfoW, MonitorFromPoint, MONITORINFO,
                MONITOR_DEFAULTTOPRIMARY,
            },
        },
        System::{
            Com::StructuredStorage::{
                PropVariantClear, PropVariantGetBooleanElem, PropVariantGetDoubleElem,
                PropVariantGetElementCount, PropVariantGetFileTimeElem, PropVariantGetInt16Elem,
                PropVariantGetInt32Elem, PropVariantGetInt64Elem, PropVariantGetStringElem,
                PropVariantGetUInt16Elem, PropVariantGetUInt32Elem, PropVariantGetUInt64Elem,
                PropVariantToBoolean, PropVariantToDouble, PropVariantToFileTime,
                PropVariantToGUID, PropVariantToInt16, PropVariantToInt32, PropVariantToInt64,
                PropVariantToStringAlloc, PropVariantToUInt16, PropVariantToUInt32,
                PropVariantToUInt64, PROPVARIANT,
            },
            Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile,
                IServiceProvider, CLSCTX_ALL, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
                STGM_READ,
            },
            SystemServices::{
                SFGAO_CANCOPY, SFGAO_CANLINK, SFGAO_CANMOVE, SFGAO_FILESYSTEM, SFGAO_FOLDER,
                SFGAO_HIDDEN, SFGAO_LINK, SFGAO_READONLY, SFGAO_SHARE,
            },
            Variant::{
                PSTF_LOCAL, VT_BOOL, VT_BSTR, VT_CLSID, VT_FILETIME, VT_I1, VT_I2, VT_I4, VT_I8,
                VT_LPSTR, VT_LPWSTR, VT_R4, VT_R8, VT_TYPEMASK, VT_UI1, VT_UI2, VT_UI4, VT_UI8,
                VT_VECTOR,
            },
        },
        UI::{
            Shell::{
                IFolderView2, IShellBrowser, IShellFolder, IShellItem2, IShellLinkW, IShellWindows,
                PropertiesSystem::{IPropertyStore, PSGetNameFromPropertyKey, GPS_DEFAULT},
                SHCreateItemWithParent, SID_STopLevelBrowser, ShellLink, ShellWindows, SIGDN,
                SIGDN_DESKTOPABSOLUTEPARSING, SIGDN_FILESYSPATH, SIGDN_NORMALDISPLAY,
                SIGDN_PARENTRELATIVEEDITING, SLGP_RAWPATH, SVGIO_ALLVIEW, SVSI_FOCUSED,
                SVSI_SELECT, SWC_DESKTOP, SWFO_NEEDDISPATCH,
            },
            WindowsAndMessaging::{
                GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId, IsIconic, IsWindow,
                IsWindowVisible, IsZoomed,
            },
        },
    },
};

const REQUEST_CAPACITY: usize = 4;
const ENVIRONMENT_TIMEOUT: Duration = Duration::from_secs(2);
const DETAILS_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_DESKTOP_ITEMS: i32 = 2048;
const MAX_PROPERTIES: u32 = 512;
const MAX_PROPERTY_ELEMENTS: u32 = 256;
const DEFAULT_ICON_SIZE: i32 = 48;

const PKEY_KIND: PROPERTYKEY = PROPERTYKEY {
    fmtid: windows::core::GUID::from_u128(0x1e3ee840_bc2b_476c_8237_2acd1a839b22),
    pid: 3,
};

enum Request {
    Observe(mpsc::Sender<DesktopEnvironmentObservation>),
    Details(String, mpsc::Sender<Option<DesktopItemDetails>>),
}

pub struct DesktopObserver {
    sender: SyncSender<Request>,
    fallback_sequence: Arc<AtomicU64>,
}

impl Default for DesktopObserver {
    fn default() -> Self {
        let (sender, receiver) = mpsc::sync_channel(REQUEST_CAPACITY);
        if thread::Builder::new()
            .name("warple-desktop-observer".to_owned())
            .spawn(move || observer_thread(receiver))
            .is_err()
        {
            error!("Failed to start the desktop observer thread");
        }
        Self {
            sender,
            fallback_sequence: Arc::new(AtomicU64::new(0)),
        }
    }
}

impl DesktopObserver {
    pub(super) async fn environment(&self) -> DesktopEnvironmentObservation {
        let sender = self.sender.clone();
        let fallback_sequence = Arc::clone(&self.fallback_sequence);
        tauri::async_runtime::spawn_blocking(move || {
            let (reply, response) = mpsc::channel();
            if sender.try_send(Request::Observe(reply)).is_err() {
                return unavailable_fallback(&fallback_sequence);
            }
            response
                .recv_timeout(ENVIRONMENT_TIMEOUT)
                .unwrap_or_else(|_| unavailable_fallback(&fallback_sequence))
        })
        .await
        .unwrap_or_else(|_| unavailable_fallback(&self.fallback_sequence))
    }

    pub(super) async fn item_details(&self, item_id: String) -> Option<DesktopItemDetails> {
        let sender = self.sender.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let (reply, response) = mpsc::channel();
            match sender.try_send(Request::Details(item_id, reply)) {
                Ok(()) => response.recv_timeout(DETAILS_TIMEOUT).ok().flatten(),
                Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => None,
            }
        })
        .await
        .ok()
        .flatten()
    }
}

fn unavailable_fallback(sequence: &AtomicU64) -> DesktopEnvironmentObservation {
    let current = sequence.fetch_add(1, Ordering::Relaxed).saturating_add(1);
    DesktopEnvironmentObservation {
        available: false,
        sequence: current,
        foreground_window: None,
        desktop_shell_active: false,
        desktop_items: Vec::new(),
    }
}

fn observer_thread(receiver: Receiver<Request>) {
    let initialized =
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).is_ok() };
    if !initialized {
        error!("Failed to initialize the desktop observation COM apartment");
        return;
    }

    let mut core = ObserverCore::new(WindowsBackend::default());
    while let Ok(request) = receiver.recv() {
        match request {
            Request::Observe(reply) => {
                let _ = reply.send(core.observe());
            }
            Request::Details(item_id, reply) => {
                let _ = reply.send(core.details(&item_id));
            }
        }
    }

    unsafe { CoUninitialize() };
}

#[derive(Default)]
struct WindowsBackend {
    items: HashMap<String, IShellItem2>,
    details_cache: HashMap<String, DesktopItemDetails>,
}

impl DesktopBackend for WindowsBackend {
    fn observe(&mut self) -> Result<NativeSnapshot, ()> {
        let foreground = unsafe { GetForegroundWindow() };
        let window = observe_foreground_window(foreground);
        let desktop_shell_active = foreground_is_desktop_shell(foreground);
        let desktop_items = if desktop_shell_active {
            self.observe_desktop_items().unwrap_or_default()
        } else {
            self.items.clear();
            self.details_cache.clear();
            Vec::new()
        };

        Ok(NativeSnapshot {
            foreground_window: window,
            desktop_shell_active,
            desktop_items,
        })
    }

    fn details(&mut self, item_id: &str) -> Option<DesktopItemDetails> {
        if let Some(cached) = self.details_cache.get(item_id) {
            return Some(cached.clone());
        }
        let item = self.items.get(item_id)?.clone();
        let properties = unsafe { enumerate_properties(&item) };
        let details = DesktopItemDetails {
            item_id: item_id.to_owned(),
            properties,
        };
        self.details_cache
            .insert(item_id.to_owned(), details.clone());
        Some(details)
    }
}

impl WindowsBackend {
    fn observe_desktop_items(&mut self) -> windows::core::Result<Vec<DesktopItemSummary>> {
        let (view, view_window) = unsafe { desktop_folder_view()? };
        let folder: IShellFolder = unsafe { view.GetFolder()? };
        let count = unsafe { view.ItemCount(SVGIO_ALLVIEW)? }.clamp(0, MAX_DESKTOP_ITEMS);
        let icon_size = unsafe {
            let mut mode = Default::default();
            let mut size = DEFAULT_ICON_SIZE;
            let _ = view.GetViewModeAndIconSize(&mut mode, &mut size);
            size.clamp(16, 512)
        };

        let mut current_items = HashMap::new();
        let mut summaries = Vec::new();
        for index in 0..count {
            if let Some((summary, item)) =
                unsafe { desktop_item_summary(&view, &folder, view_window, index, icon_size) }
            {
                current_items.insert(summary.id.clone(), item);
                summaries.push(summary);
            }
        }

        self.details_cache
            .retain(|item_id, _| current_items.contains_key(item_id));
        self.items = current_items;
        Ok(summaries)
    }
}

unsafe fn desktop_folder_view() -> windows::core::Result<(IFolderView2, HWND)> {
    let shell_windows: IShellWindows =
        unsafe { CoCreateInstance(&ShellWindows, None, CLSCTX_ALL)? };
    let empty = windows::Win32::System::Variant::VARIANT::default();
    let mut shell_window = 0i32;
    let dispatch = unsafe {
        shell_windows.FindWindowSW(
            &empty,
            &empty,
            SWC_DESKTOP,
            &mut shell_window,
            SWFO_NEEDDISPATCH,
        )?
    };
    let services: IServiceProvider = dispatch.cast()?;
    let browser: IShellBrowser = unsafe { services.QueryService(&SID_STopLevelBrowser)? };
    let shell_view = unsafe { browser.QueryActiveShellView()? };
    let view_window = unsafe { shell_view.GetWindow()? };
    Ok((shell_view.cast()?, view_window))
}

unsafe fn desktop_item_summary(
    view: &IFolderView2,
    folder: &IShellFolder,
    view_window: HWND,
    index: i32,
    icon_size: i32,
) -> Option<(DesktopItemSummary, IShellItem2)> {
    let pidl = unsafe { view.Item(index).ok()? };
    if pidl.is_null() {
        return None;
    }

    let result = (|| {
        let item: IShellItem2 = unsafe { SHCreateItemWithParent(None, folder, pidl).ok()? };
        let display_name = unsafe { shell_item_name(&item, SIGDN_NORMALDISPLAY)? };
        let editing_name = unsafe { shell_item_name(&item, SIGDN_PARENTRELATIVEEDITING) }
            .unwrap_or_else(|| display_name.clone());
        let parsing_path = unsafe { shell_item_name(&item, SIGDN_DESKTOPABSOLUTEPARSING)? };
        let file_system_path = unsafe { shell_item_name(&item, SIGDN_FILESYSPATH) };
        let mut position = unsafe { view.GetItemPosition(pidl).ok()? };
        if !unsafe { ClientToScreen(view_window, &mut position) }.as_bool() {
            return None;
        }
        let selection_state = unsafe { view.GetSelectionState(pidl) }.unwrap_or_default();
        let attributes = unsafe { item_attributes(&item) };
        let shortcut = if attributes.shortcut {
            file_system_path
                .as_deref()
                .and_then(|path| unsafe { read_shortcut(path) })
        } else {
            None
        };
        let shell_kinds = unsafe { shell_kinds(&item) };
        let id = opaque_id("desktop-item", &parsing_path);
        let width = (icon_size + 32).clamp(48, 544);
        let height = (icon_size + 44).clamp(60, 556);

        Some((
            DesktopItemSummary {
                id,
                display_name,
                editing_name,
                position: PhysicalPoint {
                    x: f64::from(position.x),
                    y: f64::from(position.y),
                },
                bounds: PhysicalRectangle {
                    x: f64::from(position.x),
                    y: f64::from(position.y),
                    width: f64::from(width),
                    height: f64::from(height),
                },
                selected: selection_state & (SVSI_SELECT.0 as u32) != 0,
                focused: selection_state & (SVSI_FOCUSED.0 as u32) != 0,
                source_order: index as u32,
                shell_kinds,
                file_system_path,
                parsing_path,
                shortcut,
                attributes,
            },
            item,
        ))
    })();

    unsafe { CoTaskMemFree(Some(pidl.cast())) };
    result
}

unsafe fn shell_item_name(item: &IShellItem2, kind: SIGDN) -> Option<String> {
    let value = unsafe { item.GetDisplayName(kind).ok()? };
    unsafe { take_owned_pwstr(value) }.filter(|value| !value.is_empty())
}

unsafe fn item_attributes(item: &IShellItem2) -> DesktopItemAttributes {
    let mask = SFGAO_FILESYSTEM
        | SFGAO_FOLDER
        | SFGAO_LINK
        | SFGAO_HIDDEN
        | SFGAO_READONLY
        | SFGAO_SHARE
        | SFGAO_CANCOPY
        | SFGAO_CANMOVE
        | SFGAO_CANLINK;
    let value = unsafe { item.GetAttributes(mask) }.unwrap_or_default();
    DesktopItemAttributes {
        file_system: has_attribute(value.0, SFGAO_FILESYSTEM.0),
        folder: has_attribute(value.0, SFGAO_FOLDER.0),
        shortcut: has_attribute(value.0, SFGAO_LINK.0),
        hidden: has_attribute(value.0, SFGAO_HIDDEN.0),
        read_only: has_attribute(value.0, SFGAO_READONLY.0),
        shared: has_attribute(value.0, SFGAO_SHARE.0),
        copyable: has_attribute(value.0, SFGAO_CANCOPY.0),
        movable: has_attribute(value.0, SFGAO_CANMOVE.0),
        linkable: has_attribute(value.0, SFGAO_CANLINK.0),
    }
}

fn has_attribute(value: u32, flag: u32) -> bool {
    value & flag == flag
}

unsafe fn shell_kinds(item: &IShellItem2) -> Vec<String> {
    let Ok(mut value) = (unsafe { item.GetProperty(&PKEY_KIND) }) else {
        return Vec::new();
    };
    let result = match unsafe { property_value(&value) } {
        Some(PropertyValue::Text(value)) => vec![value],
        Some(PropertyValue::Texts(values)) => values,
        _ => Vec::new(),
    };
    let _ = unsafe { PropVariantClear(&mut value) };
    result
}

unsafe fn read_shortcut(path: &str) -> Option<ShortcutSummary> {
    let link: IShellLinkW = unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_ALL).ok()? };
    let persist: IPersistFile = link.cast().ok()?;
    let wide_path = wide_null(path);
    unsafe { persist.Load(PCWSTR(wide_path.as_ptr()), STGM_READ).ok()? };

    let mut target = vec![0u16; 32_768];
    let mut arguments = vec![0u16; 32_768];
    let mut working_directory = vec![0u16; 32_768];
    let mut description = vec![0u16; 4096];
    let mut icon_location = vec![0u16; 32_768];
    let mut icon_index = 0i32;
    let _ = unsafe { link.GetPath(&mut target, std::ptr::null_mut(), SLGP_RAWPATH.0 as u32) };
    let _ = unsafe { link.GetArguments(&mut arguments) };
    let _ = unsafe { link.GetWorkingDirectory(&mut working_directory) };
    let _ = unsafe { link.GetDescription(&mut description) };
    let _ = unsafe { link.GetIconLocation(&mut icon_location, &mut icon_index) };

    let icon_path = wide_buffer_to_string(&icon_location);
    Some(ShortcutSummary {
        target: wide_buffer_to_string(&target),
        arguments: wide_buffer_to_string(&arguments),
        working_directory: wide_buffer_to_string(&working_directory),
        description: wide_buffer_to_string(&description),
        icon_location: icon_path.map(|path| format!("{path},{icon_index}")),
    })
}

unsafe fn enumerate_properties(item: &IShellItem2) -> Vec<PropertyRecord> {
    let Ok(store): windows::core::Result<IPropertyStore> =
        (unsafe { item.GetPropertyStore(GPS_DEFAULT) })
    else {
        return Vec::new();
    };
    let count = unsafe { store.GetCount() }
        .unwrap_or_default()
        .min(MAX_PROPERTIES);
    let mut records = Vec::new();
    for index in 0..count {
        let mut key = PROPERTYKEY::default();
        if unsafe { store.GetAt(index, &mut key) }.is_err() {
            continue;
        }
        let Ok(mut value) = (unsafe { store.GetValue(&key) }) else {
            continue;
        };
        let record = unsafe { property_record(&key, &value) };
        let _ = unsafe { PropVariantClear(&mut value) };
        if let Some(record) = record {
            records.push(record);
        }
    }
    records
}

unsafe fn property_record(key: &PROPERTYKEY, value: &PROPVARIANT) -> Option<PropertyRecord> {
    let canonical_name = unsafe { take_owned_pwstr(PSGetNameFromPropertyKey(key).ok()?)? };
    let property_value = unsafe { property_value(value)? };
    let formatted_value = unsafe { take_owned_pwstr(PropVariantToStringAlloc(value).ok()?) };
    Some(PropertyRecord {
        canonical_name,
        display_name: None,
        value: property_value,
        formatted_value,
    })
}

unsafe fn property_value(value: &PROPVARIANT) -> Option<PropertyValue> {
    let variant_type = unsafe { value.Anonymous.Anonymous.vt.0 };
    let base_type = variant_type & VT_TYPEMASK.0;
    let vector = variant_type & VT_VECTOR.0 != 0;
    if vector {
        let count = unsafe { PropVariantGetElementCount(value) }.min(MAX_PROPERTY_ELEMENTS);
        return unsafe { vector_property_value(value, base_type, count) };
    }

    match base_type {
        kind if kind == VT_BOOL.0 => unsafe { PropVariantToBoolean(value) }
            .ok()
            .map(|value| PropertyValue::Boolean(value.as_bool())),
        kind if matches_signed_integer(kind) => unsafe { scalar_signed(value, kind) },
        kind if matches_unsigned_integer(kind) => unsafe { scalar_unsigned(value, kind) },
        kind if kind == VT_R4.0 || kind == VT_R8.0 => unsafe {
            PropVariantToDouble(value)
                .ok()
                .filter(|value| value.is_finite())
                .map(PropertyValue::Number)
        },
        kind if kind == VT_LPSTR.0 || kind == VT_LPWSTR.0 || kind == VT_BSTR.0 => unsafe {
            take_owned_pwstr(PropVariantToStringAlloc(value).ok()?).map(PropertyValue::Text)
        },
        kind if kind == VT_FILETIME.0 => unsafe {
            PropVariantToFileTime(value, PSTF_LOCAL).ok().map(|time| {
                PropertyValue::Text(filetime_text(time.dwHighDateTime, time.dwLowDateTime))
            })
        },
        kind if kind == VT_CLSID.0 => unsafe {
            PropVariantToGUID(value)
                .ok()
                .map(|value| PropertyValue::Text(format!("{value:?}")))
        },
        _ => None,
    }
}

unsafe fn vector_property_value(
    value: &PROPVARIANT,
    base_type: u16,
    count: u32,
) -> Option<PropertyValue> {
    if count == 0 {
        return None;
    }
    if base_type == VT_BOOL.0 {
        return (0..count)
            .map(|index| unsafe {
                PropVariantGetBooleanElem(value, index)
                    .ok()
                    .map(|v| v.as_bool())
            })
            .collect::<Option<Vec<_>>>()
            .map(PropertyValue::Booleans);
    }
    if matches_signed_integer(base_type) {
        let values = (0..count)
            .map(|index| unsafe { vector_signed(value, base_type, index) })
            .collect::<Option<Vec<_>>>()?;
        if values
            .iter()
            .all(|value| value.unsigned_abs() <= 1u64 << 53)
        {
            return Some(PropertyValue::Numbers(
                values.into_iter().map(|value| value as f64).collect(),
            ));
        }
        return Some(PropertyValue::Texts(
            values.into_iter().map(|value| value.to_string()).collect(),
        ));
    }
    if matches_unsigned_integer(base_type) {
        let values = (0..count)
            .map(|index| unsafe { vector_unsigned(value, base_type, index) })
            .collect::<Option<Vec<_>>>()?;
        if values.iter().all(|value| *value <= 1u64 << 53) {
            return Some(PropertyValue::Numbers(
                values.into_iter().map(|value| value as f64).collect(),
            ));
        }
        return Some(PropertyValue::Texts(
            values.into_iter().map(|value| value.to_string()).collect(),
        ));
    }
    if base_type == VT_R4.0 || base_type == VT_R8.0 {
        return (0..count)
            .map(|index| unsafe { PropVariantGetDoubleElem(value, index).ok() })
            .collect::<Option<Vec<_>>>()
            .filter(|values| values.iter().all(|value| value.is_finite()))
            .map(PropertyValue::Numbers);
    }
    if base_type == VT_LPSTR.0 || base_type == VT_LPWSTR.0 || base_type == VT_BSTR.0 {
        return (0..count)
            .map(|index| unsafe { take_owned_pwstr(PropVariantGetStringElem(value, index).ok()?) })
            .collect::<Option<Vec<_>>>()
            .map(PropertyValue::Texts);
    }
    if base_type == VT_FILETIME.0 {
        return (0..count)
            .map(|index| unsafe {
                PropVariantGetFileTimeElem(value, index)
                    .ok()
                    .map(|time| filetime_text(time.dwHighDateTime, time.dwLowDateTime))
            })
            .collect::<Option<Vec<_>>>()
            .map(PropertyValue::Texts);
    }
    None
}

fn matches_signed_integer(value: u16) -> bool {
    [VT_I1.0, VT_I2.0, VT_I4.0, VT_I8.0].contains(&value)
}

fn matches_unsigned_integer(value: u16) -> bool {
    [VT_UI1.0, VT_UI2.0, VT_UI4.0, VT_UI8.0].contains(&value)
}

unsafe fn scalar_signed(value: *const PROPVARIANT, kind: u16) -> Option<PropertyValue> {
    let number = if kind == VT_I1.0 || kind == VT_I2.0 {
        unsafe { PropVariantToInt16(value).ok()? as i64 }
    } else if kind == VT_I4.0 {
        unsafe { PropVariantToInt32(value).ok()? as i64 }
    } else {
        unsafe { PropVariantToInt64(value).ok()? }
    };
    if number.unsigned_abs() <= 1u64 << 53 {
        Some(PropertyValue::Number(number as f64))
    } else {
        Some(PropertyValue::Text(number.to_string()))
    }
}

unsafe fn scalar_unsigned(value: *const PROPVARIANT, kind: u16) -> Option<PropertyValue> {
    let number = if kind == VT_UI1.0 || kind == VT_UI2.0 {
        unsafe { PropVariantToUInt16(value).ok()? as u64 }
    } else if kind == VT_UI4.0 {
        unsafe { PropVariantToUInt32(value).ok()? as u64 }
    } else {
        unsafe { PropVariantToUInt64(value).ok()? }
    };
    if number <= 1u64 << 53 {
        Some(PropertyValue::Number(number as f64))
    } else {
        Some(PropertyValue::Text(number.to_string()))
    }
}

unsafe fn vector_signed(value: &PROPVARIANT, kind: u16, index: u32) -> Option<i64> {
    let number = if kind == VT_I1.0 || kind == VT_I2.0 {
        unsafe { PropVariantGetInt16Elem(value, index).ok()? as i64 }
    } else if kind == VT_I4.0 {
        unsafe { PropVariantGetInt32Elem(value, index).ok()? as i64 }
    } else {
        unsafe { PropVariantGetInt64Elem(value, index).ok()? }
    };
    Some(number)
}

unsafe fn vector_unsigned(value: &PROPVARIANT, kind: u16, index: u32) -> Option<u64> {
    let number = if kind == VT_UI1.0 || kind == VT_UI2.0 {
        unsafe { PropVariantGetUInt16Elem(value, index).ok()? as u64 }
    } else if kind == VT_UI4.0 {
        unsafe { PropVariantGetUInt32Elem(value, index).ok()? as u64 }
    } else {
        unsafe { PropVariantGetUInt64Elem(value, index).ok()? }
    };
    Some(number)
}

fn filetime_text(high: u32, low: u32) -> String {
    ((u64::from(high) << 32) | u64::from(low)).to_string()
}

unsafe fn take_owned_pwstr(value: PWSTR) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let result = unsafe { value.to_string().ok() };
    unsafe { CoTaskMemFree(Some(value.0.cast::<c_void>())) };
    result
}

fn wide_null(value: &str) -> Vec<u16> {
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn wide_buffer_to_string(value: &[u16]) -> Option<String> {
    let end = value
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(value.len());
    if end == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&value[..end]))
}

fn foreground_is_desktop_shell(hwnd: HWND) -> bool {
    window_class(hwnd)
        .as_deref()
        .is_some_and(is_desktop_shell_class)
}

fn observe_foreground_window(hwnd: HWND) -> Option<ForegroundWindowCandidate> {
    if hwnd.0.is_null() || !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        return None;
    }
    let class_name = window_class(hwnd)?;
    let mut process_id = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
    let visible = unsafe { IsWindowVisible(hwnd) }.as_bool();
    let minimized = unsafe { IsIconic(hwnd) }.as_bool();
    let maximized = unsafe { IsZoomed(hwnd) }.as_bool();
    let cloaked = window_is_cloaked(hwnd);
    let bounds = window_frame_bounds(hwnd)?;
    let work_area = primary_work_area()?;
    let facts = WindowFacts {
        current_process: process_id == std::process::id(),
        visible,
        minimized,
        maximized,
        cloaked,
        system_surface: is_system_surface_class(&class_name),
        bounds,
        work_area,
    };
    let clipped = eligible_window_bounds(&facts)?;
    let identity = format!("{}:{}", hwnd.0 as usize, process_id);
    Some(ForegroundWindowCandidate {
        id: opaque_id("window", &identity),
        bounds: clipped,
    })
}

#[derive(Clone, Debug)]
struct WindowFacts {
    current_process: bool,
    visible: bool,
    minimized: bool,
    maximized: bool,
    cloaked: bool,
    system_surface: bool,
    bounds: PhysicalRectangle,
    work_area: PhysicalRectangle,
}

fn eligible_window_bounds(facts: &WindowFacts) -> Option<PhysicalRectangle> {
    if facts.current_process
        || !facts.visible
        || facts.minimized
        || facts.maximized
        || facts.cloaked
        || facts.system_surface
        || !valid_rectangle(&facts.bounds)
        || !valid_rectangle(&facts.work_area)
    {
        return None;
    }
    let left = facts.bounds.x.max(facts.work_area.x);
    let right =
        (facts.bounds.x + facts.bounds.width).min(facts.work_area.x + facts.work_area.width);
    let top = facts.bounds.y;
    let work_bottom = facts.work_area.y + facts.work_area.height;
    if right - left < 48.0 || top < facts.work_area.y + 16.0 || top > work_bottom - 32.0 {
        return None;
    }
    Some(PhysicalRectangle {
        x: left,
        y: top,
        width: right - left,
        height: facts.bounds.height.min(work_bottom - top).max(1.0),
    })
}

fn valid_rectangle(value: &PhysicalRectangle) -> bool {
    [value.x, value.y, value.width, value.height]
        .into_iter()
        .all(f64::is_finite)
        && value.width > 0.0
        && value.height > 0.0
        && value.width <= 100_000.0
        && value.height <= 100_000.0
}

fn window_class(hwnd: HWND) -> Option<String> {
    if hwnd.0.is_null() {
        return None;
    }
    let mut buffer = [0u16; 256];
    let length = unsafe { GetClassNameW(hwnd, &mut buffer) };
    (length > 0).then(|| String::from_utf16_lossy(&buffer[..length as usize]))
}

fn is_desktop_shell_class(class_name: &str) -> bool {
    class_name.eq_ignore_ascii_case("Progman") || class_name.eq_ignore_ascii_case("WorkerW")
}

fn is_system_surface_class(class_name: &str) -> bool {
    is_desktop_shell_class(class_name)
        || class_name.eq_ignore_ascii_case("Shell_TrayWnd")
        || class_name.eq_ignore_ascii_case("Shell_SecondaryTrayWnd")
        || class_name.eq_ignore_ascii_case("DV2ControlHost")
}

fn window_is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&mut cloaked as *mut u32).cast(),
            std::mem::size_of::<u32>() as u32,
        )
        .is_ok()
            && cloaked != 0
    }
}

fn window_frame_bounds(hwnd: HWND) -> Option<PhysicalRectangle> {
    let mut bounds = RECT::default();
    unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&mut bounds as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
        .ok()?;
    }
    rectangle_from_rect(bounds)
}

fn primary_work_area() -> Option<PhysicalRectangle> {
    let monitor = unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) };
    if monitor.0.is_null() {
        return None;
    }
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..MONITORINFO::default()
    };
    if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        return None;
    }
    rectangle_from_rect(info.rcWork)
}

fn rectangle_from_rect(value: RECT) -> Option<PhysicalRectangle> {
    let width = value.right.checked_sub(value.left)?;
    let height = value.bottom.checked_sub(value.top)?;
    (width > 0 && height > 0).then_some(PhysicalRectangle {
        x: f64::from(value.left),
        y: f64::from(value.top),
        width: f64::from(width),
        height: f64::from(height),
    })
}

fn opaque_id(namespace: &str, identity: &str) -> String {
    let mut hasher = DefaultHasher::new();
    namespace.hash(&mut hasher);
    identity.hash(&mut hasher);
    format!("{namespace}-{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::Com::StructuredStorage::{
        InitPropVariantFromBooleanVector, InitPropVariantFromBuffer, InitPropVariantFromInt64Vector,
    };

    fn eligible_facts() -> WindowFacts {
        WindowFacts {
            current_process: false,
            visible: true,
            minimized: false,
            maximized: false,
            cloaked: false,
            system_surface: false,
            bounds: PhysicalRectangle {
                x: 100.0,
                y: 200.0,
                width: 600.0,
                height: 400.0,
            },
            work_area: PhysicalRectangle {
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1040.0,
            },
        }
    }

    #[test]
    fn restored_visible_foreground_window_produces_finite_clipped_bounds() {
        let mut facts = eligible_facts();
        facts.bounds.x = -100.0;
        let bounds = eligible_window_bounds(&facts).expect("eligible window");
        assert_eq!(bounds.x, 0.0);
        assert_eq!(bounds.width, 500.0);
        assert!([bounds.x, bounds.y, bounds.width, bounds.height]
            .into_iter()
            .all(f64::is_finite));
    }

    #[test]
    fn ineligible_window_states_never_produce_candidates() {
        for mutate in [
            |facts: &mut WindowFacts| facts.current_process = true,
            |facts: &mut WindowFacts| facts.visible = false,
            |facts: &mut WindowFacts| facts.minimized = true,
            |facts: &mut WindowFacts| facts.maximized = true,
            |facts: &mut WindowFacts| facts.cloaked = true,
            |facts: &mut WindowFacts| facts.system_surface = true,
        ] {
            let mut facts = eligible_facts();
            mutate(&mut facts);
            assert!(eligible_window_bounds(&facts).is_none());
        }
    }

    #[test]
    fn unsafe_or_useless_window_geometry_is_rejected() {
        let mut facts = eligible_facts();
        facts.bounds.width = f64::NAN;
        assert!(eligible_window_bounds(&facts).is_none());

        let mut facts = eligible_facts();
        facts.bounds.width = 20.0;
        assert!(eligible_window_bounds(&facts).is_none());

        let mut facts = eligible_facts();
        facts.bounds.y = 0.0;
        assert!(eligible_window_bounds(&facts).is_none());
    }

    #[test]
    fn supported_property_vectors_serialize_and_binary_values_are_skipped() {
        let mut booleans = unsafe {
            InitPropVariantFromBooleanVector(Some(&[true.into(), false.into()]))
                .expect("boolean vector")
        };
        assert_eq!(
            unsafe { property_value(&booleans) },
            Some(PropertyValue::Booleans(vec![true, false]))
        );
        unsafe { PropVariantClear(&mut booleans).expect("clear boolean vector") };

        let mut numbers =
            unsafe { InitPropVariantFromInt64Vector(Some(&[42, -7])).expect("integer vector") };
        assert_eq!(
            unsafe { property_value(&numbers) },
            Some(PropertyValue::Numbers(vec![42.0, -7.0]))
        );
        unsafe { PropVariantClear(&mut numbers).expect("clear integer vector") };

        let bytes = [1u8, 2, 3, 4];
        let mut binary = unsafe {
            InitPropVariantFromBuffer(bytes.as_ptr().cast(), bytes.len() as u32)
                .expect("binary value")
        };
        assert_eq!(unsafe { property_value(&binary) }, None);
        unsafe { PropVariantClear(&mut binary).expect("clear binary value") };
    }
}
