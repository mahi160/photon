//! In-process libmpv render-API engine (ADR-0003/0005).
//!
//! Renders via mpv's *software* render API (`MPV_RENDER_API_TYPE_SW`) into a
//! plain buffer, then hands each frame to a `CALayer` (via `layer.contents`)
//! on a layer-backed `NSView` inserted below the window's (transparent)
//! WKWebView, at a rect the frontend keeps synced to a placeholder DOM
//! element. No subtitles/PiP yet (tickets #7/#8).
//!
//! ponytail: NOT the OpenGL render API, on purpose. Tried that first
//! (`MPV_RENDER_API_TYPE_OPENGL` into an `NSOpenGLView`) and it rendered
//! successfully (mpv reported no errors, playback ticked forward correctly)
//! but only ever painted flat gray, never real frames. Researched rather
//! than guessed further: `NSOpenGLView` is not layer-backed, so it composites
//! through a legacy pre-Core-Animation "surface" plane that doesn't blend
//! correctly with a modern layer-backed (Metal) `WKWebView` above it — and
//! independently, transparent OpenGL surfaces have been broken on macOS
//! since 10.11 (`NSOpenGLCPSurfaceOpacity` is simply ignored). Layer-backing
//! an `NSOpenGLView` directly is also documented to cause distortion/severe
//! performance loss. The software render API sidesteps all of it: a plain
//! `CALayer.contents = CGImage` assignment is native, fully-supported
//! Core Animation compositing, no OpenGL/Core-Animation interop involved.
//! Slower than GPU rendering (mpv's own docs: "very slow, because everything
//! ... runs on the CPU") and allocates a fresh frame buffer every render —
//! correct-first; a buffer pool / IOSurface zero-copy path is real upgrade
//! work, not done here.
//!
//! Render loop (`spawn_render_loop` in commands.rs) is woken by mpv's own
//! `mpv_render_context_set_update_callback` (see `RenderWaker` below) as soon
//! as a new frame is ready, rather than guessing on a fixed timer. Not a real
//! display vsync lock (no `CVDisplayLink` — mpv's callback says "a frame is
//! ready", not "the display's about to refresh") — that's a further, real
//! per-platform upgrade, not done here.

// The `cocoa` crate (still what this whole module is built on) points at
// `objc2`/`objc2-app-kit`/`objc2-foundation` as its replacement, but porting
// this file's raw NSView/NSWindow/CALayer calls is a real rewrite of the
// compositing layer above, not a drive-by fix for a warning -- silenced
// here, not fixed, until/unless that migration is actually undertaken.
#![allow(deprecated)]
// The unexpected_cfgs warnings this file's msg_send!/sel_impl! call sites
// also generate (objc 0.2.x's own pre-`--check-cfg` cargo-clippy detection
// trick) aren't suppressible with a source-level #[allow] here -- see the
// [lints.rust] table in Cargo.toml instead.

use cocoa::appkit::NSWindow as CocoaNSWindow;
use cocoa::base::{id, nil, BOOL, YES};
use cocoa::foundation::{NSPoint, NSRect, NSSize};
use core_graphics::color_space::CGColorSpace;
use core_graphics::data_provider::CGDataProvider;
use core_graphics::image::{CGImage, CGImageAlphaInfo};
use foreign_types::ForeignType;
use libmpv_sys::*;

// libmpv-sys 3.1.0's published pregenerated bindings predate mpv's software
// render API (added upstream well after that snapshot was taken) even though
// our actual installed mpv (0.41.0) headers have it -- confirmed by grepping
// them directly. Regenerating via the crate's own `use-bindgen` feature was
// the "correct" fix, but its pinned bindgen (0.54, ~2020) can't parse our
// current headers at all (panics on an anonymous union). These four values
// are stable/documented in mpv's render.h and unlikely to ever change
// (they're a public C API), so defining them locally is the pragmatic fix.
const MPV_RENDER_PARAM_SW_SIZE: mpv_render_param_type = 17;
const MPV_RENDER_PARAM_SW_FORMAT: mpv_render_param_type = 18;
const MPV_RENDER_PARAM_SW_STRIDE: mpv_render_param_type = 19;
const MPV_RENDER_PARAM_SW_POINTER: mpv_render_param_type = 20;
const MPV_RENDER_API_TYPE_SW: &[u8] = b"sw\0";
use objc::{class, msg_send, sel, sel_impl};
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

/// The render-loop/rect state (render context, view, colorspace) --
/// deliberately behind its *own* mutex, separate from `MpvState` (the
/// Tauri-managed `Mutex<Option<MpvEngine>>` every command locks). Every
/// other command (play/pause/seek/volume/select_track/...) only ever needs
/// `MpvState` for a fast property-set; if render_ctx/view instead lived
/// directly on `MpvEngine` guarded only by that same lock, a slow *software*
/// render frame (module doc: "very slow, everything on the CPU") would hold
/// `MpvState` for the frame's whole duration and stall every other command
/// behind it. `spawn_render_loop` (commands.rs) now only holds `MpvState`
/// long enough to clone this handle out, then renders through this mutex
/// instead -- so a slow frame only ever blocks another *render* (loop tick
/// vs. `set_rect`), never a play/pause/seek/volume command.
///
/// Teardown is explicit (`teardown`, called from `MpvEngine::drop` while
/// holding this same mutex) rather than left to `Drop`/refcounting:
/// `render_ctx` must be freed strictly before `mpv_terminate_destroy(mpv)`,
/// and any render the loop thread has already started must be allowed to
/// finish first, not raced. Locking this mutex from `drop` gets both for
/// free (a concurrent `render()` holds the same lock for its duration), and
/// nulling `render_ctx` afterward turns any `render()` call that acquires
/// the lock *after* teardown (the loop thread had already cloned the handle
/// before `MpvEngine` was dropped) into a safe no-op instead of a
/// use-after-free.
pub(crate) struct RenderSurface {
    render_ctx: *mut mpv_render_context,
    view: id, // plain, layer-backed NSView — not an NSOpenGLView, see module doc
    // created once — CGColorSpace is the same for every frame, no reason to
    // recreate it 5x/sec
    colorspace: CGColorSpace,
}

// Raw AppKit/mpv pointers — see the struct doc for the exact cross-thread
// contract (render loop's own thread + main thread, serialized by this
// type's own mutex).
unsafe impl Send for RenderSurface {}

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

// `cb_ctx` is `RenderWaker`'s address, set via `Arc::as_ptr` in `attach` and
// kept alive for exactly as long as `render_ctx` can still call this (the
// callback is unregistered in `teardown`, before `MpvEngine`'s own `waker`
// field is dropped).
unsafe extern "C" fn on_render_update(cb_ctx: *mut c_void) {
    let waker = unsafe { &*(cb_ctx as *const RenderWaker) };
    waker.notify();
}

pub struct MpvEngine {
    mpv: *mut mpv_handle,
    surface: Arc<Mutex<RenderSurface>>,
    waker: Arc<RenderWaker>,
    stop: Arc<AtomicBool>,
    observer: Option<JoinHandle<()>>,
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
        unsafe {
            let ns_window = window.ns_window().map_err(|e| e.to_string())? as id;
            let content_view: id = CocoaNSWindow::contentView(ns_window);

            let zero_frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0));
            let view: id = msg_send![class!(NSView), alloc];
            let view: id = msg_send![view, initWithFrame: zero_frame];
            if view.is_null() {
                return Err("failed to create NSView".into());
            }
            let _: () = msg_send![view, setWantsLayer: YES];
            let _: () = msg_send![view, setAutoresizingMask: 0u64]; // positioned explicitly on every rect update
            let _: () = msg_send![view, setHidden: YES]; // hidden until the frontend reports a real rect

            let below: isize = -1; // NSWindowBelow (NSWindowOrderingMode is a signed NSInteger)
            let _: () = msg_send![content_view, addSubview: view positioned: below relativeTo: nil];
            // addSubview: retains view; release our own alloc'd reference now
            // that the content view owns one (removeFromSuperview in Drop
            // below releases that one in turn)
            let _: () = msg_send![view, release];

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

            let api_type_ptr = MPV_RENDER_API_TYPE_SW.as_ptr() as *const std::os::raw::c_char;
            let mut params = [
                mpv_render_param {
                    type_: mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE,
                    data: api_type_ptr as *mut c_void,
                },
                mpv_render_param {
                    type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID,
                    data: std::ptr::null_mut(),
                },
            ];
            let mut render_ctx: *mut mpv_render_context = std::ptr::null_mut();
            check(
                mpv_render_context_create(&mut render_ctx, mpv, params.as_mut_ptr()),
                "mpv_render_context_create",
            )?;

            let waker = Arc::new(RenderWaker::default());
            mpv_render_context_set_update_callback(
                render_ctx,
                Some(on_render_update),
                Arc::as_ptr(&waker) as *mut c_void,
            );

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
            let surface = Arc::new(Mutex::new(RenderSurface {
                render_ctx,
                view,
                colorspace: CGColorSpace::create_device_rgb(),
            }));

            Ok(Self {
                mpv,
                surface,
                waker,
                stop,
                observer: Some(observer),
                pending,
            })
        }
    }

    /// Clone of the render-surface handle, for `spawn_render_loop`
    /// (commands.rs) to hold *instead of* `MpvState`'s lock while it
    /// actually renders -- see `RenderSurface`'s doc.
    pub(crate) fn render_surface(&self) -> Arc<Mutex<RenderSurface>> {
        Arc::clone(&self.surface)
    }

    /// Clone of the render-waker handle, for `spawn_render_loop` to block on
    /// instead of a fixed sleep -- see `RenderWaker`'s doc.
    pub(crate) fn render_waker(&self) -> Arc<RenderWaker> {
        Arc::clone(&self.waker)
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

impl RenderSurface {
    /// Repositions the surface to the given content-view-local rect (points,
    /// top-left origin, matching `getBoundingClientRect()`), or hides it
    /// entirely when the placeholder isn't visible/mounted.
    fn set_rect(&self, x: f64, y_top_left: f64, w: f64, h: f64) {
        unsafe {
            if w <= 0.0 || h <= 0.0 {
                let _: () = msg_send![self.view, setHidden: YES];
                return;
            }
            let superview: id = msg_send![self.view, superview];
            let parent_bounds: NSRect = msg_send![superview, bounds];
            // AppKit's NSView origin is bottom-left; the frontend reports
            // top-left (CSS) coordinates.
            let y = parent_bounds.size.height - y_top_left - h;
            let frame = NSRect::new(NSPoint::new(x, y), NSSize::new(w, h));
            let _: () = msg_send![self.view, setFrame: frame];
            let _: () = msg_send![self.view, setHidden: cocoa::base::NO as BOOL];
        }
        self.render();
    }

    /// Renders one frame into an in-memory buffer and hands it to the
    /// view's layer as a `CGImage` (see module doc for why this is the
    /// software render API, not OpenGL). Called from the render loop's own
    /// background thread each time mpv wakes `RenderWaker` (see that type's
    /// doc), and once synchronously at the end of `set_rect`.
    ///
    /// `pub(crate)`: called directly by `spawn_render_loop` (commands.rs) via
    /// the cloned handle from `MpvEngine::render_surface`.
    pub(crate) fn render(&self) {
        unsafe {
            if self.render_ctx.is_null() {
                return; // torn down (MpvEngine dropped) -- see `teardown`
            }
            let hidden: BOOL = msg_send![self.view, isHidden];
            if hidden == YES {
                return;
            }
            // ponytail: rendering at *point* resolution, not the 2x/HiDPI
            // backing-store resolution `convertRectToBacking:` would give us.
            // Quarters the per-frame buffer/CGImage cost on Retina displays,
            // which is what actually made 30fps possible instead of
            // beachballing (see spawn_render_loop's doc) -- most streamed
            // video isn't native 4K anyway, so this is rarely a visible loss.
            // CALayer's default contentsScale (1.0) matches a point-sized
            // image correctly; no extra config needed.
            let bounds: NSRect = msg_send![self.view, bounds];
            let (w, h) = (bounds.size.width as i32, bounds.size.height as i32);
            if w <= 0 || h <= 0 {
                return;
            }

            let stride: usize = (w as usize) * 4;
            let mut frame = vec![0u8; stride * (h as usize)];

            let mut size = [w, h];
            let format = CString::new("rgb0").unwrap(); // opaque RGB + padding byte, no real alpha needed
            let mut stride_val: usize = stride;
            let mut params = [
                mpv_render_param {
                    type_: MPV_RENDER_PARAM_SW_SIZE,
                    data: size.as_mut_ptr() as *mut c_void,
                },
                mpv_render_param {
                    type_: MPV_RENDER_PARAM_SW_FORMAT,
                    data: format.as_ptr() as *mut c_void,
                },
                mpv_render_param {
                    type_: MPV_RENDER_PARAM_SW_STRIDE,
                    data: &mut stride_val as *mut _ as *mut c_void,
                },
                mpv_render_param {
                    type_: MPV_RENDER_PARAM_SW_POINTER,
                    data: frame.as_mut_ptr() as *mut c_void,
                },
                mpv_render_param {
                    type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID,
                    data: std::ptr::null_mut(),
                },
            ];
            let rc = mpv_render_context_render(self.render_ctx, params.as_mut_ptr());
            if rc < 0 {
                return; // no frame ready yet or a transient error — try again next tick
            }

            let provider = CGDataProvider::from_buffer(Arc::new(frame));
            let image = CGImage::new(
                w as usize,
                h as usize,
                8,
                32,
                stride,
                &self.colorspace,
                CGImageAlphaInfo::CGImageAlphaNoneSkipLast as u32,
                &provider,
                false,
                0, // kCGRenderingIntentDefault
            );
            let layer: id = msg_send![self.view, layer];
            let _: () = msg_send![layer, setContents: (image.as_ptr() as id)];
            // Core Animation normally flushes implicit transactions on the
            // next run-loop pass of whichever thread touched the layer --
            // this render loop runs on a plain std::thread with no run loop
            // at all, so without an explicit flush the contents change just
            // sits pending forever (screen shows the punched-through hole to
            // nothing: solid black) even though mpv genuinely produced a
            // real frame. Forces it to the window server immediately.
            let _: () = msg_send![class!(CATransaction), flush];
        }
    }

    /// Frees the render context and removes the view. Called from
    /// `MpvEngine::drop` while holding this surface's own mutex -- see the
    /// struct doc for why this must happen here (not via `Drop`) and why
    /// nulling `render_ctx` afterward matters.
    fn teardown(&mut self) {
        unsafe {
            // Unregister before freeing the context -- otherwise a callback
            // could fire (mpv's own thread) referencing a `RenderWaker` that
            // `MpvEngine`'s `Drop` is about to free once this returns.
            mpv_render_context_set_update_callback(self.render_ctx, None, std::ptr::null_mut());
            let _: () = msg_send![self.view, removeFromSuperview];
            mpv_render_context_free(self.render_ctx);
        }
        self.render_ctx = std::ptr::null_mut();
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
                    let (start, subtitle_adds, queued_tracks, queued_text_index) = {
                        let mut p = pending.lock().unwrap();
                        p.loaded = true;
                        (
                            std::mem::replace(&mut p.start_seconds, 0.0),
                            std::mem::take(&mut p.queued_subtitle_adds),
                            std::mem::take(&mut p.queued_tracks),
                            p.queued_text_index.take(),
                        )
                    };
                    if start > 0.0 {
                        let args = ["seek", &start.to_string(), "absolute"];
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
                    for (url, lang, index) in subtitle_adds {
                        if let Ok(sid) = apply_add_subtitle(mpv, &url, lang.as_deref()) {
                            pending.lock().unwrap().text_track_ids.insert(index, sid);
                        }
                    }
                    for (kind, source_index) in queued_tracks {
                        let _ = apply_select_track(mpv, &kind, source_index);
                    }
                    // after autoselect + any embedded-track selection above,
                    // so a chosen external text sub wins the load-time race
                    if let Some(index) = queued_text_index {
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
