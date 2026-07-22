//! In-process libmpv render-API engine (ADR-0003/0005/0009), platform-
//! agnostic half: mpv lifecycle, command dispatch, the pending-operations
//! queue, and tick/property observation. Every actual Cocoa/OpenGL/Metal
//! call lives behind `RenderSurface` (`mpv/mac/`, ADR-0009) — this file
//! never learns which backend (`SoftwareSurface`/`GpuSurface`) is active,
//! or that a GPU→CPU fallback happened.
//!
//! Render loop (`spawn_render_loop` in commands.rs) is woken by mpv's own
//! `mpv_render_context_set_update_callback` (see `RenderWaker` below) as soon
//! as a new frame is ready, rather than guessing on a fixed timer. Not a real
//! display vsync lock (no `CVDisplayLink` — mpv's callback says "a frame is
//! ready", not "the display's about to refresh") — that's a further, real
//! per-platform upgrade, not done here.

use super::mac::{self, Backend, RenderSurface};
use libmpv_sys::*;
use objc2_app_kit::NSWindow;
use std::collections::HashMap;
use std::ffi::{c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime, WebviewWindow};

/// Snapshot pushed to the frontend on every observed-property change.
#[derive(Clone, serde::Serialize)]
pub struct Tick {
    pub time: f64,
    pub duration: f64,
    pub paused: bool,
    pub core_idle: bool,
    pub buffered: f64,
    pub volume: f64, // 0..1
    pub muted: bool,
}

impl Default for Tick {
    fn default() -> Self {
        Self { time: 0.0, duration: 0.0, paused: true, core_idle: false, buffered: 0.0, volume: 1.0, muted: false }
    }
}

#[derive(Default)]
struct PendingState {
    loaded: bool, // has MPV_EVENT_FILE_LOADED fired for the *current* load() yet
    start_seconds: f64,
    queued_tracks: Vec<(String, Option<i64>)>, // (kind, source_index) selected before `loaded`
    queued_text_index: Option<Option<i64>>,    // set_text_track called before `loaded`; latest wins
    // (url, lang, jellyfin index) added before `loaded` -- see add_subtitle's doc
    queued_subtitle_adds: Vec<(String, Option<String>, i64)>,
    // jellyfin stream index -> mpv's own "sid", populated as each add_subtitle
    // actually lands (immediately, or once FILE_LOADED drains the queue above)
    text_track_ids: HashMap<i64, i64>,
}

/// Everything queued before `loaded` became true, moved out in the exact
/// order `spawn_observer`'s MPV_EVENT_FILE_LOADED handler applies it: seek
/// first, subtitle adds next (so a queued text-track selection below can
/// resolve against them, see `add_subtitle`'s doc), embedded track selection,
/// then text-track selection last (so it wins the race against mpv's own
/// post-load autoselect, see `set_text_track`'s doc). A pure data move, no
/// FFI -- `PendingState::drain` is unit-tested directly (below); the FFI
/// side (`spawn_observer`) just executes this snapshot in field order.
struct DrainedQueue {
    start_seconds: f64,
    subtitle_adds: Vec<(String, Option<String>, i64)>,
    tracks: Vec<(String, Option<i64>)>,
    text_index: Option<Option<i64>>,
}

impl PendingState {
    fn drain(&mut self) -> DrainedQueue {
        self.loaded = true;
        DrainedQueue {
            start_seconds: std::mem::replace(&mut self.start_seconds, 0.0),
            subtitle_adds: std::mem::take(&mut self.queued_subtitle_adds),
            tracks: std::mem::take(&mut self.queued_tracks),
            text_index: self.queued_text_index.take(),
        }
    }
}

#[cfg(test)]
mod pending_state_tests {
    use super::*;

    #[test]
    fn drain_returns_queued_items_in_insertion_order_and_clears_them() {
        let mut pending = PendingState { start_seconds: 12.5, ..Default::default() };
        pending.queued_subtitle_adds.push(("a.vtt".into(), Some("eng".into()), 1));
        pending.queued_subtitle_adds.push(("b.vtt".into(), None, 2));
        pending.queued_tracks.push(("audio".into(), Some(3)));
        pending.queued_tracks.push(("sub".into(), None));
        pending.queued_text_index = Some(Some(2));

        let drained = pending.drain();

        assert_eq!(drained.start_seconds, 12.5);
        assert_eq!(
            drained.subtitle_adds,
            vec![("a.vtt".to_string(), Some("eng".to_string()), 1), ("b.vtt".to_string(), None, 2)]
        );
        assert_eq!(drained.tracks, vec![("audio".to_string(), Some(3)), ("sub".to_string(), None)]);
        assert_eq!(drained.text_index, Some(Some(2)));

        // queues are consumed, not just read -- a second load's file-loaded
        // event must never re-apply a previous load's queued operations
        assert!(pending.loaded);
        assert_eq!(pending.start_seconds, 0.0);
        assert!(pending.queued_subtitle_adds.is_empty());
        assert!(pending.queued_tracks.is_empty());
        assert_eq!(pending.queued_text_index, None);
    }

    #[test]
    fn drain_with_nothing_queued_is_a_harmless_no_op() {
        let mut pending = PendingState::default();
        let drained = pending.drain();
        assert_eq!(drained.start_seconds, 0.0);
        assert!(drained.subtitle_adds.is_empty());
        assert!(drained.tracks.is_empty());
        assert_eq!(drained.text_index, None);
        assert!(pending.loaded);
    }

    #[test]
    fn text_track_off_is_distinct_from_nothing_queued() {
        // `Some(None)` ( = explicit "turn subs off") must survive drain and
        // not collapse into the "nothing was queued" `None` case.
        let mut pending = PendingState { queued_text_index: Some(None), ..Default::default() };
        assert_eq!(pending.drain().text_index, Some(None));
    }
}

// `surface`'s `Arc<Mutex<Box<dyn RenderSurface>>>` (below, on `MpvEngine`) is
// deliberately behind its *own* mutex, separate from `MpvState` (the
// Tauri-managed `Mutex<Option<MpvEngine>>` every command locks). Every other
// command (play/pause/seek/volume/select_track/...) only ever needs
// `MpvState` for a fast property-set; if the render surface instead lived
// directly on `MpvEngine` guarded only by that same lock, a slow *software*
// render frame (`mpv/mac/software.rs`'s doc: "very slow, everything on the
// CPU") would hold `MpvState` for the frame's whole duration and stall every
// other command behind it. `spawn_render_loop` (commands.rs) now only holds
// `MpvState` long enough to clone this handle out, then renders through this
// mutex instead -- so a slow frame only ever blocks another *render* (loop
// tick vs. `set_rect`), never a play/pause/seek/volume command.
//
// Teardown is explicit (`RenderSurface::teardown`, called from
// `MpvEngine::drop` while holding this same mutex) rather than left to
// `Drop`/refcounting: each backend's render context must be freed strictly
// before `mpv_terminate_destroy(mpv)`, and any render the loop thread has
// already started must be allowed to finish first, not raced. Locking this
// mutex from `drop` gets both for free (a concurrent `render()` holds the
// same lock for its duration), and nulling out the backend's render context
// inside `teardown` turns any `render()` call that acquires the lock *after*
// teardown (the loop thread had already cloned the handle before
// `MpvEngine` was dropped) into a safe no-op instead of a use-after-free.

/// Wakes `spawn_render_loop` as soon as mpv's own
/// `mpv_render_context_set_update_callback` reports a new frame is ready,
/// instead of the loop guessing on a fixed timer. mpv calls `notify()`
/// (via `on_render_update`, a plain C callback) from its own internal
/// thread; the render loop calls `wait` on its own thread. `timeout` in
/// `wait` is a safety net (e.g. the very first callback firing before the
/// loop starts waiting), not the normal wakeup path.
#[derive(Default)]
pub(crate) struct RenderWaker {
    ready: Mutex<bool>,
    cv: Condvar,
}

impl RenderWaker {
    fn notify(&self) {
        *self.ready.lock().unwrap() = true;
        self.cv.notify_one();
    }

    pub(crate) fn wait(&self, timeout: Duration) {
        let guard = self.ready.lock().unwrap();
        let (mut guard, _) = self.cv.wait_timeout_while(guard, timeout, |ready| !*ready).unwrap();
        *guard = false;
    }
}

// `cb_ctx` is `RenderWaker`'s address, set via `Arc::as_ptr` by whichever
// backend (`mpv/mac/software.rs`/`gpu.rs`) creates the mpv render context,
// and kept alive for exactly as long as that context can still call this
// (the callback is unregistered in `teardown`, before `MpvEngine`'s own
// `waker` field is dropped). `pub(crate)`: registered from `mpv/mac/`, not
// just this file.
pub(crate) unsafe extern "C" fn on_render_update(cb_ctx: *mut c_void) {
    let waker = unsafe { &*(cb_ctx as *const RenderWaker) };
    waker.notify();
}

pub struct MpvEngine {
    mpv: *mut mpv_handle,
    surface: Arc<Mutex<Box<dyn RenderSurface>>>,
    waker: Arc<RenderWaker>,
    stop: Arc<AtomicBool>,
    observer: Option<JoinHandle<()>>,
    // which backend `mac::attach` actually landed on -- surfaced to the
    // frontend (`mpv_attach`'s return value) for the player overlay's
    // CPU-fallback badge (issue #12); never used to branch behavior here.
    backend: Backend,
    // ponytail: `seek` and `select_track` (aid/sid) right after `loadfile`
    // both race the (async) load and fail/no-op — confirmed against raw mpv
    // IPC, not just this FFI layer: mpv_command('loadfile', ...) returns as
    // soon as it's *queued*, well before the file is actually demuxed and its
    // track-list populated. Queued here and applied by the observer thread on
    // MPV_EVENT_FILE_LOADED, when the core is actually ready to accept them.
    pending: Arc<Mutex<PendingState>>,
}

// The raw mpv handle is only ever touched from the main thread (commands,
// render ticks) and the dedicated observer thread, which mpv's C API allows.
unsafe impl Send for MpvEngine {}
unsafe impl Sync for MpvEngine {}

fn check(rc: i32, what: &str) -> Result<(), String> {
    if rc < 0 {
        let msg = unsafe { CStr::from_ptr(mpv_error_string(rc)).to_string_lossy() };
        return Err(format!("mpv error during {what}: {msg} ({rc})"));
    }
    Ok(())
}

// Silently no-ops (doesn't panic) on a key/value containing an embedded NUL,
// which CString::new rejects — our own call sites are static strings that
// never hit this, but the raw mpv-config passthrough (#9) is arbitrary user
// input, and a malformed line there must never crash playback.
unsafe fn set_option(mpv: *mut mpv_handle, name: &str, value: &str) {
    let (Ok(name), Ok(value)) = (CString::new(name), CString::new(value)) else {
        return;
    };
    unsafe {
        mpv_set_option_string(mpv, name.as_ptr(), value.as_ptr());
    }
}

unsafe fn observe(mpv: *mut mpv_handle, id: u64, name: &str, format: mpv_format) {
    let cname = CString::new(name).unwrap();
    unsafe {
        mpv_observe_property(mpv, id, cname.as_ptr(), format);
    }
}

// Free functions (not `&self` methods) so both `MpvEngine::select_track`
// (main thread, once loaded) and the observer thread (draining queued
// selections on MPV_EVENT_FILE_LOADED) can call them from just a raw handle.

fn get_property_int(mpv: *mut mpv_handle, name: &str) -> Result<i64, String> {
    let cname = CString::new(name).map_err(|e| e.to_string())?;
    let mut v: i64 = 0;
    unsafe {
        check(
            mpv_get_property(mpv, cname.as_ptr(), mpv_format_MPV_FORMAT_INT64, &mut v as *mut _ as *mut c_void),
            "mpv_get_property (int)",
        )?;
    }
    Ok(v)
}

fn get_property_string(mpv: *mut mpv_handle, name: &str) -> Result<String, String> {
    let cname = CString::new(name).map_err(|e| e.to_string())?;
    let mut ptr: *mut std::os::raw::c_char = std::ptr::null_mut();
    unsafe {
        check(
            mpv_get_property(mpv, cname.as_ptr(), mpv_format_MPV_FORMAT_STRING, &mut ptr as *mut _ as *mut c_void),
            "mpv_get_property (string)",
        )?;
        let s = CStr::from_ptr(ptr).to_string_lossy().into_owned();
        mpv_free(ptr as *mut c_void);
        Ok(s)
    }
}

// Resolves a (already static-stream-shift-corrected, see TS's
// `toDemuxedIndex`) source stream index to mpv's own track id for the given
// kind ("audio"/"sub"), via track-list's `ff-index` field -- confirmed
// against real mpv processes (flat `track-list/N/...` sub-properties, not
// the mpv_node array itself, to avoid hand-rolling node-tree parsing over
// FFI for this).
fn find_track_id(mpv: *mut mpv_handle, kind: &str, source_index: i64) -> Result<i64, String> {
    let count = get_property_int(mpv, "track-list/count")?;
    for i in 0..count {
        if get_property_string(mpv, &format!("track-list/{i}/type"))? != kind {
            continue;
        }
        if get_property_int(mpv, &format!("track-list/{i}/ff-index")).unwrap_or(-1) == source_index {
            return get_property_int(mpv, &format!("track-list/{i}/id"));
        }
    }
    Err(format!("select_track: no {kind} track with source index {source_index}"))
}

/// One row of `debug_track_list`'s dump -- deliberately loose/stringly-typed
/// (every field best-effort) since this exists purely to eyeball mpv's real
/// state from devtools when a subtitle silently doesn't render (added/
/// selected without error, but nothing shows): whether the track exists at
/// all, which one mpv thinks is selected, and what it thinks the track's
/// own format/title/lang is, all in one shot.
#[derive(Clone, serde::Serialize)]
pub struct TrackDebugInfo {
    pub id: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub selected: bool,
    pub codec: Option<String>,
    pub title: Option<String>,
    pub lang: Option<String>,
    pub ff_index: Option<i64>,
}

fn debug_track_list(mpv: *mut mpv_handle) -> Result<Vec<TrackDebugInfo>, String> {
    let count = get_property_int(mpv, "track-list/count")?;
    let mut out = Vec::new();
    for i in 0..count {
        let p = |field: &str| get_property_string(mpv, &format!("track-list/{i}/{field}"));
        out.push(TrackDebugInfo {
            id: get_property_int(mpv, &format!("track-list/{i}/id")).unwrap_or(-1),
            kind: p("type").unwrap_or_default(),
            selected: p("selected").map(|s| s == "yes").unwrap_or(false),
            codec: p("codec").ok(),
            title: p("title").ok(),
            lang: p("lang").ok(),
            ff_index: get_property_int(mpv, &format!("track-list/{i}/ff-index")).ok(),
        });
    }
    Ok(out)
}

// Issues the actual `sub-add` command and reads back mpv's assigned "sid".
// Free fn so both the main thread (add_subtitle, once loaded) and the
// observer thread (draining a queued add on MPV_EVENT_FILE_LOADED) can call
// it from a raw handle.
//
// ponytail: tried the documented approach first -- `sub-add ... auto` then
// reading its command_ret/mpv_node result, which the manual says carries
// the new track's id. Verified (against raw mpv IPC, not just this FFI
// layer) that this mpv build returns `null` there instead. `sub-add ...
// select` immediately makes the new track current, so reading the
// now-current "sid" property right after (mpv_command is synchronous -- it
// only returns once the command has been processed) reliably gives the
// right id. Momentarily selecting each track while mapping is harmless:
// callers always follow up with an explicit `set_text_track` for whichever
// one the user actually wants.
fn apply_add_subtitle(mpv: *mut mpv_handle, url: &str, lang: Option<&str>) -> Result<i64, String> {
    let lang = lang.unwrap_or("");
    let cstrs: Vec<CString> = ["sub-add", url, "select", "", lang].iter().map(|s| CString::new(*s).unwrap()).collect();
    let mut ptrs: Vec<*const std::os::raw::c_char> =
        cstrs.iter().map(|s| s.as_ptr()).chain(std::iter::once(std::ptr::null())).collect();
    unsafe {
        check(mpv_command(mpv, ptrs.as_mut_ptr()), "mpv_command")?;
    }
    get_property_int(mpv, "sid")
}

// Sets/clears the text-subtitle track by mpv's own "sid" (resolved from a
// Jellyfin index by the two callers below). Free fn so both the main thread
// (once loaded) and the observer thread (draining a queued selection on
// MPV_EVENT_FILE_LOADED) can call it from a raw handle -- same pattern as
// apply_select_track.
fn apply_set_text_track(mpv: *mut mpv_handle, sid: Option<i64>) -> Result<(), String> {
    let name = CString::new("sid").unwrap();
    unsafe {
        match sid {
            Some(id) => {
                let mut v = id;
                check(
                    mpv_set_property(mpv, name.as_ptr(), mpv_format_MPV_FORMAT_INT64, &mut v as *mut _ as *mut c_void),
                    "mpv_set_property (sid)",
                )
            }
            None => {
                let no = CString::new("no").unwrap();
                check(mpv_set_property_string(mpv, name.as_ptr(), no.as_ptr()), "mpv_set_property_string (sid=no)")
            }
        }
    }
}

// Builds and sends a raw mpv_command from a handle -- free fn so the
// observer thread (which only has the raw handle, not an MpvEngine) can
// fire commands the same way MpvEngine::command does for &self call sites.
// Fire-and-forget: callers here already treat failures as best-effort (a
// missing tonemap label to remove is not an error worth surfacing).
fn raw_command(mpv: *mut mpv_handle, args: &[&str]) {
    let cstrs: Vec<CString> = args.iter().map(|s| CString::new(*s).unwrap()).collect();
    let mut ptrs: Vec<*const std::os::raw::c_char> =
        cstrs.iter().map(|s| s.as_ptr()).chain(std::iter::once(std::ptr::null())).collect();
    unsafe {
        mpv_command(mpv, ptrs.as_mut_ptr());
    }
}

const HDR_TONEMAP_LABEL: &str = "phtonemap";

// MPV_RENDER_API_TYPE_SW has no tone-mapping of its own -- confirmed in
// mpv's own render.h: "certain multimedia job creation measures like HDR may
// not work properly, and will have to be manually handled by for example
// inserting filters." Its only pixel formats are 8-bit RGB (rgb0/bgr0/0bgr/
// 0rgb), so real EDR/wide-gamut HDR display is out of reach on this render
// path regardless (would need the GPU render API, ruled out in ADR-0005 for
// the NSOpenGLView transparency bug) -- but PQ/HLG values reaching that 8-bit
// RGB output *unmapped* would show blown-out/wrong colors, which this closes.
//
// Standard ffmpeg zscale+tonemap recipe (linear -> tonemap -> bt.709), the
// same one widely used for HDR playback on any non-libplacebo pipeline.
// `--tone-mapping` and friends (mpv's own built-in option family) are
// explicitly gpu/gpu-next only per mpv's docs and do nothing on this render
// path, hence going through a manual `--vf=lavfi=[...]` filter instead, per
// the render.h note above.
//
// Gated on the decoded stream's actual transfer function ("gamma": "pq" or
// "hlg") rather than applied unconditionally, so SDR playback -- the common
// case -- pays zero extra cost on top of an already CPU-bound render path.
// `active` tracks whether the filter is currently applied so a same-range
// property re-fire (e.g. a seek) doesn't redundantly add/remove it.
//
// ponytail: verified against mpv's documented API and the standard community
// filter recipe, not against a real HDR display/file (none available in this
// sandbox) -- smoke-test with a real HDR10/HLG source before relying on this.
fn apply_hdr_tonemap(mpv: *mut mpv_handle, gamma: &str, active: &mut bool) {
    let is_hdr = gamma == "pq" || gamma == "hlg";
    if is_hdr == *active {
        return;
    }
    *active = is_hdr;
    if is_hdr {
        let filter = format!(
            "@{HDR_TONEMAP_LABEL}:lavfi=[zscale=transfer=linear:npl=100,format=gbrpf32le,zscale=primaries=bt709,tonemap=hable,zscale=transfer=bt709:matrix=bt709,format=yuv420p]"
        );
        raw_command(mpv, &["vf", "add", &filter]);
    } else {
        raw_command(mpv, &["vf", "remove", &format!("@{HDR_TONEMAP_LABEL}")]);
    }
}

fn apply_select_track(mpv: *mut mpv_handle, kind: &str, source_index: Option<i64>) -> Result<(), String> {
    let prop = match kind {
        "audio" => "aid",
        "sub" => "sid",
        _ => return Err(format!("select_track: unknown kind {kind}")),
    };
    let name = CString::new(prop).unwrap();
    match source_index {
        Some(idx) => {
            let id = find_track_id(mpv, kind, idx)?;
            let mut v = id;
            unsafe {
                check(
                    mpv_set_property(mpv, name.as_ptr(), mpv_format_MPV_FORMAT_INT64, &mut v as *mut _ as *mut c_void),
                    "mpv_set_property (track select)",
                )
            }
        }
        None => {
            let no = CString::new("no").unwrap();
            unsafe { check(mpv_set_property_string(mpv, name.as_ptr(), no.as_ptr()), "mpv_set_property_string (track off)") }
        }
    }
}

impl MpvEngine {
    pub fn attach<R: Runtime>(
        app: &AppHandle<R>,
        window: &WebviewWindow<R>,
        extra_config: &[(String, String)],
    ) -> Result<Self, String> {
        // # Safety: `ns_window()` hands back a raw, non-owning `NSWindow*`
        // (the window itself keeps ownership). Neither this cast nor the
        // `mpv/mac/` backends' own `NSView::alloc` check main-thread
        // affinity -- `attach`'s whole call chain (from the `mpv_attach`
        // Tauri command down) never did on cocoa/objc 0.2.x either;
        // preserved as-is rather than adding a new runtime check as a
        // drive-by part of the objc2 migration (ADR-0009).
        let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())?;
        let ns_window: &NSWindow = unsafe { &*(ns_window_ptr as *const NSWindow) };
        let content_view = ns_window.contentView().ok_or("no content view")?;

        unsafe {
            let mpv = mpv_create();
            if mpv.is_null() {
                return Err("mpv_create failed".into());
            }

            set_option(mpv, "vo", "libmpv");
            set_option(mpv, "osc", "no");
            set_option(mpv, "osd-level", "0");
            set_option(mpv, "keep-open", "yes");
            // "-copy" hwdec modes decode on the hardware decoder, then copy
            // the frame back into plain system RAM -- unlike plain
            // `videotoolbox` (mpv's own docs: requires --vo=gpu/gpu-next),
            // the copy variants aren't listed as needing a GPU vo, which is
            // the whole point: the sw render API below consumes the copied
            // CPU frame like any other. `auto-copy` picks the right one per
            // platform from mpv's own actively-supported whitelist. Real CPU/
            // battery win, especially for 4K HEVC/AV1 -- mpv's own docs call
            // out that class of content as sometimes needing hw decoding to
            // keep up at all.
            set_option(mpv, "hwdec", "auto-copy");
            set_option(mpv, "terminal", "no");
            set_option(mpv, "input-default-bindings", "no");
            set_option(mpv, "input-vo-keyboard", "no");
            // mpv's own default (`auto-safe`) forces stereo whenever the OS
            // doesn't report an explicit system-preferred layout -- not
            // guaranteed even when routed to a real AVR/soundbar over HDMI,
            // per mpv's own HDMI warning under --audio-channels. Explicit
            // whitelist lets genuine 5.1/7.1/Atmos-bed sources reach the
            // output instead of always getting silently downmixed.
            set_option(mpv, "audio-channels", "7.1,5.1,stereo");
            // only affects a downmix that still happens (e.g. a stereo-only
            // output device) -- avoids clipping there (default: no)
            set_option(mpv, "audio-normalize-downmix", "yes");

            // Sane default subtitle appearance (issue #9): outlined text, no
            // background box, legible at a normal viewing distance without any
            // settings UI. PiP lands in #8.
            set_option(mpv, "sub-font-size", "48");
            set_option(mpv, "sub-color", "#FFFFFFFF");
            set_option(mpv, "sub-border-color", "#FF000000");
            set_option(mpv, "sub-border-size", "2.5");
            set_option(mpv, "sub-back-color", "#00000000");
            set_option(mpv, "sub-shadow-offset", "0");

            // Raw mpv-config passthrough (issue #9): applied after the
            // defaults above, so the user's values win for whatever keys they
            // set. This is deliberately unsandboxed — a power-user field, not
            // exposed to normal users; someone pasting e.g. `osc=yes` can
            // reintroduce mpv's own OSC, which is an accepted risk of "raw
            // passthrough", not a bug.
            for (key, value) in extra_config {
                set_option(mpv, key, value);
            }

            check(mpv_initialize(mpv), "mpv_initialize")?;

            let waker = Arc::new(RenderWaker::default());
            // Owns picking + creating the actual render context (SW vs GL
            // params differ), the GPU-vs-CPU fallback decision, and
            // registering `on_render_update` against whichever it picked --
            // see `mac::attach`'s doc.
            let (surface, backend) = mac::attach(mpv, &content_view, &waker)?;
            let surface = Arc::new(Mutex::new(surface));

            observe(mpv, 1, "time-pos", mpv_format_MPV_FORMAT_DOUBLE);
            observe(mpv, 2, "pause", mpv_format_MPV_FORMAT_FLAG);
            observe(mpv, 3, "duration", mpv_format_MPV_FORMAT_DOUBLE);
            observe(mpv, 4, "core-idle", mpv_format_MPV_FORMAT_FLAG);
            observe(mpv, 5, "demuxer-cache-time", mpv_format_MPV_FORMAT_DOUBLE);
            observe(mpv, 6, "volume", mpv_format_MPV_FORMAT_DOUBLE);
            observe(mpv, 7, "mute", mpv_format_MPV_FORMAT_FLAG);
            // drives the HDR tonemap filter (see apply_hdr_tonemap) -- the
            // decoder's *actual* transfer function only becomes known once
            // decoding starts, unlike track-list metadata available right at
            // FILE_LOADED, so this needs its own observed property rather
            // than a synchronous read in the FILE_LOADED handler.
            observe(mpv, 8, "video-params/gamma", mpv_format_MPV_FORMAT_STRING);

            let stop = Arc::new(AtomicBool::new(false));
            let pending = Arc::new(Mutex::new(PendingState::default()));
            let observer = spawn_observer(app.clone(), mpv, stop.clone(), pending.clone());

            Ok(Self {
                mpv,
                surface,
                waker,
                stop,
                observer: Some(observer),
                backend,
                pending,
            })
        }
    }

    /// Clone of the render-surface handle, for `spawn_render_loop`
    /// (commands.rs) to hold *instead of* `MpvState`'s lock while it
    /// actually renders -- see `RenderSurface`'s doc.
    pub(crate) fn render_surface(&self) -> Arc<Mutex<Box<dyn RenderSurface>>> {
        Arc::clone(&self.surface)
    }

    /// Clone of the render-waker handle, for `spawn_render_loop` to block on
    /// instead of a fixed sleep -- see `RenderWaker`'s doc.
    pub(crate) fn render_waker(&self) -> Arc<RenderWaker> {
        Arc::clone(&self.waker)
    }

    /// "gpu" or "cpu" -- which backend `attach` actually landed on (ADR-0009).
    /// Surfaced through the `mpv_attach` command's return value.
    pub fn render_backend(&self) -> &'static str {
        self.backend.as_str()
    }

    fn command(&self, args: &[&str]) -> Result<(), String> {
        let cstrs: Vec<CString> = args.iter().map(|s| CString::new(*s).unwrap()).collect();
        let mut ptrs: Vec<*const std::os::raw::c_char> =
            cstrs.iter().map(|s| s.as_ptr()).chain(std::iter::once(std::ptr::null())).collect();
        unsafe { check(mpv_command(self.mpv, ptrs.as_mut_ptr()), "mpv_command") }
    }

    pub fn load(&self, url: &str, start_seconds: f64) -> Result<(), String> {
        // fresh load, fresh wait-for-loaded state — anything queued for the
        // *previous* file (if this interrupts an in-flight load) is stale
        *self.pending.lock().unwrap() = PendingState { start_seconds, ..Default::default() };
        self.command(&["loadfile", url, "replace"])
    }

    pub fn play(&self) -> Result<(), String> {
        unsafe { self.set_flag("pause", false) }
    }

    pub fn pause(&self) -> Result<(), String> {
        unsafe { self.set_flag("pause", true) }
    }

    pub fn seek(&self, seconds: f64) -> Result<(), String> {
        self.command(&["seek", &seconds.to_string(), "absolute"])
    }

    pub fn set_rate(&self, rate: f64) -> Result<(), String> {
        unsafe { self.set_double("speed", rate) }
    }

    pub fn set_volume(&self, volume: f64) -> Result<(), String> {
        unsafe { self.set_double("volume", (volume.clamp(0.0, 1.0)) * 100.0) }
    }

    pub fn set_muted(&self, muted: bool) -> Result<(), String> {
        unsafe { self.set_flag("mute", muted) }
    }

    /// Adds an external text subtitle (server-delivered VTT/SRT URL — mpv
    /// fetches it itself via its own HTTP stack, so unlike the browser this
    /// has no CORS restriction, no subtitle_fetch proxy needed here).
    /// `index` is the caller's own key (Jellyfin's stream index) for later
    /// reselection via `set_text_track`.
    ///
    /// Deferred to MPV_EVENT_FILE_LOADED exactly like `select_track`/
    /// `set_text_track` below -- confirmed against raw mpv IPC that a
    /// `sub-add` issued between `loadfile` returning (queued, not yet
    /// demuxed) and the core actually opening the new file can silently
    /// fail or get wiped once that open settles: the external track never
    /// showed up in the post-load track-list at all. Queued when `!loaded`,
    /// applied by the observer thread once the core is ready, same pattern
    /// as the other deferred ops -- `text_track_ids` (index -> mpv "sid")
    /// is populated there or here, whichever actually runs the add.
    pub fn add_subtitle(&self, url: &str, lang: Option<&str>, index: i64) -> Result<(), String> {
        let mut pending = self.pending.lock().unwrap();
        if !pending.loaded {
            pending.queued_subtitle_adds.push((url.to_string(), lang.map(str::to_string), index));
            return Ok(());
        }
        drop(pending);
        let sid = apply_add_subtitle(self.mpv, url, lang)?;
        self.pending.lock().unwrap().text_track_ids.insert(index, sid);
        Ok(())
    }

    /// `index`: the Jellyfin stream index passed to `add_subtitle`, or
    /// `None` to disable subs. Resolved against `text_track_ids` (populated
    /// as each `add_subtitle` actually lands) into mpv's own "sid" --
    /// callers only ever know the Jellyfin side of that mapping.
    ///
    /// Deferred to MPV_EVENT_FILE_LOADED exactly like `select_track` and
    /// `seek`: mpv runs its automatic default-subtitle selection as *part of*
    /// the async file load, so setting `sid` right after `loadfile` races that
    /// autoselect -- if FILE_LOADED fires after this call, mpv clobbers the
    /// chosen external sub. Queued when `!loaded` and applied by the observer
    /// thread once the core is ready, after autoselect *and* any queued
    /// `add_subtitle` calls have run.
    pub fn set_text_track(&self, index: Option<i64>) -> Result<(), String> {
        let mut pending = self.pending.lock().unwrap();
        if !pending.loaded {
            pending.queued_text_index = Some(index);
            return Ok(());
        }
        let sid = match index {
            None => None,
            Some(idx) => Some(
                *pending
                    .text_track_ids
                    .get(&idx)
                    .ok_or_else(|| format!("set_text_track: unknown subtitle index {idx}"))?,
            ),
        };
        drop(pending);
        apply_set_text_track(self.mpv, sid)
    }

    pub fn set_subtitle_delay(&self, seconds: f64) -> Result<(), String> {
        unsafe { self.set_double("sub-delay", seconds) }
    }

    /// Selects an *embedded* audio or subtitle track by the media's own
    /// stream index, already corrected for Jellyfin's static-stream subtitle
    /// stripping (see `toDemuxedIndex` on the TS side) -- `kind` is
    /// `"audio"` or `"sub"`. `None` disables that track type entirely.
    ///
    /// Since playback is always direct play now (ADR-0008: no client-side
    /// transcode forcing), every audio/subtitle track Jellyfin reports is
    /// already embedded in the exact file mpv is demuxing -- no separate
    /// server request needed to switch, unlike the old HTML5 engine (which
    /// could only ever play a container's single default audio track, and
    /// could only show non-text subtitles by asking the server to burn them
    /// into transcoded pixels).
    ///
    /// If the file mpv is currently playing hasn't finished loading yet
    /// (MPV_EVENT_FILE_LOADED not fired), this queues the request instead of
    /// applying it immediately -- confirmed against raw mpv IPC that
    /// selecting a track right after `loadfile` returns races the (async)
    /// load: `track-list` is empty/incomplete at that point, so resolution
    /// silently fails. The observer thread drains the queue once loaded,
    /// same pattern as the pre-existing seek deferral.
    pub fn select_track(&self, kind: &str, source_index: Option<i64>) -> Result<(), String> {
        let mut pending = self.pending.lock().unwrap();
        if !pending.loaded {
            pending.queued_tracks.push((kind.to_string(), source_index));
            return Ok(());
        }
        drop(pending);
        apply_select_track(self.mpv, kind, source_index)
    }

    /// Debug-only dump of mpv's real track-list -- see `TrackDebugInfo`'s doc.
    pub fn debug_track_list(&self) -> Result<Vec<TrackDebugInfo>, String> {
        debug_track_list(self.mpv)
    }

    unsafe fn set_flag(&self, name: &str, value: bool) -> Result<(), String> {
        let cname = CString::new(name).unwrap();
        let mut v: std::os::raw::c_int = if value { 1 } else { 0 };
        unsafe {
            check(
                mpv_set_property(self.mpv, cname.as_ptr(), mpv_format_MPV_FORMAT_FLAG, &mut v as *mut _ as *mut c_void),
                "mpv_set_property (flag)",
            )
        }
    }

    unsafe fn set_double(&self, name: &str, value: f64) -> Result<(), String> {
        let cname = CString::new(name).unwrap();
        let mut v = value;
        unsafe {
            check(
                mpv_set_property(self.mpv, cname.as_ptr(), mpv_format_MPV_FORMAT_DOUBLE, &mut v as *mut _ as *mut c_void),
                "mpv_set_property (double)",
            )
        }
    }

    /// Repositions the surface to the given content-view-local rect (points,
    /// top-left origin, matching `getBoundingClientRect()`), or hides it
    /// entirely when the placeholder isn't visible/mounted.
    pub fn set_rect(&self, x: f64, y_top_left: f64, w: f64, h: f64) {
        self.surface.lock().unwrap().set_rect(x, y_top_left, w, h);
    }
}

impl Drop for MpvEngine {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // wakes mpv_wait_event in the observer thread so it notices `stop`
        // and exits before we free anything it might still be touching
        let _ = self.command(&["quit"]);
        if let Some(h) = self.observer.take() {
            let _ = h.join();
        }
        // Locking here blocks until any render the loop thread already
        // started (it may be holding a cloned handle from before this drop
        // began) finishes -- only then is it safe to free render_ctx/view,
        // strictly before mpv_terminate_destroy below (see the struct doc).
        self.surface.lock().unwrap().teardown();
        unsafe {
            mpv_terminate_destroy(self.mpv);
        }
    }
}

fn spawn_observer<R: Runtime>(
    app: AppHandle<R>,
    mpv: *mut mpv_handle,
    stop: Arc<AtomicBool>,
    pending: Arc<Mutex<PendingState>>,
) -> JoinHandle<()> {
    // Safety: `mpv` outlives this thread — MpvEngine::drop() signals `stop`,
    // sends "quit" (unblocking mpv_wait_event with MPV_EVENT_SHUTDOWN), and
    // joins this thread *before* freeing the render context/mpv handle.
    let mpv_addr = mpv as usize;
    std::thread::spawn(move || {
        let mpv = mpv_addr as *mut mpv_handle;
        let mut tick = Tick::default();
        let mut hdr_tonemap_active = false;
        loop {
            if stop.load(Ordering::SeqCst) {
                return;
            }
            let ev = unsafe { &*mpv_wait_event(mpv, 1.0) };
            match ev.event_id {
                x if x == mpv_event_id_MPV_EVENT_SHUTDOWN => return,
                x if x == mpv_event_id_MPV_EVENT_PROPERTY_CHANGE => {
                    let prop = unsafe { &*(ev.data as *const mpv_event_property) };
                    let name = unsafe { CStr::from_ptr(prop.name).to_string_lossy() };
                    if prop.data.is_null() {
                        continue;
                    }
                    if name == "video-params/gamma" {
                        let ptr = unsafe { *(prop.data as *const *const std::os::raw::c_char) };
                        if !ptr.is_null() {
                            let gamma = unsafe { CStr::from_ptr(ptr).to_string_lossy() };
                            apply_hdr_tonemap(mpv, &gamma, &mut hdr_tonemap_active);
                        }
                        continue; // not part of Tick, no UI event needed
                    }
                    match name.as_ref() {
                        "time-pos" => tick.time = unsafe { *(prop.data as *const f64) },
                        "duration" => tick.duration = unsafe { *(prop.data as *const f64) },
                        "pause" => tick.paused = unsafe { *(prop.data as *const std::os::raw::c_int) != 0 },
                        "core-idle" => tick.core_idle = unsafe { *(prop.data as *const std::os::raw::c_int) != 0 },
                        "demuxer-cache-time" => tick.buffered = unsafe { *(prop.data as *const f64) },
                        "volume" => tick.volume = unsafe { *(prop.data as *const f64) } / 100.0,
                        "mute" => tick.muted = unsafe { *(prop.data as *const std::os::raw::c_int) != 0 },
                        _ => continue,
                    }
                    let _ = app.emit("mpv://tick", tick.clone());
                }
                x if x == mpv_event_id_MPV_EVENT_FILE_LOADED => {
                    let drained = pending.lock().unwrap().drain();
                    if drained.start_seconds > 0.0 {
                        let args = ["seek", &drained.start_seconds.to_string(), "absolute"];
                        let cstrs: Vec<CString> =
                            args.iter().map(|s| CString::new(*s).unwrap()).collect();
                        let mut ptrs: Vec<*const std::os::raw::c_char> = cstrs
                            .iter()
                            .map(|s| s.as_ptr())
                            .chain(std::iter::once(std::ptr::null()))
                            .collect();
                        unsafe {
                            mpv_command(mpv, ptrs.as_mut_ptr());
                        }
                    }
                    // adds first -- queued_text_index below resolves against
                    // whatever lands in `text_track_ids` here
                    for (url, lang, index) in drained.subtitle_adds {
                        if let Ok(sid) = apply_add_subtitle(mpv, &url, lang.as_deref()) {
                            pending.lock().unwrap().text_track_ids.insert(index, sid);
                        }
                    }
                    for (kind, source_index) in drained.tracks {
                        let _ = apply_select_track(mpv, &kind, source_index);
                    }
                    // after autoselect + any embedded-track selection above,
                    // so a chosen external text sub wins the load-time race
                    if let Some(index) = drained.text_index {
                        let sid = match index {
                            None => None,
                            Some(idx) => pending.lock().unwrap().text_track_ids.get(&idx).copied(),
                        };
                        let _ = apply_set_text_track(mpv, sid);
                    }
                }
                x if x == mpv_event_id_MPV_EVENT_END_FILE => {
                    let end = unsafe { &*(ev.data as *const mpv_event_end_file) };
                    if end.reason == mpv_end_file_reason_MPV_END_FILE_REASON_EOF as i32 {
                        let _ = app.emit("mpv://ended", ());
                    } else if end.reason == mpv_end_file_reason_MPV_END_FILE_REASON_ERROR as i32 {
                        let msg = unsafe { CStr::from_ptr(mpv_error_string(end.error)).to_string_lossy() };
                        let _ = app.emit("mpv://error", msg.to_string());
                    }
                }
                _ => {}
            }
        }
    })
}
