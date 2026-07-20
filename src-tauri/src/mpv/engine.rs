//! In-process libmpv render-API engine (ADR-0003/0005, proven by issue #4's
//! spike): composites mpv's OpenGL output into an NSOpenGLView inserted below
//! the window's (transparent) WKWebView, at a rect the frontend keeps synced
//! to a placeholder DOM element. No subtitles/PiP yet (tickets #7/#8).
//!
//! ponytail: render loop is a fixed ~60fps timer tick (see `spawn_render_loop`
//! in commands.rs), not driven by `mpv_render_context_set_update_callback` +
//! a display link — same known ceiling the spike flagged. Upgrade path:
//! wire the update callback once this is proven out in the real app.

use cocoa::appkit::NSWindow as CocoaNSWindow;
use cocoa::base::{id, nil, BOOL, NO, YES};
use cocoa::foundation::{NSPoint, NSRect, NSSize};
use libmpv_sys::*;
use objc::{class, msg_send, sel, sel_impl};
use std::ffi::{c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::{AppHandle, Emitter, Runtime, WebviewWindow};

const NS_OPENGL_PFA_ACCELERATED: u32 = 73;
const NS_OPENGL_PFA_DOUBLE_BUFFER: u32 = 5;
const NS_OPENGL_PFA_COLOR_SIZE: u32 = 8;
const NS_OPENGL_PFA_ALPHA_SIZE: u32 = 11;
const NS_OPENGL_PFA_DEPTH_SIZE: u32 = 12;
const NS_OPENGL_CP_SURFACE_OPACITY: i32 = 236;

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
    gl_view: id,
    gl_context: id,
    stop: Arc<AtomicBool>,
    observer: Option<JoinHandle<()>>,
    // ponytail: `seek` right after `loadfile` races the (async) load and
    // fails — confirmed against raw mpv IPC, not just this FFI layer. Queued
    // here and applied by the observer thread on MPV_EVENT_FILE_LOADED,
    // when the core is actually ready to accept it.
    pending_start: Arc<Mutex<f64>>,
}

// Cocoa views/GL context are only ever touched from the main thread; the raw
// mpv handle/render context are only touched from the main thread (commands,
// render ticks) and the dedicated observer thread, which mpv's C API allows.
unsafe impl Send for MpvEngine {}
unsafe impl Sync for MpvEngine {}

unsafe extern "C" fn get_proc_address(
    _ctx: *mut c_void,
    name: *const std::os::raw::c_char,
) -> *mut c_void {
    unsafe { libc::dlsym(libc::RTLD_DEFAULT, name) as *mut c_void }
}

fn check(rc: i32, what: &str) -> Result<(), String> {
    if rc < 0 {
        let msg = unsafe { CStr::from_ptr(mpv_error_string(rc)).to_string_lossy() };
        return Err(format!("mpv error during {what}: {msg} ({rc})"));
    }
    Ok(())
}

unsafe fn set_option(mpv: *mut mpv_handle, name: &str, value: &str) {
    let name = CString::new(name).unwrap();
    let value = CString::new(value).unwrap();
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
    pub fn attach<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) -> Result<Self, String> {
        unsafe {
            let ns_window = window.ns_window().map_err(|e| e.to_string())? as id;
            let content_view: id = CocoaNSWindow::contentView(ns_window);

            let attrs: [u32; 10] = [
                NS_OPENGL_PFA_ACCELERATED,
                NS_OPENGL_PFA_DOUBLE_BUFFER,
                NS_OPENGL_PFA_COLOR_SIZE,
                24,
                NS_OPENGL_PFA_ALPHA_SIZE,
                8,
                NS_OPENGL_PFA_DEPTH_SIZE,
                24,
                0,
                0,
            ];
            let pixel_format: id = msg_send![class!(NSOpenGLPixelFormat), alloc];
            let pixel_format: id = msg_send![pixel_format, initWithAttributes: attrs.as_ptr()];
            if pixel_format.is_null() {
                return Err("no matching GL pixel format".into());
            }

            let zero_frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0));
            let gl_view: id = msg_send![class!(NSOpenGLView), alloc];
            let gl_view: id = msg_send![gl_view, initWithFrame: zero_frame pixelFormat: pixel_format];
            if gl_view.is_null() {
                return Err("failed to create NSOpenGLView".into());
            }
            // initWithFrame:pixelFormat: retains its own reference to the pixel
            // format; release ours now that the view owns one
            let _: () = msg_send![pixel_format, release];

            let gl_context: id = msg_send![gl_view, openGLContext];
            let opacity: i32 = 0;
            let _: () =
                msg_send![gl_context, setValues: &opacity forParameter: NS_OPENGL_CP_SURFACE_OPACITY];

            let autoresize_none: u64 = 0; // positioned explicitly on every rect update, no autoresize
            let _: () = msg_send![gl_view, setAutoresizingMask: autoresize_none];
            let _: () = msg_send![gl_view, setWantsBestResolutionOpenGLSurface: YES];
            let _: () = msg_send![gl_view, setHidden: YES]; // hidden until the frontend reports a real rect

            let below: isize = -1; // NSWindowBelow (NSWindowOrderingMode is a signed NSInteger)
            let _: () = msg_send![content_view, addSubview: gl_view positioned: below relativeTo: nil];
            // addSubview: retains gl_view; release our own alloc'd reference now
            // that the content view owns one (removeFromSuperview in Drop below
            // releases that one in turn)
            let _: () = msg_send![gl_view, release];

            let _: () = msg_send![gl_context, makeCurrentContext];

            let mpv = mpv_create();
            if mpv.is_null() {
                return Err("mpv_create failed".into());
            }

            set_option(mpv, "vo", "libmpv");
            set_option(mpv, "osc", "no");
            set_option(mpv, "osd-level", "0");
            set_option(mpv, "keep-open", "yes");
            set_option(mpv, "hwdec", "auto-safe");
            set_option(mpv, "terminal", "no");
            set_option(mpv, "input-default-bindings", "no");
            set_option(mpv, "input-vo-keyboard", "no");
            // subtitles/PiP land in #7/#8 — no sub renderer config needed yet

            check(mpv_initialize(mpv), "mpv_initialize")?;

            let api_type_ptr = MPV_RENDER_API_TYPE_OPENGL.as_ptr() as *const std::os::raw::c_char;
            let mut gl_init_params = mpv_opengl_init_params {
                get_proc_address: Some(get_proc_address),
                get_proc_address_ctx: std::ptr::null_mut(),
                extra_exts: std::ptr::null(),
            };
            let mut params = [
                mpv_render_param {
                    type_: mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE,
                    data: api_type_ptr as *mut c_void,
                },
                mpv_render_param {
                    type_: mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
                    data: &mut gl_init_params as *mut _ as *mut c_void,
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

            Ok(Self { mpv, render_ctx, gl_view, gl_context, stop, observer: Some(observer), pending_start })
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

    /// Repositions the GL surface to the given content-view-local rect
    /// (points, top-left origin, matching `getBoundingClientRect()`), or
    /// hides it entirely when the placeholder isn't visible/mounted.
    pub fn set_rect(&self, x: f64, y_top_left: f64, w: f64, h: f64) {
        unsafe {
            if w <= 0.0 || h <= 0.0 {
                let _: () = msg_send![self.gl_view, setHidden: YES];
                return;
            }
            let superview: id = msg_send![self.gl_view, superview];
            let parent_bounds: NSRect = msg_send![superview, bounds];
            // AppKit's NSView origin is bottom-left; the frontend reports
            // top-left (CSS) coordinates.
            let y = parent_bounds.size.height - y_top_left - h;
            let frame = NSRect::new(NSPoint::new(x, y), NSSize::new(w, h));
            let _: () = msg_send![self.gl_view, setFrame: frame];
            let _: () = msg_send![self.gl_context, update];
            let _: () = msg_send![self.gl_view, setHidden: NO as BOOL];
        }
        self.render();
    }

    pub fn render(&self) {
        unsafe {
            let hidden: BOOL = msg_send![self.gl_view, isHidden];
            if hidden == YES {
                return;
            }
            let _: () = msg_send![self.gl_context, makeCurrentContext];
            let bounds: NSRect = msg_send![self.gl_view, bounds];
            let backing: NSRect = msg_send![self.gl_view, convertRectToBacking: bounds];
            let (w, h) = (backing.size.width as i32, backing.size.height as i32);
            if w <= 0 || h <= 0 {
                return;
            }

            let mut fbo = mpv_opengl_fbo { fbo: 0, w, h, internal_format: 0 };
            let mut flip: std::os::raw::c_int = 1;
            let mut render_params = [
                mpv_render_param {
                    type_: mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_FBO,
                    data: &mut fbo as *mut _ as *mut c_void,
                },
                mpv_render_param {
                    type_: mpv_render_param_type_MPV_RENDER_PARAM_FLIP_Y,
                    data: &mut flip as *mut _ as *mut c_void,
                },
                mpv_render_param {
                    type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID,
                    data: std::ptr::null_mut(),
                },
            ];
            mpv_render_context_render(self.render_ctx, render_params.as_mut_ptr());
            mpv_render_context_report_swap(self.render_ctx);
            let _: () = msg_send![self.gl_context, flushBuffer];
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
            let _: () = msg_send![self.gl_view, removeFromSuperview];
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
