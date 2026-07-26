//! Linux half of the mpv render backend (ADR-0009's `RenderSurface` seam,
//! `mpv/surface.rs`). X11 only for now -- Wayland still returns the same
//! "not implemented" error the whole module used to (EGL/`wl_egl_window`
//! backend is a follow-up, see issue #27).
//!
//! Unlike `mac/gpu.rs`, there's no zero-copy IOSurface/Metal handoff to
//! build: GLX renders straight onto an X11 window we create and own, and
//! `glXSwapBuffers` presents it -- the window server, not this code, is what
//! composites separate windows together. So instead of a transparent
//! overlay layer behind the webview (mac's approach), this creates a plain
//! opaque child X11 window sized/positioned to the placeholder rect (same
//! technique mpv/VLC/any native X11 embedding uses) -- ordinary X clipping
//! keeps the (already-transparent, see wry's `set_background_color`) webview
//! from ever needing to draw over that rectangle, no compositor-specific
//! alpha blending required either way.
//!
//! No CPU fallback path here (unlike mac's GPU/CPU split): mac needed one
//! because a *specific* GL transparency bug made the GPU path unusable on
//! some runs, not because of missing hardware. GLX itself already falls
//! back to software rendering (Mesa's llvmpipe) transparently at the driver
//! level when there's no real GPU -- an app-level software renderer here
//! would be solving a problem GLX/Mesa already solves. If GLX/a visual truly
//! isn't available at all (essentially never on a real X11 session),
//! `attach()` just fails with a clear error, same as the old stub did.
//!
//! Own dedicated Xlib `Display` connection, separate from GTK/WRY's own --
//! X window IDs are global to the server, not scoped to one client
//! connection (same reason tools like `xdotool` can operate on another
//! process's windows), so this needs no interop with GTK's own connection.
//! `XInitThreads` is required since this connection is touched from two
//! threads (`set_rect` from the Tauri command/main thread, `render` from
//! `spawn_render_loop`'s background thread, commands.rs) -- guarded by
//! `Once` since Xlib requires it be called at most once and before any
//! other Xlib call from this process.

use super::engine::{on_render_update, RenderWaker};
use super::surface::{Backend, RenderSurface};
use libmpv_sys::*;
use raw_window_handle::RawWindowHandle;
use std::ffi::c_void;
use std::os::raw::c_char;
use std::ptr;
use std::sync::{Arc, Mutex, Once};
use x11::glx::*;
use x11::xlib::*;

const MPV_RENDER_API_TYPE_OPENGL: &[u8] = b"opengl\0";

static INIT_THREADS: Once = Once::new();

pub(crate) fn attach(
    mpv: *mut mpv_handle,
    handle: RawWindowHandle,
    waker: &Arc<RenderWaker>,
) -> Result<(Box<dyn RenderSurface>, Backend), String> {
    let parent: u64 = match handle {
        RawWindowHandle::Xlib(h) => h.window,
        RawWindowHandle::Xcb(h) => h.window.get() as u64,
        RawWindowHandle::Wayland(_) => {
            return Err("Wayland render surface not implemented yet (ADR-0009 follow-up: EGL/wl_egl_window backend, see mpv/linux/mod.rs)".into());
        }
        _ => return Err("expected an X11 or Wayland window handle on Linux".into()),
    };

    INIT_THREADS.call_once(|| unsafe {
        XInitThreads();
    });

    X11Surface::new(mpv, parent, waker).map(|s| (Box::new(s) as Box<dyn RenderSurface>, Backend::Gpu))
}

struct X11Surface {
    display: *mut Display,
    window: Window,
    colormap: Colormap,
    ctx: GLXContext,
    render_ctx: *mut mpv_render_context,
    // current on-screen (w, h); (0, 0) while hidden. Read by `render`, written
    // by `set_rect` -- both only ever called serialized through the one
    // `Arc<Mutex<Box<dyn RenderSurface>>>` `engine.rs` holds this behind
    // (see that file's own doc), so a plain `Mutex` here is for interior
    // mutability (`&self`, not `&mut self`), not a real race to guard
    // against -- same reasoning as `mac/gpu.rs`'s `sized` field.
    size: Mutex<(i32, i32)>,
}

// `render()` runs on the render loop's background thread, `set_rect()` on
// the main thread (a Tauri command) -- never concurrently (see `size`'s
// doc), and every field here is a plain FFI handle valid from any thread
// once `XInitThreads` has run.
unsafe impl Send for X11Surface {}

impl X11Surface {
    fn new(mpv: *mut mpv_handle, parent: u64, waker: &Arc<RenderWaker>) -> Result<Self, String> {
        unsafe {
            let display = XOpenDisplay(ptr::null());
            if display.is_null() {
                return Err("XOpenDisplay returned null (no X11 display available)".into());
            }
            let screen = XDefaultScreen(display);

            let mut attribs = [GLX_RGBA, GLX_DOUBLEBUFFER, GLX_RED_SIZE, 8, GLX_GREEN_SIZE, 8, GLX_BLUE_SIZE, 8, 0];
            let vi = glXChooseVisual(display, screen, attribs.as_mut_ptr());
            if vi.is_null() {
                XCloseDisplay(display);
                return Err("glXChooseVisual returned null (no suitable GLX visual)".into());
            }

            let colormap = XCreateColormap(display, parent, (*vi).visual, AllocNone);
            let mut set_attrs: XSetWindowAttributes = std::mem::zeroed();
            set_attrs.colormap = colormap;
            set_attrs.border_pixel = 0;
            set_attrs.event_mask = NoEventMask;
            let window = XCreateWindow(
                display,
                parent,
                0,
                0,
                1,
                1, // resized by the first real `set_rect`
                0,
                (*vi).depth,
                InputOutput as u32,
                (*vi).visual,
                CWColormap | CWBorderPixel,
                &mut set_attrs,
            );
            // New X11 windows land at the *top* of their parent's stacking
            // order by default -- mac's equivalent (`mac/gpu.rs`/`software.rs`)
            // explicitly inserts its overlay view `NSWindowOrderingMode::Below`
            // the (transparent) webview; this is that same requirement for a
            // real X11 sibling window. Without it this opaque video window
            // sits *above* the webview, blocking its (transparent) controls
            // entirely instead of showing through them.
            XLowerWindow(display, window);

            let ctx = glXCreateContext(display, vi, ptr::null_mut(), 1);
            XFree(vi as *mut c_void);
            if ctx.is_null() {
                XDestroyWindow(display, window);
                XFreeColormap(display, colormap);
                XCloseDisplay(display);
                return Err("glXCreateContext returned null".into());
            }
            glXMakeCurrent(display, window, ctx);

            let api_type_ptr = MPV_RENDER_API_TYPE_OPENGL.as_ptr() as *const c_char;
            let mut init_params = mpv_opengl_init_params {
                get_proc_address: Some(glx_get_proc_address),
                get_proc_address_ctx: ptr::null_mut(),
                extra_exts: ptr::null(),
            };
            let mut params = [
                mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE, data: api_type_ptr as *mut c_void },
                mpv_render_param {
                    type_: mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
                    data: &mut init_params as *mut _ as *mut c_void,
                },
                mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID, data: ptr::null_mut() },
            ];
            let mut render_ctx: *mut mpv_render_context = ptr::null_mut();
            let rc = mpv_render_context_create(&mut render_ctx, mpv, params.as_mut_ptr());
            if rc < 0 {
                let msg = std::ffi::CStr::from_ptr(mpv_error_string(rc)).to_string_lossy().into_owned();
                glXDestroyContext(display, ctx);
                XDestroyWindow(display, window);
                XFreeColormap(display, colormap);
                XCloseDisplay(display);
                return Err(format!("mpv_render_context_create (opengl): {msg} ({rc})"));
            }
            mpv_render_context_set_update_callback(render_ctx, Some(on_render_update), Arc::as_ptr(waker) as *mut c_void);
            // Released immediately -- see `render()`'s doc on why a GLX
            // context can't be left current on this (creation) thread if
            // the first real `render()` call ends up on a different one.
            glXMakeCurrent(display, 0, ptr::null_mut());

            Ok(Self { display, window, colormap, ctx, render_ctx, size: Mutex::new((0, 0)) })
        }
    }
}

/// mpv's `MPV_RENDER_PARAM_OPENGL_INIT_PARAMS` callback -- `glXGetProcAddressARB`
/// is guaranteed available for any GL/GLX function (including core, not just
/// extension, entry points) per the `GLX_ARB_get_proc_address` spec every
/// GLX implementation ships, unlike `dlsym` which depends on how libGL
/// happens to export symbols.
unsafe extern "C" fn glx_get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    unsafe { glXGetProcAddressARB(name as *const u8).map(|f| f as *mut c_void).unwrap_or(ptr::null_mut()) }
}

impl RenderSurface for X11Surface {
    fn set_rect(&self, x: f64, y_top_left: f64, w: f64, h: f64) {
        // X11 windows are already top-left origin (unlike AppKit's
        // bottom-left `NSView`) -- no y-flip needed, `y_top_left` maps
        // straight onto `XMoveResizeWindow`.
        if w <= 0.0 || h <= 0.0 {
            unsafe { XUnmapWindow(self.display, self.window) };
            *self.size.lock().unwrap() = (0, 0);
            return;
        }
        let (xi, yi, wu, hu) = (x as i32, y_top_left as i32, w as u32, h as u32);
        unsafe {
            XMoveResizeWindow(self.display, self.window, xi, yi, wu, hu);
            XMapWindow(self.display, self.window); // harmless no-op if already mapped
            XLowerWindow(self.display, self.window); // keep it under the webview -- see `new`'s doc
        }
        *self.size.lock().unwrap() = (wu as i32, hu as i32);
        self.render();
    }

    fn render(&self) {
        if self.render_ctx.is_null() {
            return; // torn down -- see `teardown`
        }
        let (w, h) = *self.size.lock().unwrap();
        if w <= 0 || h <= 0 {
            return;
        }
        unsafe {
            // A GLX context can only ever be current on *one* thread at a
            // time (same rule WGL has, see `mpv/windows/mod.rs`'s identical
            // comment) -- `render()` here is called from both the main
            // thread (via `set_rect`, synchronously) and the render loop's
            // own background thread (`spawn_render_loop`, commands.rs),
            // never concurrently (serialized through `engine.rs`'s own
            // `Arc<Mutex<Box<dyn RenderSurface>>>`) but at *different* times
            // from *different* threads. Releasing after use (below) is what
            // lets the next thread pick it up cleanly instead of silently
            // rendering into no current context -- confirmed on Windows as
            // a hard crash for the identical bug; here it more likely just
            // produced blank/black frames instead of visibly failing.
            glXMakeCurrent(self.display, self.window, self.ctx);
            let mut fbo_param = mpv_opengl_fbo { fbo: 0, w, h, internal_format: 0 };
            // mpv's own render.h doc for MPV_RENDER_PARAM_FLIP_Y: needed
            // "e.g. when rendering to an OpenGL default framebuffer (which
            // has a flipped coordinate system)" -- exactly this fbo=0 case.
            // Without it the picture decodes and displays fine but
            // upside-down (caught on the Windows backend, same bug here).
            let mut flip_y: i32 = 1;
            let mut params = [
                mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_FBO, data: &mut fbo_param as *mut _ as *mut c_void },
                mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_FLIP_Y, data: &mut flip_y as *mut _ as *mut c_void },
                mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID, data: ptr::null_mut() },
            ];
            let rc = mpv_render_context_render(self.render_ctx, params.as_mut_ptr());
            if rc >= 0 {
                glXSwapBuffers(self.display, self.window);
            }
            // release -- see the comment above; must happen even on the
            // `rc < 0` ("no frame ready") path, not just the success path.
            glXMakeCurrent(self.display, 0, ptr::null_mut());
        }
    }

    fn teardown(&mut self) {
        unsafe {
            mpv_render_context_set_update_callback(self.render_ctx, None, ptr::null_mut());
            mpv_render_context_free(self.render_ctx);
            glXMakeCurrent(self.display, 0, ptr::null_mut());
            glXDestroyContext(self.display, self.ctx);
            XDestroyWindow(self.display, self.window);
            XFreeColormap(self.display, self.colormap);
            XCloseDisplay(self.display);
        }
        self.render_ctx = ptr::null_mut();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    // Real-hardware smoke test (issue #27's whole point: this class of bug
    // only shows up against a genuine X11/GLX session, not by reading code).
    // Renders mpv's synthetic `lavfi` test pattern into a real child X11
    // window and confirms the pixels it actually reads back aren't a flat
    // color -- catches "attach() succeeds but nothing ever draws" as well as
    // an outright GLX/mpv error. `#[ignore]`d by default (needs `DISPLAY`,
    // libmpv built with lavfi support, and a running X server) -- run with
    // `cargo test -- --ignored`.
    #[test]
    #[ignore = "needs a real X11 DISPLAY + libmpv with lavfi support"]
    fn renders_a_visible_frame_onto_a_real_x11_window() {
        unsafe {
            let display = XOpenDisplay(ptr::null());
            assert!(!display.is_null(), "no X11 display -- set DISPLAY");
            let screen = XDefaultScreen(display);
            let root = XRootWindow(display, screen);
            let parent = XCreateSimpleWindow(display, root, 0, 0, 200, 200, 0, 0, 0);
            XMapWindow(display, parent);
            XFlush(display);

            let mpv = mpv_create();
            assert!(!mpv.is_null());
            let vo = std::ffi::CString::new("vo").unwrap();
            let libmpv = std::ffi::CString::new("libmpv").unwrap();
            mpv_set_option_string(mpv, vo.as_ptr(), libmpv.as_ptr());
            assert!(mpv_initialize(mpv) >= 0);

            let waker = Arc::new(RenderWaker::default());
            let (surface, backend) =
                attach(mpv, RawWindowHandle::Xlib(raw_window_handle::XlibWindowHandle::new(parent)), &waker)
                    .expect("attach() should succeed against a real X11/GLX session");
            assert_eq!(backend, Backend::Gpu);
            surface.set_rect(0.0, 0.0, 160.0, 120.0);

            let src = std::ffi::CString::new("loadfile").unwrap();
            let url = std::ffi::CString::new("av://lavfi:testsrc=size=160x120:rate=5").unwrap();
            let replace = std::ffi::CString::new("replace").unwrap();
            let mut argv = [src.as_ptr(), url.as_ptr(), replace.as_ptr(), ptr::null()];
            assert!(mpv_command(mpv, argv.as_mut_ptr()) >= 0);

            // Poll: drive mpv's event loop (decoding is async) and render
            // whenever a frame becomes ready, until the window shows real
            // (non-uniform) pixel data or we give up.
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut saw_real_frame = false;
            while Instant::now() < deadline && !saw_real_frame {
                let ev = &*mpv_wait_event(mpv, 0.05);
                let _ = ev.event_id; // draining is enough to let the demuxer/decoder progress
                surface.render();
                XFlush(display);

                let image = XGetImage(display, parent, 0, 0, 160, 120, !0, 2 /* ZPixmap */);
                if !image.is_null() {
                    let mut colors = std::collections::HashSet::new();
                    for y in (0..120).step_by(10) {
                        for x in (0..160).step_by(10) {
                            colors.insert(XGetPixel(image, x, y));
                        }
                    }
                    XDestroyImage(image);
                    // A real SMPTE-bars-style test pattern has many distinct
                    // colors; an unpainted/black window has effectively one.
                    if colors.len() > 3 {
                        saw_real_frame = true;
                    }
                }
            }

            // Graceful shutdown, same order `Drop for MpvEngine` (engine.rs)
            // uses: `quit`, drain until MPV_EVENT_SHUTDOWN, *then* explicitly
            // tear down the render surface (`teardown`, not just `drop` --
            // `X11Surface` has no `Drop` impl, `teardown` is the only thing
            // that calls `mpv_render_context_free`), *then*
            // `mpv_terminate_destroy`. Skipping the explicit `teardown()`
            // call reliably aborts inside libmpv on this run: its own docs
            // are explicit that the render context *must* be freed before
            // the core is destroyed, "if this doesn't happen, undefined
            // behavior will result" -- confirmed by reproducing the same
            // abort in a minimal standalone program with zero `X11Surface`
            // code involved, purely from skipping that free. A real mpv
            // usage-order requirement, not a bug in `X11Surface` itself.
            let quit = std::ffi::CString::new("quit").unwrap();
            let mut quit_argv = [quit.as_ptr(), ptr::null()];
            mpv_command(mpv, quit_argv.as_mut_ptr());
            loop {
                let ev = &*mpv_wait_event(mpv, 5.0);
                if ev.event_id == mpv_event_id_MPV_EVENT_SHUTDOWN {
                    break;
                }
            }
            let mut surface = surface;
            surface.teardown();
            drop(surface);
            mpv_terminate_destroy(mpv);

            XDestroyWindow(display, parent);
            XCloseDisplay(display);

            assert!(saw_real_frame, "window never showed a non-uniform frame within 10s");
        }
    }
}
