mod mpv_engine;

use mpv_engine::MpvEngine;
use std::sync::Mutex;
use tauri::{Manager, WindowEvent};

const TEST_VIDEO: &str = "/tmp/mpv-spike-assets/test.mp4";

#[tauri::command]
fn mpv_load_test_file(state: tauri::State<Mutex<Option<MpvEngine>>>) {
    if let Some(engine) = state.lock().unwrap().as_ref() {
        engine.load_file(TEST_VIDEO);
    }
}

#[tauri::command]
fn mpv_toggle_pause(state: tauri::State<Mutex<Option<MpvEngine>>>) {
    eprintln!("[mpv-spike] mpv_toggle_pause invoked");
    if let Some(engine) = state.lock().unwrap().as_ref() {
        engine.toggle_pause();
    }
}

#[tauri::command]
fn mpv_seek(state: tauri::State<Mutex<Option<MpvEngine>>>, seconds: f64) {
    if let Some(engine) = state.lock().unwrap().as_ref() {
        engine.seek(seconds);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::<Option<MpvEngine>>::new(None))
        .invoke_handler(tauri::generate_handler![
            mpv_load_test_file,
            mpv_toggle_pause,
            mpv_seek
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").expect("no main window");
            let engine = MpvEngine::attach(&window);
            engine.load_file(TEST_VIDEO);
            app.state::<Mutex<Option<MpvEngine>>>()
                .lock()
                .unwrap()
                .replace(engine);

            let resize_window = window.clone();
            let resize_app = app.handle().clone();
            window.on_window_event(move |event| {
                if matches!(
                    event,
                    WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }
                ) {
                    if let Some(engine) = resize_app.state::<Mutex<Option<MpvEngine>>>().lock().unwrap().as_ref() {
                        engine.resize(&resize_window);
                    }
                }
            });

            mpv_engine::spawn_render_loop(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
