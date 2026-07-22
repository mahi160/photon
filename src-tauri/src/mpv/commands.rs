use super::engine::MpvEngine;
use super::profile::RenderProfiler;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, State};

#[derive(Default)]
pub struct MpvState(pub Mutex<Option<MpvEngine>>);

/// Returns "gpu" or "cpu" -- whichever render backend `MpvEngine::attach`
/// (ADR-0009) landed on, for the player overlay's CPU-fallback badge.
#[tauri::command]
pub fn mpv_attach<R: Runtime>(app: AppHandle<R>, state: State<'_, MpvState>, extra_config: Vec<(String, String)>) -> Result<String, String> {
    let mut slot = state.0.lock().unwrap();
    if let Some(e) = slot.as_ref() {
        return Ok(e.render_backend().to_string()); // idempotent — usePlayerEngine only constructs the engine once
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

/// Selects an embedded audio/subtitle track by the media's own stream index
/// (see engine.rs's `select_track` doc — always direct play now, so every
/// track Jellyfin reports is already in the file mpv itself is demuxing).
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

/// Render tick, woken by mpv's own update callback (see engine.rs's
/// `RenderWaker`) instead of a blind fixed-rate poll.
pub fn spawn_render_loop<R: Runtime>(app: AppHandle<R>) {
    let profiler = RenderProfiler::new();
    std::thread::spawn(move || loop {
        // render() now runs directly on this background thread instead of
        // being marshalled onto the main thread every tick -- even after
        // rendering at point resolution instead of full Retina backing
        // resolution (quarter the bytes), the per-frame buffer alloc +
        // CGImage build was still enough main-thread work to beachball the
        // window at 30fps. CALayer.contents is documented as safe to set
        // from a background thread (Core Animation's own threading model,
        // unlike most of AppKit) -- this is the standard technique real
        // custom video-compositing code uses for exactly this reason.
        // `self.view`'s *other* AppKit calls (setFrame:, setHidden:) still
        // only ever happen from set_rect() on the main thread (a Tauri
        // command); render()'s own NSView touches are read only
        // (bounds/isHidden/layer getters).
        let Some(state) = app.try_state::<MpvState>() else {
            std::thread::sleep(std::time::Duration::from_millis(200));
            continue;
        };
        // MpvState is locked only long enough to clone these two Arcs, not
        // for the render itself (see RenderSurface's doc) -- otherwise a
        // slow software-render frame would hold the *same* lock every
        // play/pause/seek/volume command needs, stalling input behind it.
        let handle = state.0.lock().unwrap().as_ref().map(|e| (e.render_surface(), e.render_waker()));
        let Some((surface, waker)) = handle else {
            std::thread::sleep(std::time::Duration::from_millis(200)); // not attached yet
            continue;
        };
        // Blocks until mpv reports a new frame; the timeout is a safety net,
        // not the normal wakeup path (see RenderWaker's doc).
        waker.wait(std::time::Duration::from_millis(250));
        profiler.time(|| surface.lock().unwrap().render());
    });
}
