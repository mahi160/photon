mod commands;
mod idle;
mod mpv;
mod pip;
mod updater;

use mpv::commands::MpvState;
#[cfg(target_os = "linux")]
use tauri::Manager;

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
        .manage(idle::IdleState::default())
        .invoke_handler(tauri::generate_handler![
            commands::session_get,
            commands::session_set,
            commands::session_clear,
            commands::app_version,
            commands::app_set_fullscreen,
            commands::app_set_traffic_lights_visible,
            pip::pip_available,
            pip::pip_start,
            pip::pip_stop,
            commands::app_set_login_item,
            commands::app_get_login_item,
            commands::app_set_auto_update,
            commands::app_get_auto_update,
            idle::app_set_idle_inhibited,
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
            mpv::commands::mpv_run_command,
            mpv::commands::mpv_destroy
        ])
        .setup(|app| {
            // libmpv requires LC_NUMERIC=C, and it has to be set here: on the main thread (setlocale is
            // process-global and not thread-safe, so doing it from the worker thread that runs mpv_attach
            // raced every locale-dependent call in GTK/WebKit) and *after* the toolkit is up, because
            // gtk_init calls setlocale(LC_ALL, "") and would undo an earlier call -- measured: LC_NUMERIC
            // goes back to en_US.UTF-8 across gtk_init, and libmpv then prints "Non-C locale detected.
            // This is not supported.". `c"C"` keeps it portable; `as *const i8` broke the aarch64-Linux
            // build, where c_char is unsigned.
            unsafe {
                libc::setlocale(libc::LC_NUMERIC, c"C".as_ptr());
            }

            // ADR-0010: reparent the webview over a GtkGLArea so mpv composites under it. Runs on the
            // GTK main thread via with_webview; the Sender is stored synchronously inside, so an mpv
            // attach that races ahead just buffers on the glib channel until the receiver attaches.
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.with_webview(|w| mpv::linux::setup(&w.inner()));
            }
            mpv::commands::spawn_render_loop(app.handle().clone());
            updater::spawn_check(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
