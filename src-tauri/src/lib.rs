mod commands;
mod mpv;
mod pip;
mod updater;

use mpv::commands::MpvState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(MpvState::default())
        .manage(pip::PipState::default())
        .manage(updater::UpdaterState::default())
        .invoke_handler(tauri::generate_handler![
            commands::session_get,
            commands::session_set,
            commands::session_clear,
            commands::app_version,
            commands::app_minimize,
            commands::app_restore,
            commands::app_set_fullscreen,
            pip::pip_available,
            pip::pip_start,
            pip::pip_stop,
            commands::app_set_login_item,
            commands::app_get_login_item,
            commands::app_set_hw_accel,
            commands::app_get_hw_accel,
            commands::app_set_auto_update,
            commands::app_get_auto_update,
            updater::updater_get_status,
            updater::updater_install,
            mpv::commands::mpv_attach,
            mpv::commands::mpv_load,
            mpv::commands::mpv_play,
            mpv::commands::mpv_pause,
            mpv::commands::mpv_seek,
            mpv::commands::mpv_set_rate,
            mpv::commands::mpv_set_volume,
            mpv::commands::mpv_set_muted,
            mpv::commands::mpv_add_subtitle,
            mpv::commands::mpv_set_text_track,
            mpv::commands::mpv_set_subtitle_delay,
            mpv::commands::mpv_select_track,
            mpv::commands::mpv_set_rect,
            mpv::commands::mpv_destroy
        ])
        .setup(|app| {
            mpv::commands::spawn_render_loop(app.handle().clone());
            updater::spawn_check(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
