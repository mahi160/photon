use super::engine::MpvEngine;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, State};

#[derive(Default)]
pub struct MpvState(pub Mutex<Option<MpvEngine>>);

#[tauri::command]
pub fn mpv_attach<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, MpvState>,
    extra_config: Vec<(String, String)>,
) -> Result<(), String> {
    let mut slot = state.0.lock().unwrap();
    if slot.is_some() {
        return Ok(()); // idempotent — usePlayerEngine only constructs the engine once
    }
    let window = app.get_webview_window("main").ok_or("no main window")?;
    *slot = Some(MpvEngine::attach(&app, &window, &extra_config)?);
    Ok(())
}

#[tauri::command]
pub fn mpv_load(state: State<'_, MpvState>, url: String, start_seconds: f64) -> Result<(), String> {
    with_engine(&state, |e| e.load(&url, start_seconds))
}

#[tauri::command]
pub fn mpv_play(state: State<'_, MpvState>) -> Result<(), String> {
    with_engine(&state, |e| e.play())
}

#[tauri::command]
pub fn mpv_pause(state: State<'_, MpvState>) -> Result<(), String> {
    with_engine(&state, |e| e.pause())
}

#[tauri::command]
pub fn mpv_seek(state: State<'_, MpvState>, seconds: f64) -> Result<(), String> {
    with_engine(&state, |e| e.seek(seconds))
}

#[tauri::command]
pub fn mpv_set_rate(state: State<'_, MpvState>, rate: f64) -> Result<(), String> {
    with_engine(&state, |e| e.set_rate(rate))
}

#[tauri::command]
pub fn mpv_set_volume(state: State<'_, MpvState>, volume: f64) -> Result<(), String> {
    with_engine(&state, |e| e.set_volume(volume))
}

#[tauri::command]
pub fn mpv_set_muted(state: State<'_, MpvState>, muted: bool) -> Result<(), String> {
    with_engine(&state, |e| e.set_muted(muted))
}

#[tauri::command]
pub fn mpv_add_subtitle(state: State<'_, MpvState>, url: String, lang: Option<String>) -> Result<i64, String> {
    let slot = state.0.lock().unwrap();
    match slot.as_ref() {
        Some(e) => e.add_subtitle(&url, lang.as_deref()),
        None => Err("mpv engine not attached".into()),
    }
}

#[tauri::command]
pub fn mpv_set_text_track(state: State<'_, MpvState>, sid: Option<i64>) -> Result<(), String> {
    with_engine(&state, |e| e.set_text_track(sid))
}

#[tauri::command]
pub fn mpv_set_subtitle_delay(state: State<'_, MpvState>, seconds: f64) -> Result<(), String> {
    with_engine(&state, |e| e.set_subtitle_delay(seconds))
}

#[tauri::command]
pub fn mpv_set_rect(state: State<'_, MpvState>, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let slot = state.0.lock().unwrap();
    if let Some(e) = slot.as_ref() {
        e.set_rect(x, y, w, h);
    }
    Ok(())
}

#[tauri::command]
pub fn mpv_destroy(state: State<'_, MpvState>) -> Result<(), String> {
    state.0.lock().unwrap().take(); // drop() tears down the observer thread + GL/mpv state
    Ok(())
}

fn with_engine<T>(
    state: &State<'_, MpvState>,
    f: impl FnOnce(&MpvEngine) -> Result<T, String>,
) -> Result<T, String>
where
    T: Default,
{
    let slot = state.0.lock().unwrap();
    match slot.as_ref() {
        Some(e) => f(e),
        None => Ok(T::default()),
    }
}

/// Fixed-interval render tick (see engine.rs's ponytail note on why this
/// isn't update-callback-driven yet).
pub fn spawn_render_loop<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(16));
        let tick_app = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(state) = tick_app.try_state::<MpvState>() {
                if let Some(engine) = state.0.lock().unwrap().as_ref() {
                    engine.render();
                }
            }
        });
    });
}
