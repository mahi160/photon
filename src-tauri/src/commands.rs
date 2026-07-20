//! Non-player IPC surface (issue #5): session storage, app/window info,
//! launch-at-login, hardware-acceleration pref, and the subtitle CORS proxy.
//! Playback (mpv:*) and updater commands are out of scope here — tickets
//! #6/#10 (player) and #11 (release pipeline) respectively.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const KEYRING_SERVICE: &str = "dev.photon";
const KEYRING_USER: &str = "session";

/// Origin of the signed-in Jellyfin server, remembered from the session
/// payload so `subtitle_fetch` can't be used as an arbitrary URL fetcher.
pub struct AppState {
    server_origin: Mutex<Option<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self { server_origin: Mutex::new(None) }
    }
}

fn remember_origin(state: &AppState, session_json: &str) {
    let origin = serde_json::from_str::<serde_json::Value>(session_json)
        .ok()
        .and_then(|v| v.get("server").and_then(|s| s.as_str()).map(str::to_string))
        .and_then(|server| url::Url::parse(&server).ok())
        .map(|u| u.origin().ascii_serialization());
    *state.server_origin.lock().unwrap() = origin;
}

#[tauri::command]
pub fn session_get(state: State<'_, AppState>) -> Option<String> {
    let value = Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?.get_password().ok()?;
    remember_origin(&state, &value);
    Some(value)
}

#[tauri::command]
pub fn session_set(state: State<'_, AppState>, value: String) -> bool {
    remember_origin(&state, &value);
    match Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        Ok(entry) => entry.set_password(&value).is_ok(),
        Err(_) => false,
    }
}

#[tauri::command]
pub fn session_clear(state: State<'_, AppState>) {
    *state.server_origin.lock().unwrap() = None;
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
struct Prefs {
    #[serde(default)]
    disable_hw_accel: bool,
}

fn prefs_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("prefs.json"))
}

fn read_prefs(app: &AppHandle) -> Prefs {
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
    write_prefs(&app, &Prefs { disable_hw_accel: !enabled });
}

#[tauri::command]
pub fn app_get_hw_accel(app: AppHandle) -> bool {
    !read_prefs(&app).disable_hw_accel
}

#[tauri::command]
pub async fn subtitle_fetch(state: State<'_, AppState>, url: String) -> Result<String, String> {
    let origin = state.server_origin.lock().unwrap().clone();
    let target = url::Url::parse(&url).map_err(|e| e.to_string())?;
    let target_origin = target.origin().ascii_serialization();
    if origin.as_deref() != Some(target_origin.as_str()) {
        return Err("Subtitle URL not on the signed-in server".into());
    }
    let res = reqwest::Client::new()
        .get(url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("{}", res.status()));
    }
    res.text().await.map_err(|e| e.to_string())
}

