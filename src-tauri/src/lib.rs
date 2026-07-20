mod commands;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::session_get,
            commands::session_set,
            commands::session_clear,
            commands::app_version,
            commands::app_minimize,
            commands::app_restore,
            commands::app_set_login_item,
            commands::app_get_login_item,
            commands::app_set_hw_accel,
            commands::app_get_hw_accel,
            commands::subtitle_fetch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
