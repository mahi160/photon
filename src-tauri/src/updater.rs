//! Auto-update (issue #11): wraps `tauri-plugin-updater` behind the same
//! `window.api.*` shape the frontend already has stubbed
//! (`src/renderer/src/lib/api.ts`) -- one background check at startup (gated
//! on the persisted `disable_auto_update` pref, see `commands.rs`), downloads
//! silently if found, then waits for the user to confirm via Settings'
//! "Restart to update" button before actually installing + relaunching.
//!
//! No manual "check for updates now" button exists in the UI today, so
//! there's deliberately no command for that either -- one check per launch
//! is the whole surface this ticket asks for.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Mirrors `UpdaterStatus` in `src/renderer/src/lib/api.ts` exactly --
/// `#[serde(tag = "state")]` + kebab-case produces the same
/// `{state:'available', version}`-shaped JSON that type already declares.
#[derive(Clone, Serialize, Default)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum UpdaterStatus {
    #[default]
    Idle,
    Checking,
    NotAvailable,
    Available { version: String },
    Downloaded { version: String },
    Error { message: String },
}

#[derive(Default)]
pub struct UpdaterState {
    status: Mutex<UpdaterStatus>,
    // set once a checked update's bytes are downloaded+signature-verified;
    // taken by `updater_install` once the user clicks "Restart to update"
    ready: Mutex<Option<(Update, Vec<u8>)>>,
}

fn set_status(app: &AppHandle, state: &UpdaterState, status: UpdaterStatus) {
    *state.status.lock().unwrap() = status.clone();
    let _ = app.emit("updater://status", status);
}

#[tauri::command]
pub fn updater_get_status(state: State<'_, UpdaterState>) -> UpdaterStatus {
    state.status.lock().unwrap().clone()
}

#[tauri::command]
pub fn updater_install(app: AppHandle, state: State<'_, UpdaterState>) -> Result<(), String> {
    let (update, bytes) = state.ready.lock().unwrap().take().ok_or("no update ready to install")?;
    update.install(bytes).map_err(|e| e.to_string())?;
    // Tauri's updater installs the new version alongside/over the old one on
    // every platform, but doesn't relaunch on its own -- the user is still
    // running the old binary in memory until this happens.
    app.request_restart();
    Ok(())
}

/// One check per launch, only if the user hasn't turned auto-update off
/// (`commands::read_prefs`). Fire-and-forget from `lib.rs`'s `setup` --
/// failures land in `UpdaterStatus::Error` for Settings to show, never a
/// crash (an update check failing must never block using the app).
pub fn spawn_check(app: AppHandle) {
    if crate::commands::read_prefs(&app).disable_auto_update {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let state = app.state::<UpdaterState>();
        set_status(&app, &state, UpdaterStatus::Checking);

        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => {
                set_status(&app, &state, UpdaterStatus::Error { message: e.to_string() });
                return;
            }
        };

        match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                set_status(&app, &state, UpdaterStatus::Available { version: version.clone() });
                match update.download(|_, _| {}, || {}).await {
                    Ok(bytes) => {
                        *state.ready.lock().unwrap() = Some((update, bytes));
                        set_status(&app, &state, UpdaterStatus::Downloaded { version });
                    }
                    Err(e) => set_status(&app, &state, UpdaterStatus::Error { message: e.to_string() }),
                }
            }
            Ok(None) => set_status(&app, &state, UpdaterStatus::NotAvailable),
            Err(e) => set_status(&app, &state, UpdaterStatus::Error { message: e.to_string() }),
        }
    });
}
