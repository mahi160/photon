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
//! ponytail: render loop is a fixed ~60fps timer tick (see `spawn_render_loop`
//! in commands.rs), not driven by `mpv_render_context_set_update_callback` +
//! a display link — same known ceiling the spike flagged.

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
use std::ffi::{c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
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

pub struct MpvEngine {
    mpv: *mut mpv_handle,
    render_ctx: *mut mpv_render_context,
    view: id, // plain, layer-backed NSView — not an NSOpenGLView, see module doc
    stop: Arc<AtomicBool>,
    observer: Option<JoinHandle<()>>,
    // ponytail: `seek` right after `loadfile` races the (async) load and
    // fails — confirmed against raw mpv IPC, not just this FFI layer. Queued
    // here and applied by the observer thread on MPV_EVENT_FILE_LOADED,
    // when the core is actually ready to accept it.
    pending_start: Arc<Mutex<f64>>,
    // created once — CGColorSpace is the same for every frame, no reason to
    // recreate it 5x/sec
    colorspace: CGColorSpace,
}

// Cocoa view/layer calls are only ever made from the main thread; the raw
// mpv handle/render context are only touched from the main thread (commands,
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
            set_option(mpv, "hwdec", "no"); // software render API only ever gets software-decoded frames anyway
            set_option(mpv, "terminal", "no");
            set_option(mpv, "input-default-bindings", "no");
            set_option(mpv, "input-vo-keyboard", "no");

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

            observe(mpv, 1, "time-pos", mpv_format_MPV_FORMAT_DOUBLE);
            observe(mpv, 2, "pause", mpv_format_MPV_FORMAT_FLAG);
            observe(mpv, 3, "duration", mpv_format_MPV_FORMAT_DOUBLE);
            observe(mpv, 4, "core-idle", mpv_format_MPV_FORMAT_FLAG);
            observe(mpv, 5, "demuxer-cache-time", mpv_format_MPV_FORMAT_DOUBLE);
            observe(mpv, 6, "volume", mpv_format_MPV_FORMAT_DOUBLE);
            observe(mpv, 7, "mute", mpv_format_MPV_FORMAT_FLAG);

            let stop = Arc::new(AtomicBool::new(false));
            let pending_start = Arc::new(Mutex::new(0.0));
            let observer = spawn_observer(app.clone(), mpv, stop.clone(), pending_start.clone());

            Ok(Self {
                mpv,
                render_ctx,
                view,
                stop,
                observer: Some(observer),
                pending_start,
                colorspace: CGColorSpace::create_device_rgb(),
            })
        }
    }

    fn command(&self, args: &[&str]) -> Result<(), String> {
        let cstrs: Vec<CString> = args.iter().map(|s| CString::new(*s).unwrap()).collect();
        let mut ptrs: Vec<*const std::os::raw::c_char> =
            cstrs.iter().map(|s| s.as_ptr()).chain(std::iter::once(std::ptr::null())).collect();
        unsafe { check(mpv_command(self.mpv, ptrs.as_mut_ptr()), "mpv_command") }
    }

    pub fn load(&self, url: &str, start_seconds: f64) -> Result<(), String> {
        *self.pending_start.lock().unwrap() = start_seconds;
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
    /// Returns mpv's assigned track id ("sid") for later reselection via
    /// `set_text_track`.
    ///
    /// ponytail: tried the documented approach first — `sub-add ... auto`
    /// then reading its command_ret/mpv_node result, which the manual says
    /// carries the new track's id. Verified (against raw mpv IPC, not just
    /// this FFI layer) that this mpv build returns `null` there instead.
    /// `sub-add ... select` immediately makes the new track current, so
    /// reading the now-current "sid" property right after (mpv_command is
    /// synchronous — it only returns once the command has been processed)
    /// reliably gives the right id. Momentarily selecting each track while
    /// mapping is harmless: `load()`'s caller always follows up with an
    /// explicit `set_text_track` for whichever one the user actually wants.
    pub fn add_subtitle(&self, url: &str, lang: Option<&str>) -> Result<i64, String> {
        let lang = lang.unwrap_or("");
        self.command(&["sub-add", url, "select", "", lang])?;
        let name = CString::new("sid").unwrap();
        let mut sid: i64 = -1;
        unsafe {
            check(
                mpv_get_property(self.mpv, name.as_ptr(), mpv_format_MPV_FORMAT_INT64, &mut sid as *mut _ as *mut c_void),
                "mpv_get_property (sid)",
            )?;
        }
        Ok(sid)
    }

    /// `sid`: mpv's track id from `add_subtitle`, or `None` to disable subs.
    pub fn set_text_track(&self, sid: Option<i64>) -> Result<(), String> {
        let name = CString::new("sid").unwrap();
        unsafe {
            match sid {
                Some(id) => {
                    let mut v = id;
                    check(
                        mpv_set_property(self.mpv, name.as_ptr(), mpv_format_MPV_FORMAT_INT64, &mut v as *mut _ as *mut c_void),
                        "mpv_set_property (sid)",
                    )
                }
                None => {
                    let no = CString::new("no").unwrap();
                    check(mpv_set_property_string(self.mpv, name.as_ptr(), no.as_ptr()), "mpv_set_property_string (sid=no)")
                }
            }
        }
    }

    pub fn set_subtitle_delay(&self, seconds: f64) -> Result<(), String> {
        unsafe { self.set_double("sub-delay", seconds) }
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
    /// software render API, not OpenGL). Called on a fixed timer tick from
    /// the main thread.
    pub fn render(&self) {
        unsafe {
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
        unsafe {
            let _: () = msg_send![self.view, removeFromSuperview];
            mpv_render_context_free(self.render_ctx);
            mpv_terminate_destroy(self.mpv);
        }
    }
}

fn spawn_observer<R: Runtime>(
    app: AppHandle<R>,
    mpv: *mut mpv_handle,
    stop: Arc<AtomicBool>,
    pending_start: Arc<Mutex<f64>>,
) -> JoinHandle<()> {
    // Safety: `mpv` outlives this thread — MpvEngine::drop() signals `stop`,
    // sends "quit" (unblocking mpv_wait_event with MPV_EVENT_SHUTDOWN), and
    // joins this thread *before* freeing the render context/mpv handle.
    let mpv_addr = mpv as usize;
    std::thread::spawn(move || {
        let mpv = mpv_addr as *mut mpv_handle;
        let mut tick = Tick::default();
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
                    let start = std::mem::replace(&mut *pending_start.lock().unwrap(), 0.0);
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
