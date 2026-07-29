//! Auto-update (issue #11): wraps `tauri-plugin-updater` behind frontend's stubbed `window.api.*` shape. One background check at startup (gated on `disable_auto_update` pref), silent download, waits for user's "Restart to update" click before install+relaunch. No manual check-now command -- one check per launch is the whole scope.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Mirrors `UpdaterStatus` in `src/renderer/src/lib/api.ts` -- kebab-case tag produces the same `{state:'available', version}` JSON shape.
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
    ready: Mutex<Option<(Update, Vec<u8>)>>, // set once downloaded+verified, taken by updater_install
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
    app.request_restart(); // installer doesn't relaunch on its own
    Ok(())
}

/// One check per launch unless the user disabled auto-update. Fire-and-forget from lib.rs's setup -- failures land in `UpdaterStatus::Error`, never a crash.
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
