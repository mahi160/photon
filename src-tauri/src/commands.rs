//! Non-player IPC surface (issue #5): session storage, app/window info,
//! launch-at-login, hardware-acceleration pref. Playback (mpv:*) and updater
//! commands live elsewhere (mpv module) / aren't ported yet (ticket #11).

use keyring::Entry;
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
pub fn app_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
pub fn app_restore(window: tauri::Window) {
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.set_focus();
}

#[tauri::command]
pub fn app_set_fullscreen(window: tauri::Window, fullscreen: bool) {
    let _ = window.set_fullscreen(fullscreen);
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
    #[serde(default)]
    disable_hw_accel: bool,
    // ticket #11 -- mirrors disable_hw_accel; gates updater::spawn_check
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

// ponytail: persists the pref like Electron's version did, but there's no
// single cross-platform Tauri/webview knob to actually disable GPU
// compositing the way Chromium's --disable-gpu did. Real enforcement is a
// per-platform follow-up (WebView2 env var on Windows, WEBKIT_DISABLE_
// COMPOSITING_MODE on Linux); macOS's WKWebView has no public toggle at all.
#[tauri::command]
pub fn app_set_hw_accel(app: AppHandle, enabled: bool) {
    let mut prefs = read_prefs(&app);
    prefs.disable_hw_accel = !enabled;
    write_prefs(&app, &prefs);
}

#[tauri::command]
pub fn app_get_hw_accel(app: AppHandle) -> bool {
    !read_prefs(&app).disable_hw_accel
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
