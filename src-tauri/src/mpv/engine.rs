//! In-process libmpv render-API engine (ADR-0003/0005/0009), platform-agnostic half: mpv lifecycle, command dispatch, pending-operations queue, tick/property observation. Actual GL/Metal calls live behind `RenderSurface` (ADR-0009) -- this file never learns which backend is active or that a GPU->CPU fallback happened.
//! Render loop (`spawn_render_loop`) wakes on mpv's own update callback (`RenderWaker`) instead of a fixed timer -- not a real vsync lock, that's further per-platform work not done here.

use super::backend;
use super::surface::{Backend, RenderSurface};
use libmpv_sys::*;
use raw_window_handle::{HasDisplayHandle, HasWindowHandle};
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

/// The Playback Info panel's genuinely-dynamic fields (ADR-0011) -- everything else in that panel
/// (codec, resolution, container, file size...) reads the `MediaSource`/`MediaStream` Photon already
/// fetched from Jellyfin, since direct play (ADR-0008) guarantees mpv demuxes that exact file. These six
/// are only knowable from mpv itself, and only meaningfully once a file is loaded and playing -- polled
/// on demand (`stats()`/`mpv_stats`) rather than observed, since the panel is opened rarely and doesn't
/// need per-tick updates like time/duration do.
#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")] // frontend's PlaybackStats (engine.ts) reads these camelCase, unlike Tick's fields above
pub struct MpvStats {
    pub hwdec_current: String,
    pub decoder_dropped_frames: i64,
    pub display_dropped_frames: i64,
    pub demuxer_cache_duration: f64, // seconds
    pub cache_speed: f64,            // bytes/sec
    pub av_sync: f64,                // seconds, +audio ahead of video
}

#[derive(Default)]
struct PendingState {
    loaded: bool, // has MPV_EVENT_FILE_LOADED fired for the current load() yet
    start_seconds: f64,
    queued_tracks: Vec<(String, Option<i64>)>, // (kind, source_index) selected before `loaded`
    queued_text_index: Option<Option<i64>>,    // set_text_track called before `loaded`; latest wins
    queued_subtitle_adds: Vec<(String, Option<String>, i64)>, // (url, lang, jellyfin index) added before `loaded`
    text_track_ids: HashMap<i64, i64>, // jellyfin stream index -> mpv's own "sid"
}

/// Everything queued before `loaded`, moved out in the order `spawn_observer`'s FILE_LOADED handler applies: seek, subtitle adds, embedded track selection, then text-track last (wins the race against mpv's autoselect). Pure data move, no FFI -- unit-tested directly below.
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

        // queues are consumed, not just read -- a second load's file-loaded event must never replay this one's
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
        // `Some(None)` (explicit "turn subs off") must not collapse into the "nothing queued" `None` case.
        let mut pending = PendingState { queued_text_index: Some(None), ..Default::default() };
        assert_eq!(pending.drain().text_index, Some(None));
    }
}

// `surface`'s mutex is separate from `MpvState`'s so a slow software-render frame never stalls play/pause/seek/volume; teardown is explicit (from MpvEngine::drop) so the render context frees strictly before mpv_terminate_destroy, and nulling it makes a post-teardown render() a safe no-op.

/// Wakes `spawn_render_loop` as soon as mpv reports a new frame ready, instead of a fixed timer. mpv calls
/// `notify()` (via `on_render_update`) from its own thread; `wait`'s timeout is just a safety net.
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

// `cb_ctx` is `RenderWaker`'s address (via `Arc::as_ptr`), kept alive as long as the render context can
// call this -- unregistered in `teardown` before `waker` drops. pub(crate): registered from mpv/mac/ too.
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
    backend: Backend, // which backend attach() landed on -- surfaced via mpv_attach for the CPU-fallback badge (#12)
    // ponytail: seek/select_track right after loadfile race the async load and fail/no-op (confirmed
    // against raw mpv IPC). Queued here, applied by the observer thread once FILE_LOADED fires.
    pending: Arc<Mutex<PendingState>>,
}

// Raw mpv handle only touched from the main thread (commands, render ticks) and the observer thread -- mpv's C API allows this.
unsafe impl Send for MpvEngine {}
unsafe impl Sync for MpvEngine {}

fn check(rc: i32, what: &str) -> Result<(), String> {
    if rc < 0 {
        let msg = unsafe { CStr::from_ptr(mpv_error_string(rc)).to_string_lossy() };
        return Err(format!("mpv error during {what}: {msg} ({rc})"));
    }
    Ok(())
}

// Silently no-ops on a key/value with an embedded NUL (CString::new rejects it) and on any mpv rejection --
// the raw mpv-config passthrough (#9) is arbitrary user input (typo'd key, bad value for this mpv build)
// and must never crash or spam logs over it. Built-in, playback-critical options use set_option_checked
// below instead -- those are Photon's own hardcoded values, a failure there is a real bug worth seeing.
unsafe fn set_option(mpv: *mut mpv_handle, name: &str, value: &str) {
    let (Ok(name), Ok(value)) = (CString::new(name), CString::new(value)) else {
        return;
    };
    unsafe {
        mpv_set_option_string(mpv, name.as_ptr(), value.as_ptr());
    }
}

// Same as `set_option`, but logs any failure instead of swallowing it -- for Photon's own built-in options
// (vo, hwdec, subtitle defaults, ...) where a rejection means a real bug (typo, an option renamed/removed
// in a newer mpv), not user-supplied config that's expected to sometimes be wrong.
unsafe fn set_option_checked(mpv: *mut mpv_handle, name: &str, value: &str) {
    let (Ok(cname), Ok(cvalue)) = (CString::new(name), CString::new(value)) else {
        eprintln!("mpv: built-in option {name}={value} has an embedded NUL, skipped");
        return;
    };
    let rc = unsafe { mpv_set_option_string(mpv, cname.as_ptr(), cvalue.as_ptr()) };
    if rc < 0 {
        let msg = unsafe { CStr::from_ptr(mpv_error_string(rc)).to_string_lossy() };
        eprintln!("mpv: failed to set built-in option {name}={value}: {msg} ({rc})");
    }
}

/// Where `screenshot` should write. XDG user dir if it exists (no extra dependency to read
/// user-dirs.dirs -- `~/Pictures` is the default in every distro that ships one), else the temp dir.
fn screenshot_directory() -> String {
    if let Some(home) = std::env::var_os("HOME") {
        let pictures = std::path::Path::new(&home).join("Pictures");
        if pictures.is_dir() {
            return pictures.to_string_lossy().into_owned();
        }
        if !home.is_empty() {
            return home.to_string_lossy().into_owned();
        }
    }
    std::env::temp_dir().to_string_lossy().into_owned()
}

unsafe fn observe(mpv: *mut mpv_handle, id: u64, name: &str, format: mpv_format) {
    let cname = CString::new(name).unwrap();
    unsafe {
        mpv_observe_property(mpv, id, cname.as_ptr(), format);
    }
}

// Free functions so both MpvEngine::select_track (main thread) and the observer thread (draining queued
// selections on FILE_LOADED) can call them from just a raw handle.

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

fn get_property_double(mpv: *mut mpv_handle, name: &str) -> Result<f64, String> {
    let cname = CString::new(name).map_err(|e| e.to_string())?;
    let mut v: f64 = 0.0;
    unsafe {
        check(
            mpv_get_property(mpv, cname.as_ptr(), mpv_format_MPV_FORMAT_DOUBLE, &mut v as *mut _ as *mut c_void),
            "mpv_get_property (double)",
        )?;
    }
    Ok(v)
}

// Resolves a (already static-stream-shift-corrected, see TS's `toDemuxedIndex`) source stream index to
// mpv's own track id, via track-list's `ff-index` field (flat sub-properties, avoids hand-rolling node-tree parsing over FFI).
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

// Issues `sub-add`, reads back mpv's assigned "sid" (documented `command_ret` returns null on this build); caller restores prior selection right after to avoid a visible flicker.
fn apply_add_subtitle(mpv: *mut mpv_handle, url: &str, lang: Option<&str>) -> Result<i64, String> {
    let lang = lang.unwrap_or("");
    let previous: Option<i64> = match get_property_string(mpv, "sid") {
        Ok(s) if s != "no" => s.parse().ok(),
        _ => None,
    };
    let cstrs: Vec<CString> = ["sub-add", url, "select", "", lang].iter().map(|s| CString::new(*s).unwrap()).collect();
    let mut ptrs: Vec<*const std::os::raw::c_char> =
        cstrs.iter().map(|s| s.as_ptr()).chain(std::iter::once(std::ptr::null())).collect();
    unsafe {
        check(mpv_command(mpv, ptrs.as_mut_ptr()), "mpv_command")?;
    }
    let sid = get_property_int(mpv, "sid")?;
    let _ = apply_set_text_track(mpv, previous); // best-effort restore
    Ok(sid)
}

// Sets/clears the text-subtitle track by mpv's "sid" (resolved from a Jellyfin index by callers below).
// Free fn, same pattern as apply_select_track.
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

// Turns a plain arg list into the null-terminated *const c_char array mpv_command expects, keeping the
// backing CStrings alive alongside (pointers are only valid as long as their CString does).
fn command_args(args: &[&str]) -> (Vec<CString>, Vec<*const std::os::raw::c_char>) {
    let cstrs: Vec<CString> = args.iter().map(|s| CString::new(*s).unwrap()).collect();
    let ptrs = cstrs.iter().map(|s| s.as_ptr()).chain(std::iter::once(std::ptr::null())).collect();
    (cstrs, ptrs)
}

// Builds and sends a raw mpv_command from a handle -- lets the observer thread (no MpvEngine, just the
// raw handle) fire commands the same way MpvEngine::command does. Fire-and-forget.
fn raw_command(mpv: *mut mpv_handle, args: &[&str]) {
    let (_cstrs, mut ptrs) = command_args(args);
    unsafe {
        mpv_command(mpv, ptrs.as_mut_ptr());
    }
}

const HDR_TONEMAP_LABEL: &str = "phtonemap";

// GPU render path (WGL/GLX/Metal) is mpv's normal gpu-next shader renderer, same as any vo=gpu build --
// it tone-maps HDR->SDR on its own GPU shaders for free once told the display is SDR (see
// target-trc/target-prim/tone-mapping options set in attach() below, once at init). Only the CPU/software render fallback
// (mac/software.rs) is a raw 8-bit blit with no color management of its own -- *that* path is what this
// manual ffmpeg zscale+tonemap CPU filter exists for. Confirmed by measurement (issue: HDR10 stutter on
// Windows/Intel iGPU) that running this CPU filter unconditionally, even alongside a perfectly fine GPU
// render backend, was the actual stutter source -- gated on `cpu_backend` below so the GPU path never pays it.
fn apply_hdr_tonemap(mpv: *mut mpv_handle, gamma: &str, active: &mut bool, cpu_backend: bool) {
    let is_hdr = gamma == "pq" || gamma == "hlg";
    if is_hdr == *active {
        return;
    }
    *active = is_hdr;
    if !cpu_backend {
        return; // GPU renderer already tone-maps via attach()'s target-trc/tone-mapping properties
    }
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
        // Platform-agnostic handle -- this file never imports an AppKit/Win32/X11 type directly; `backend` does its own raw-handle unwrapping internally.
        let raw_handle = window.window_handle().map_err(|e| e.to_string())?.as_raw();
        // Only linux/wayland.rs (issue #27) actually needs this (wl_display, alongside the window handle's wl_surface) -- mac/windows ignore it.
        let raw_display_handle = window.display_handle().map_err(|e| e.to_string())?.as_raw();

        unsafe {
            // LC_NUMERIC=C (libmpv's requirement) is set once from lib.rs's `run`, on the main thread
            // before GTK/WebKit exist -- setlocale is process-global and not thread-safe, so doing it
            // here (a Tauri worker thread, with the UI already running) raced every locale-dependent
            // call in the toolkit. It also has to be spelled portably: `*const i8` doesn't compile on
            // aarch64 Linux, where c_char is unsigned.
            let mpv = mpv_create();
            if mpv.is_null() {
                return Err("mpv_create failed".into());
            }

            set_option_checked(mpv, "vo", "libmpv");
            set_option_checked(mpv, "osc", "no");
            set_option_checked(mpv, "osd-level", "0");
            set_option_checked(mpv, "keep-open", "yes");
            // "-copy" hwdec modes decode on hardware then copy back to system RAM -- unlike plain videotoolbox
            // (requires --vo=gpu/gpu-next), copy variants don't need a GPU vo, so the sw render API can
            // consume the CPU frame like any other. Real CPU/battery win, especially for 4K HEVC/AV1.
            set_option_checked(mpv, "hwdec", "auto-copy");
            set_option_checked(mpv, "terminal", "no");
            // mpv's own warnings/errors are the only clue for "video is black" / "file won't play" bug
            // reports; without this nothing from the core ever reaches us (terminal output is off, and a
            // bundled app has no console anyway). Drained in spawn_observer -> stderr + `mpv://log`.
            mpv_request_log_messages(mpv, c"warn".as_ptr());
            // mpv writes screenshots to the *process* cwd by default -- `/` for a .desktop launch, and
            // read-only inside a sandbox, so the screenshot hotkey silently did nothing on Linux.
            set_option_checked(mpv, "screenshot-directory", &screenshot_directory());
            set_option_checked(mpv, "input-default-bindings", "no");
            set_option_checked(mpv, "input-vo-keyboard", "no");
            // mpv's default (auto-safe) forces stereo when the OS doesn't report an explicit layout -- not
            // guaranteed even over a real AVR/soundbar via HDMI. Explicit whitelist lets genuine 5.1/7.1/Atmos sources through instead of always downmixing.
            // ... except on Linux, where PipeWire/PulseAudio accept a 7.1 stream on a stereo sink and
            // then remix it themselves: mpv never downmixes, so `audio-normalize-downmix` below goes
            // dead and dialogue ends up quiet/clipped. There the AO reports a real layout, which is
            // exactly what mpv's own `auto-safe` default is for.
            // Bitstream passthrough to an AVR (audio-spdif=ac3,eac3,dts-hd,truehd) is deliberately not
            // forced on -- it breaks any sink that can't decode it. Set it through the raw mpv-config
            // passthrough (issue #9) if you have the receiver for it.
            let channels = if cfg!(target_os = "linux") { "auto-safe" } else { "7.1,5.1,stereo" };
            set_option_checked(mpv, "audio-channels", channels);
            set_option_checked(mpv, "audio-normalize-downmix", "yes"); // avoids clipping on a downmix that still happens (e.g. stereo-only output)

            // Linux renders on the GTK main thread (ADR-0010), and mpv_render_context_render blocks
            // until the frame's target display time -- up to this offset (50ms by default). Blocking the
            // main thread stalls the webview's own compositing and input handling, so don't render
            // ahead at all; render.h names this as the sanctioned alternative to blocking ourselves.
            if cfg!(target_os = "linux") {
                set_option_checked(mpv, "video-timing-offset", "0");
            }

            // Sane default subtitle appearance (issue #9): outlined text, no background box, legible without settings UI. PiP lands in #8.
            set_option_checked(mpv, "sub-font-size", "48");
            set_option_checked(mpv, "sub-color", "#FFFFFFFF");
            set_option_checked(mpv, "sub-border-color", "#FF000000");
            set_option_checked(mpv, "sub-border-size", "2.5");
            set_option_checked(mpv, "sub-back-color", "#00000000");
            set_option_checked(mpv, "sub-shadow-offset", "0");

            // Raw mpv-config passthrough (issue #9): applied after defaults so user values win. Deliberately
            // unsandboxed, power-user field -- e.g. pasting `osc=yes` reintroducing mpv's OSC is accepted risk.
            for (key, value) in extra_config {
                set_option(mpv, key, value);
            }

            check(mpv_initialize(mpv), "mpv_initialize")?;

            let waker = Arc::new(RenderWaker::default());
            // Owns picking/creating the render context, the GPU-vs-CPU fallback decision, and registering on_render_update -- see backend::attach's doc.
            let (surface, backend) = backend::attach(mpv, raw_handle, raw_display_handle, &waker)?;
            let surface = Arc::new(Mutex::new(surface));

            // Windows/Linux only, gated on Gpu: those two backends give mpv a real GL context (WGL/GLX),
            // so hwdec can interop straight into a GPU texture instead of the copy round trip the option
            // above defaults to. mac stays on auto-copy -- its IOSurface/Metal path has its own zero-copy
            // story (ADR-0009) and wasn't asked for here.
            // Windows: plain "auto". Smoke-tested on real hardware (Intel UHD 620) -- mpv falls back to
            // "d3d11va-copy" on its own when direct interop doesn't pan out, not a stutter source (that was
            // the unconditional CPU HDR tonemap filter above, now gated on cpu_backend). Direct hwdec on
            // GLX is comparatively less exercised; falls back the same way if the interop fails.
            // Linux: an explicit priority list, not "auto"/"auto-safe" -- those probe vulkan/cuda on every
            // load first, which on a plain Mesa box means repeated "Device does not support the
            // VK_KHR_video_decode_queue extension"/"Cannot load libcuda.so.1" and decode errors while
            // falling back (measured, not theorised). vaapi (Intel/AMD) then nvdec (NVIDIA) are the two
            // that matter, both zero-copy now that linux/mod.rs's render context passes mpv the X11/Wayland
            // display; the -copy variants still work where interop can't be set up, "no" is software decode.
            if cfg!(any(target_os = "windows", target_os = "linux")) && backend == Backend::Gpu {
                let name = CString::new("hwdec").unwrap();
                let val = CString::new(if cfg!(target_os = "linux") {
                    "vaapi,nvdec,vaapi-copy,nvdec-copy,no"
                } else {
                    "auto"
                })
                .unwrap();
                mpv_set_property_string(mpv, name.as_ptr(), val.as_ptr()); // post-init override, see comment above; best-effort, mpv keeps auto-copy if this fails
            }

            observe(mpv, 1, "time-pos", mpv_format_MPV_FORMAT_DOUBLE);
            observe(mpv, 2, "pause", mpv_format_MPV_FORMAT_FLAG);
            observe(mpv, 3, "duration", mpv_format_MPV_FORMAT_DOUBLE);
            observe(mpv, 4, "core-idle", mpv_format_MPV_FORMAT_FLAG);
            observe(mpv, 5, "demuxer-cache-time", mpv_format_MPV_FORMAT_DOUBLE);
            observe(mpv, 6, "volume", mpv_format_MPV_FORMAT_DOUBLE);
            observe(mpv, 7, "mute", mpv_format_MPV_FORMAT_FLAG);
            // drives apply_hdr_tonemap -- actual transfer function only known once decoding starts, unlike track-list metadata available at FILE_LOADED.
            observe(mpv, 8, "video-params/gamma", mpv_format_MPV_FORMAT_STRING);

            // GPU render path: tell mpv's own shader renderer the display is SDR so its built-in
            // tone-mapping engages on HDR sources automatically, same algorithm (hable) as the CPU
            // fallback below but done on GPU shaders mpv already has -- no manual filter needed.
            // Set as *properties*, not options: mpv_set_option_string after mpv_initialize isn't
            // guaranteed to reconfigure the already-created renderer, mpv_set_property is.
            if backend == Backend::Gpu {
                for (name, value) in [("target-trc", "bt.1886"), ("target-prim", "bt.709"), ("tone-mapping", "hable")] {
                    let (Ok(name), Ok(value)) = (CString::new(name), CString::new(value)) else { continue };
                    let rc = mpv_set_property_string(mpv, name.as_ptr(), value.as_ptr());
                    if rc < 0 {
                        let msg = CStr::from_ptr(mpv_error_string(rc)).to_string_lossy();
                        eprintln!("mpv: failed to set {}: {msg} ({rc})", name.to_string_lossy());
                    }
                }
            }

            let stop = Arc::new(AtomicBool::new(false));
            let pending = Arc::new(Mutex::new(PendingState::default()));
            let observer =
                spawn_observer(app.clone(), mpv, stop.clone(), pending.clone(), backend == Backend::Cpu);

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

    /// Clone of the render-surface handle, for `spawn_render_loop` to hold instead of `MpvState`'s lock while rendering.
    pub(crate) fn render_surface(&self) -> Arc<Mutex<Box<dyn RenderSurface>>> {
        Arc::clone(&self.surface)
    }

    /// Clone of the render-waker handle, for `spawn_render_loop` to block on instead of a fixed sleep.
    pub(crate) fn render_waker(&self) -> Arc<RenderWaker> {
        Arc::clone(&self.waker)
    }

    /// "gpu" or "cpu" -- which backend `attach` landed on (ADR-0009), surfaced via `mpv_attach`'s return value.
    pub fn render_backend(&self) -> &'static str {
        self.backend.as_str()
    }

    /// Snapshot of mpv-only stats for the Playback Info panel (ADR-0011). Each property is read
    /// best-effort (`unwrap_or_default`/`unwrap_or(0.0)`) -- e.g. `avsync`/`cache-speed` are unavailable
    /// before playback truly starts, and a panel opened at that moment should show zeros, not an error.
    pub fn stats(&self) -> MpvStats {
        MpvStats {
            hwdec_current: get_property_string(self.mpv, "hwdec-current").unwrap_or_default(),
            decoder_dropped_frames: get_property_int(self.mpv, "decoder-frame-drop-count").unwrap_or(0),
            display_dropped_frames: get_property_int(self.mpv, "frame-drop-count").unwrap_or(0),
            demuxer_cache_duration: get_property_double(self.mpv, "demuxer-cache-duration").unwrap_or(0.0),
            cache_speed: get_property_double(self.mpv, "cache-speed").unwrap_or(0.0),
            av_sync: get_property_double(self.mpv, "avsync").unwrap_or(0.0),
        }
    }

    fn command(&self, args: &[&str]) -> Result<(), String> {
        let (_cstrs, mut ptrs) = command_args(args);
        unsafe { check(mpv_command(self.mpv, ptrs.as_mut_ptr()), "mpv_command") }
    }

    // ponytail: generic passthrough (screenshot / frame-step / cycle deinterlace etc.) instead of one
    // bespoke #[tauri::command] per mpv command -- these are plain mpv commands with no state Photon
    // tracks, same shape as `command` above, just reachable from the frontend.
    pub fn run_command(&self, args: &[String]) -> Result<(), String> {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        self.command(&refs)
    }

    pub fn load(&self, url: &str, start_seconds: f64) -> Result<(), String> {
        *self.pending.lock().unwrap() = PendingState { start_seconds, ..Default::default() }; // fresh load, fresh state -- anything queued for a previous in-flight load is stale
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

    /// Adds an external text subtitle (server-delivered VTT/SRT URL -- mpv fetches it itself, no CORS/proxy
    /// needed). `index` is the caller's key (Jellyfin's stream index) for later reselection via `set_text_track`.
    /// Deferred to FILE_LOADED like `select_track`/`set_text_track`: a `sub-add` issued before the core opens
    /// the new file can silently fail or get wiped. Queued when `!loaded`, applied by the observer thread once ready.
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

    /// `index`: the Jellyfin stream index passed to `add_subtitle`, or `None` to disable subs. Resolved
    /// against `text_track_ids` into mpv's own "sid" -- callers only know the Jellyfin side of the mapping.
    /// Deferred to FILE_LOADED like `select_track`/`seek`: mpv's automatic default-subtitle selection runs
    /// as part of the async load, so setting `sid` right after `loadfile` would race and lose to autoselect.
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

    /// Selects an embedded audio/subtitle track by stream index (already corrected for Jellyfin's
    /// static-stream stripping, see TS's `toDemuxedIndex`) -- `kind` is "audio" or "sub", `None` disables it.
    /// Always direct play now (ADR-0008), so every Jellyfin track is already in the file mpv demuxes -- no
    /// separate server request needed, unlike the old HTML5 engine.
    /// Queued instead of applied immediately if FILE_LOADED hasn't fired yet: track-list is empty/incomplete
    /// right after `loadfile` returns, so resolution would silently fail.
    pub fn select_track(&self, kind: &str, source_index: Option<i64>) -> Result<(), String> {
        let mut pending = self.pending.lock().unwrap();
        if !pending.loaded {
            pending.queued_tracks.push((kind.to_string(), source_index));
            return Ok(());
        }
        drop(pending);
        apply_select_track(self.mpv, kind, source_index)
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

    /// Repositions to the given content-view-local rect (points, top-left origin), or hides when not visible/mounted.
    pub fn set_rect(&self, x: f64, y_top_left: f64, w: f64, h: f64) {
        self.surface.lock().unwrap().set_rect(x, y_top_left, w, h);
    }
}

impl Drop for MpvEngine {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.command(&["quit"]); // wakes mpv_wait_event in the observer thread so it notices `stop` and exits
        if let Some(h) = self.observer.take() {
            let _ = h.join();
        }
        // Locking blocks until any in-flight render finishes -- only then is it safe to free render_ctx/view, strictly before mpv_terminate_destroy below.
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
    cpu_backend: bool,
) -> JoinHandle<()> {
    // SAFETY: mpv outlives this thread -- MpvEngine::drop() signals `stop`, sends "quit", and joins this thread before freeing the render context/mpv handle.
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
                            apply_hdr_tonemap(mpv, &gamma, &mut hdr_tonemap_active, cpu_backend);
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
                    // Which hwdec (if any) mpv actually landed on -- the one question every "playback is
                    // stuttering / the fan is screaming" report needs answered, and it's only knowable
                    // per-file, after the decoder is up.
                    if let Ok(hwdec) = get_property_string(mpv, "hwdec-current") {
                        eprintln!("mpv: hwdec-current={hwdec}");
                    }
                    let drained = pending.lock().unwrap().drain();
                    if drained.start_seconds > 0.0 {
                        raw_command(mpv, &["seek", &drained.start_seconds.to_string(), "absolute"]);
                    }
                    // adds first -- queued_text_index below resolves against text_track_ids populated here
                    for (url, lang, index) in drained.subtitle_adds {
                        if let Ok(sid) = apply_add_subtitle(mpv, &url, lang.as_deref()) {
                            pending.lock().unwrap().text_track_ids.insert(index, sid);
                        }
                    }
                    for (kind, source_index) in drained.tracks {
                        let _ = apply_select_track(mpv, &kind, source_index);
                    }
                    // after autoselect + embedded-track selection, so a chosen external text sub wins the load-time race
                    if let Some(index) = drained.text_index {
                        let sid = match index {
                            None => None,
                            Some(idx) => pending.lock().unwrap().text_track_ids.get(&idx).copied(),
                        };
                        let _ = apply_set_text_track(mpv, sid);
                    }
                }
                x if x == mpv_event_id_MPV_EVENT_LOG_MESSAGE => {
                    // Requested at "warn" in attach(): the core's own diagnosis of a failed/black/stuttering
                    // playback. stderr for a terminal launch, `mpv://log` so it also lands in the webview
                    // console (and can be attached to a bug report) for a bundled one.
                    let msg = unsafe { &*(ev.data as *const mpv_event_log_message) };
                    let prefix = unsafe { CStr::from_ptr(msg.prefix).to_string_lossy() };
                    let text = unsafe { CStr::from_ptr(msg.text).to_string_lossy() };
                    let line = format!("[{prefix}] {}", text.trim_end());
                    eprintln!("mpv {line}");
                    let _ = app.emit("mpv://log", line);
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
