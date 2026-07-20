mod commands;
mod mpv;

use commands::AppState;
use mpv::commands::MpvState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(AppState::default())
        .manage(MpvState::default())
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
            commands::subtitle_fetch,
            mpv::commands::mpv_attach,
            mpv::commands::mpv_load,
            mpv::commands::mpv_play,
            mpv::commands::mpv_pause,
            mpv::commands::mpv_seek,
            mpv::commands::mpv_set_rate,
            mpv::commands::mpv_set_volume,
            mpv::commands::mpv_set_muted,
            mpv::commands::mpv_set_rect,
            mpv::commands::mpv_destroy
        ])
        .setup(|app| {
            mpv::commands::spawn_render_loop(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
