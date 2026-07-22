//! Non-player IPC surface (issue #5): session storage, app/window info,
//! launch-at-login. Playback (mpv:*) and updater commands live elsewhere
//! (mpv module) / aren't ported yet (ticket #11).

use keyring::Entry;
use objc2_app_kit::{NSWindow, NSWindowButton};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

const KEYRING_SERVICE: &str = "dev.photon";
const KEYRING_USER: &str = "session";

#[tauri::command]
pub fn session_get() -> Option<String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?.get_password().ok()
}

#[tauri::command]
pub fn session_set(value: String) -> bool {
    match Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        Ok(entry) => entry.set_password(&value).is_ok(),
        Err(_) => false,
    }
}

#[tauri::command]
pub fn session_clear() {
    if let Ok(entry) = Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        let _ = entry.delete_credential();
    }
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn app_set_fullscreen(window: tauri::Window, fullscreen: bool) {
    let _ = window.set_fullscreen(fullscreen);
}

/// Shows/hides the native traffic-light buttons themselves (not the whole
/// title bar -- there's no separate title bar to show/hide in Overlay
/// style, just these three buttons drawn over the content). Used only by
/// the player (Player.tsx), synced to the same auto-hide `visible` state
/// already driving PlayerControls' own opacity, so the dots disappear over
/// the video along with everything else and only reappear on hover -- every
/// other page leaves them alone (never calls this with `false`).
#[tauri::command]
pub fn app_set_traffic_lights_visible(window: tauri::Window, visible: bool) -> Result<(), String> {
    let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())?;
    let ns_window: &NSWindow = unsafe { &*(ns_window_ptr as *const NSWindow) };
    for button_kind in [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton] {
        if let Some(button) = ns_window.standardWindowButton(button_kind) {
            button.setHidden(!visible);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn app_set_login_item(app: AppHandle, enabled: bool) {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    let _ = if enabled { mgr.enable() } else { mgr.disable() };
}

#[tauri::command]
pub fn app_get_login_item(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[derive(Serialize, Deserialize, Default)]
pub(crate) struct Prefs {
    // gates updater::spawn_check
    #[serde(default)]
    pub(crate) disable_auto_update: bool,
}

fn prefs_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("prefs.json"))
}

// pub(crate): updater.rs reads disable_auto_update at startup to decide
// whether to check at all.
pub(crate) fn read_prefs(app: &AppHandle) -> Prefs {
    prefs_file(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_prefs(app: &AppHandle, prefs: &Prefs) {
    if let Some(path) = prefs_file(app) {
        if let Ok(json) = serde_json::to_string(prefs) {
            let _ = fs::write(path, json);
        }
    }
}

#[tauri::command]
pub fn app_set_auto_update(app: AppHandle, enabled: bool) {
    let mut prefs = read_prefs(&app);
    prefs.disable_auto_update = !enabled;
    write_prefs(&app, &prefs);
}

#[tauri::command]
pub fn app_get_auto_update(app: AppHandle) -> bool {
    !read_prefs(&app).disable_auto_update
}
