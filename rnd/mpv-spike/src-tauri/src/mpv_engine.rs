//! Spike-only mpv render-API engine: composites libmpv's OpenGL output into an
//! NSOpenGLView inserted *below* Tauri's (transparent) WKWebView, in the same
//! top-level window. No `--wid` embedding, no child window, no spawned process.
//!
//! ponytail: timer-polled render loop (fixed ~60fps tick via
//! `run_on_main_thread`), not driven by `mpv_render_context_set_update_callback`
//! + a display-link. Fine for a throwaway spike proving compositing works;
//! ticket #3's real implementation should wire the update callback + CVDisplayLink
//! to avoid redundant renders and stay tear-free at arbitrary refresh rates.

use cocoa::appkit::NSWindow as CocoaNSWindow;
use cocoa::base::{id, nil, YES};
use cocoa::foundation::NSRect;
use libmpv_sys::*;
use objc::{class, msg_send, sel, sel_impl};
use std::ffi::{c_void, CStr, CString};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, Runtime, WebviewWindow};

// NSOpenGLPixelFormatAttribute is a 32-bit value in AppKit; 0 terminates the array.
const NS_OPENGL_PFA_ACCELERATED: u32 = 73;
const NS_OPENGL_PFA_DOUBLE_BUFFER: u32 = 5;
const NS_OPENGL_PFA_COLOR_SIZE: u32 = 8;
const NS_OPENGL_PFA_ALPHA_SIZE: u32 = 11;
const NS_OPENGL_PFA_DEPTH_SIZE: u32 = 12;

pub struct MpvEngine {
    mpv: *mut mpv_handle,
    render_ctx: *mut mpv_render_context,
    gl_view: id,
    gl_context: id,
}

// Every field is only ever touched on the main thread (Cocoa views/contexts
// must be) or from mpv's own internal thread via raw pointers it owns.
unsafe impl Send for MpvEngine {}
unsafe impl Sync for MpvEngine {}

unsafe extern "C" fn get_proc_address(_ctx: *mut c_void, name: *const std::os::raw::c_char) -> *mut c_void {
    unsafe { libc::dlsym(libc::RTLD_DEFAULT, name) as *mut c_void }
}

fn check(rc: i32, what: &str) {
    if rc < 0 {
        let msg = unsafe { CStr::from_ptr(mpv_error_string(rc)).to_string_lossy() };
        panic!("mpv error during {what}: {msg} ({rc})");
    }
}

impl MpvEngine {
    /// Builds the mpv render context and inserts its GL surface as the
    /// bottom-most subview of the window's content view (below the webview).
    pub fn attach<R: Runtime>(window: &WebviewWindow<R>) -> Self {
        unsafe {
            let ns_window = window.ns_window().expect("no ns_window (not macOS?)") as id;
            let content_view: id = CocoaNSWindow::contentView(ns_window);
            let frame: NSRect = msg_send![content_view, bounds];

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
            assert!(!pixel_format.is_null(), "no matching GL pixel format");

            let gl_view: id = msg_send![class!(NSOpenGLView), alloc];
            let gl_view: id = msg_send![gl_view, initWithFrame: frame pixelFormat: pixel_format];
            assert!(!gl_view.is_null(), "failed to create NSOpenGLView");

            // Alpha-blend mpv's surface with whatever sits above it (the
            // transparent webview) instead of the surface itself being opaque.
            let gl_context: id = msg_send![gl_view, openGLContext];
            let opacity: i32 = 0;
            let _: () = msg_send![gl_context, setValues: &opacity forParameter: 236i32 /* NSOpenGLCPSurfaceOpacity */];

            let autoresize_width_height: u64 = (1 << 1) | (1 << 4); // NSViewWidthSizable | NSViewHeightSizable
            let _: () = msg_send![gl_view, setAutoresizingMask: autoresize_width_height];
            let _: () = msg_send![gl_view, setWantsBestResolutionOpenGLSurface: YES];

            // Insert at the bottom of the z-order: below the WKWebView Tauri
            // already added, so the transparent webview shows mpv through it.
            let below: isize = -1; // NSWindowBelow (NSWindowOrderingMode is a signed NSInteger)
            let _: () = msg_send![content_view, addSubview: gl_view positioned: below relativeTo: nil];

            let _: () = msg_send![gl_context, makeCurrentContext];

            let mpv = mpv_create();
            assert!(!mpv.is_null(), "mpv_create failed");

            set_option(mpv, "vo", "libmpv");
            set_option(mpv, "osc", "no");
            set_option(mpv, "osd-level", "0");
            set_option(mpv, "keep-open", "yes");
            set_option(mpv, "hwdec", "auto-safe");
            set_option(mpv, "terminal", "no");
            set_option(mpv, "input-default-bindings", "no");
            set_option(mpv, "input-vo-keyboard", "no");

            check(mpv_initialize(mpv), "mpv_initialize");

            // Already a NUL-terminated byte string constant; no CString needed
            // (it *contains* the NUL, which CString::new would reject).
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
            );

            Self {
                mpv,
                render_ctx,
                gl_view,
                gl_context,
            }
        }
    }

    pub fn load_file(&self, path: &str) {
        self.command(&["loadfile", path]);
    }

    pub fn toggle_pause(&self) {
        self.command(&["cycle", "pause"]);
        self.debug_log_state("toggle_pause");
    }

    pub fn seek(&self, seconds: f64) {
        self.command(&["seek", &seconds.to_string(), "relative"]);
        self.debug_log_state("seek");
    }

    /// Spike-only diagnostic: confirms commands actually reach mpv (used since
    /// screen-recording permission isn't available to visually verify).
    fn debug_log_state(&self, action: &str) {
        unsafe {
            let name = CString::new("time-pos").unwrap();
            let mut time_pos: f64 = -1.0;
            mpv_get_property(
                self.mpv,
                name.as_ptr(),
                mpv_format_MPV_FORMAT_DOUBLE,
                &mut time_pos as *mut _ as *mut c_void,
            );
            let pname = CString::new("pause").unwrap();
            let mut paused: std::os::raw::c_int = -1;
            mpv_get_property(
                self.mpv,
                pname.as_ptr(),
                mpv_format_MPV_FORMAT_FLAG,
                &mut paused as *mut _ as *mut c_void,
            );
            eprintln!("[mpv-spike] after {action}: time-pos={time_pos:.2} paused={}", paused != 0);
        }
    }

    fn command(&self, args: &[&str]) {
        let cstrs: Vec<CString> = args.iter().map(|s| CString::new(*s).unwrap()).collect();
        let mut ptrs: Vec<*const std::os::raw::c_char> =
            cstrs.iter().map(|s| s.as_ptr()).chain(std::iter::once(std::ptr::null())).collect();
        unsafe {
            check(mpv_command(self.mpv, ptrs.as_mut_ptr()), "mpv_command");
        }
    }

    /// Repositions/resizes the GL surface to match the (possibly resized)
    /// window content view, then re-renders one frame at the new size.
    pub fn resize<R: Runtime>(&self, window: &WebviewWindow<R>) {
        unsafe {
            let ns_window = window.ns_window().expect("no ns_window") as id;
            let content_view: id = CocoaNSWindow::contentView(ns_window);
            let frame: NSRect = msg_send![content_view, bounds];
            let _: () = msg_send![self.gl_view, setFrame: frame];
            let _: () = msg_send![self.gl_context, update];
        }
        self.render();
    }

    /// Renders one frame into the GL view's default framebuffer and swaps it.
    /// Called on a fixed timer tick from the main thread.
    pub fn render(&self) {
        unsafe {
            let _: () = msg_send![self.gl_context, makeCurrentContext];
            let bounds: NSRect = msg_send![self.gl_view, bounds];
            let backing: NSRect = msg_send![self.gl_view, convertRectToBacking: bounds];
            let (w, h) = (backing.size.width as i32, backing.size.height as i32);
            if w <= 0 || h <= 0 {
                return;
            }

            let mut fbo = mpv_opengl_fbo {
                fbo: 0,
                w,
                h,
                internal_format: 0,
            };
            let mut flip: std::os::raw::c_int = 1;
            let mut params = [
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
            mpv_render_context_render(self.render_ctx, params.as_mut_ptr());
            mpv_render_context_report_swap(self.render_ctx);
            let _: () = msg_send![self.gl_context, flushBuffer];
        }
    }
}

unsafe fn set_option(mpv: *mut mpv_handle, name: &str, value: &str) {
    let name = CString::new(name).unwrap();
    let value = CString::new(value).unwrap();
    unsafe {
        mpv_set_option_string(mpv, name.as_ptr(), value.as_ptr());
    }
}

/// Spawns the fixed-interval render tick, hopping onto the main thread each
/// time (see module doc: known ceiling, not update-callback-driven).
pub fn spawn_render_loop<R: Runtime>(app: tauri::AppHandle<R>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(16));
        let tick_app = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(engine) = tick_app.try_state::<Mutex<Option<MpvEngine>>>() {
                if let Some(engine) = engine.lock().unwrap().as_ref() {
                    engine.render();
                }
            }
        });
    });
}
