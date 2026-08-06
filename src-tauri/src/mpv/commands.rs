use super::engine::MpvEngine;
use super::profile::RenderProfiler;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, State};

#[derive(Default)]
pub struct MpvState(pub Mutex<Option<MpvEngine>>);

/// Returns "gpu" or "cpu" -- whichever backend `MpvEngine::attach` (ADR-0009) landed on, for the CPU-fallback badge.
#[tauri::command]
pub fn mpv_attach<R: Runtime>(app: AppHandle<R>, state: State<'_, MpvState>, extra_config: Vec<(String, String)>) -> Result<String, String> {
    let mut slot = state.0.lock().unwrap();
    if let Some(e) = slot.as_ref() {
        return Ok(e.render_backend().to_string()); // idempotent -- engine constructed once
    }
    let window = app.get_webview_window("main").ok_or("no main window")?;
    let engine = MpvEngine::attach(&app, &window, &extra_config)?;
    let backend = engine.render_backend().to_string();
    *slot = Some(engine);
    Ok(backend)
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
pub fn mpv_add_subtitle(state: State<'_, MpvState>, url: String, lang: Option<String>, index: i64) -> Result<(), String> {
    with_engine(&state, |e| e.add_subtitle(&url, lang.as_deref(), index))
}

#[tauri::command]
pub fn mpv_set_text_track(state: State<'_, MpvState>, index: Option<i64>) -> Result<(), String> {
    with_engine(&state, |e| e.set_text_track(index))
}

#[tauri::command]
pub fn mpv_set_subtitle_delay(state: State<'_, MpvState>, seconds: f64) -> Result<(), String> {
    with_engine(&state, |e| e.set_subtitle_delay(seconds))
}

/// Selects an embedded audio/subtitle track by stream index -- always direct play, so every Jellyfin track is already in the file mpv demuxes (see engine.rs's `select_track`).
#[tauri::command]
pub fn mpv_select_track(state: State<'_, MpvState>, kind: String, source_index: Option<i64>) -> Result<(), String> {
    with_engine(&state, |e| e.select_track(&kind, source_index))
}

#[tauri::command]
pub fn mpv_set_rect(state: State<'_, MpvState>, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let slot = state.0.lock().unwrap();
    if let Some(e) = slot.as_ref() {
        e.set_rect(x, y, w, h);
    }
    Ok(())
}

// Generic mpv command passthrough (screenshot, frame-step, cycle deinterlace, ...) -- see engine.rs's run_command doc.
#[tauri::command]
pub fn mpv_run_command(state: State<'_, MpvState>, args: Vec<String>) -> Result<(), String> {
    with_engine(&state, |e| e.run_command(&args))
}

#[tauri::command]
pub fn mpv_destroy(state: State<'_, MpvState>) -> Result<(), String> {
    state.0.lock().unwrap().take(); // drop() tears down observer thread + GL/mpv state
    Ok(())
}

// Was `Ok(T::default())` on a missing engine -- every mpv_* command sent in the (small but real)
// window between a fresh MpvEngine's construction and its `mpv_attach` IPC round trip actually
// landing here silently vanished with no error, no log, nothing. Surface it as a real error instead --
// callers already `.catch()` and log the other track/PiP commands the same way (mpv.ts).
fn with_engine<T>(
    state: &State<'_, MpvState>,
    f: impl FnOnce(&MpvEngine) -> Result<T, String>,
) -> Result<T, String> {
    let slot = state.0.lock().unwrap();
    match slot.as_ref() {
        Some(e) => f(e),
        None => Err("mpv not attached yet".to_string()),
    }
}

/// Render tick, woken by mpv's own update callback (`RenderWaker`) instead of a blind fixed-rate poll.
pub fn spawn_render_loop<R: Runtime>(app: AppHandle<R>) {
    // `None` unless PHOTON_PROFILE_RENDER is set. On Linux `render()` is only a post to the GTK main
    // thread, so the meaningful timing lives in linux/mod.rs's render signal, not here.
    let profiler = RenderProfiler::new();
    std::thread::spawn(move || loop {
        // render() runs here (not main thread): mac point-res render still beachballed main thread at 30fps; Windows/Linux WGL/GLX context needs one owning thread. set_rect stays main-thread.
        let Some(state) = app.try_state::<MpvState>() else {
            std::thread::sleep(std::time::Duration::from_millis(200));
            continue;
        };
        // MpvState locked only to clone these Arcs, not for render -- else a slow render frame stalls play/pause/seek/volume.
        let handle = state.0.lock().unwrap().as_ref().map(|e| (e.render_surface(), e.render_waker()));
        let Some((surface, waker)) = handle else {
            std::thread::sleep(std::time::Duration::from_millis(200)); // not attached yet
            continue;
        };
        // Blocks until mpv reports a new frame; timeout is a safety net, not the normal wakeup path.
        waker.wait(std::time::Duration::from_millis(250));
        match &profiler {
            Some(profiler) => profiler.time(|| surface.lock().unwrap().render()),
            None => surface.lock().unwrap().render(),
        }
    });
}
