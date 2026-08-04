//! X11/GLX half of the Linux render backend (ADR-0009). linux/mod.rs dispatches here for Xlib/Xcb window handles, wayland.rs (issue #27) for Wayland ones.
//! Shares render-context creation and GL-single-thread dance with windows/mod.rs via gl_surface.rs's GlRenderSurface/DesktopGl; this module is GLX-specific ops only.
//! Plain opaque child X11 window sized to the placeholder rect, glXSwapBuffers presents onto it, X clipping keeps the transparent webview off that rect -- no zero-copy handoff needed unlike mac/gpu.rs.
//! No CPU fallback needed (unlike mac): GLX already falls back to Mesa's llvmpipe at the driver level.
//! Own dedicated Xlib Display connection (X window IDs are global, no GTK/WRY interop needed); XInitThreads guarded by Once since Xlib requires it called at most once before any other call.
//! Installs a non-fatal XSetErrorHandler once -- Xlib's default handler calls exit() on any unhandled X protocol error (e.g. a stray BadWindow from a resize race), which would take down the app.

use super::engine::RenderWaker;
use super::gl_surface::{create_render_context, DesktopGl, GlRenderSurface};
use super::surface::{Backend, RenderSurface};
use libmpv_sys::*;
use raw_window_handle::RawWindowHandle;
use std::ffi::c_void;
use std::os::raw::{c_char, c_int};
use std::ptr;
use std::sync::{Arc, Once};
use x11::glx::*;
use x11::xlib::*;

static INIT_X11: Once = Once::new();

pub(crate) fn attach(
    mpv: *mut mpv_handle,
    handle: RawWindowHandle,
    waker: &Arc<RenderWaker>,
) -> Result<(Box<dyn RenderSurface>, Backend), String> {
    let parent: u64 = match handle {
        RawWindowHandle::Xlib(h) => h.window,
        RawWindowHandle::Xcb(h) => h.window.get() as u64,
        _ => return Err("expected an Xlib or Xcb window handle".into()),
    };

    INIT_X11.call_once(|| unsafe {
        XInitThreads();
        XSetErrorHandler(Some(nonfatal_x_error_handler));
    });

    let mut platform = X11Surface::new(parent)?;
    // platform's GL context is current here (new()'s last step), required for mpv_render_context_create; released right after either way, see DesktopGl::release_current's doc.
    let result = unsafe { create_render_context(mpv, glx_get_proc_address, waker) };
    platform.release_current();
    match result {
        Ok(render_ctx) => Ok((Box::new(GlRenderSurface::new(platform, render_ctx)) as Box<dyn RenderSurface>, Backend::Gpu)),
        Err(e) => {
            platform.destroy(); // nothing else owns this window/context now
            Err(e)
        }
    }
}

/// Logs and swallows an X protocol error instead of letting Xlib's default handler exit() the whole process.
unsafe extern "C" fn nonfatal_x_error_handler(_display: *mut Display, event: *mut XErrorEvent) -> c_int {
    let code = unsafe { (*event).error_code };
    eprintln!("mpv: X11 protocol error {code} (ignored -- see mpv/linux/mod.rs's XSetErrorHandler doc)");
    0
}

struct X11Surface {
    display: *mut Display,
    window: Window,
    colormap: Colormap,
    ctx: GLXContext,
}

// render()/reposition_or_hide() run on the render loop's background thread and main thread respectively, never concurrently (engine.rs serializes both via one mutex) -- fields are plain FFI handles valid from any thread once XInitThreads has run.
unsafe impl Send for X11Surface {}

impl X11Surface {
    fn new(parent: u64) -> Result<Self, String> {
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
                1, // resized by the first real set_rect
                0,
                (*vi).depth,
                InputOutput as u32,
                (*vi).visual,
                CWColormap | CWBorderPixel,
                &mut set_attrs,
            );
            // New X11 windows land at the top of the parent's stacking order by default -- same requirement mac's overlay view solves with NSWindowOrderingMode::Below; without this the opaque video window blocks the transparent webview controls.
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

            Ok(Self { display, window, colormap, ctx })
        }
    }
}

/// mpv's OPENGL_INIT_PARAMS callback -- glXGetProcAddressARB is guaranteed available for any GL/GLX function per GLX_ARB_get_proc_address, unlike dlsym which depends on how libGL exports symbols.
unsafe extern "C" fn glx_get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    unsafe { glXGetProcAddressARB(name as *const u8).map(|f| f as *mut c_void).unwrap_or(ptr::null_mut()) }
}

impl DesktopGl for X11Surface {
    fn make_current(&self) -> bool {
        // Checked now -- an unchecked failure here previously fell through to mpv_render_context_render with no current context, the likely cause of a "renders black" symptom instead of Windows's harder crash.
        unsafe { glXMakeCurrent(self.display, self.window, self.ctx) != 0 }
    }

    fn release_current(&self) {
        unsafe {
            glXMakeCurrent(self.display, 0, ptr::null_mut());
        }
    }

    fn swap_buffers(&self) {
        unsafe {
            glXSwapBuffers(self.display, self.window);
        }
    }

    fn reposition_or_hide(&self, x: f64, y_top_left: f64, w: f64, h: f64) {
        // X11 windows are already top-left origin (unlike AppKit's bottom-left NSView) -- no y-flip needed.
        if w <= 0.0 || h <= 0.0 {
            unsafe { XUnmapWindow(self.display, self.window) };
            return;
        }
        let (xi, yi, wu, hu) = (x as i32, y_top_left as i32, w as u32, h as u32);
        unsafe {
            XMoveResizeWindow(self.display, self.window, xi, yi, wu, hu);
            XMapWindow(self.display, self.window); // harmless no-op if already mapped
            XLowerWindow(self.display, self.window); // keep it under the webview
        }
    }

    fn destroy(&mut self) {
        unsafe {
            // Always release before delete, even on the "render-context creation failed" path -- same reasoning as WglSurface::destroy.
            glXMakeCurrent(self.display, 0, ptr::null_mut());
            glXDestroyContext(self.display, self.ctx);
            XDestroyWindow(self.display, self.window);
            XFreeColormap(self.display, self.colormap);
            XCloseDisplay(self.display);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    // Real-hardware smoke test (issue #27: this bug class only shows up against a genuine X11/GLX session).
    // Renders mpv's lavfi test pattern into a real child X11 window, confirms readback isn't a flat color --
    // catches "attach() succeeds but nothing draws" as well as a GLX/mpv error. #[ignore]d by default (needs
    // DISPLAY + libmpv with lavfi support), run with `cargo test -- --ignored`.
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
                let _ = ev.event_id; // draining lets the demuxer/decoder progress
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

            // Graceful shutdown, same order Drop for MpvEngine uses: quit, drain until SHUTDOWN, explicit
            // teardown() (frees the render context -- GlRenderSurface has no Drop impl), then mpv_terminate_destroy.
            // Skipping teardown() reliably aborts inside libmpv: its docs require the render context freed
            // before the core is destroyed -- confirmed by reproducing the same abort standalone, no X11Surface involved.
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
