//! Shared "render GL onto a plain child window's default framebuffer" backend for windows/mod.rs (WGL) and linux/mod.rs (GLX) -- was ~150 duplicated lines each, including one hard bug (GL context current on one thread at a time, release-after-every-use between main and render threads); now fixed once, here.
//! Each platform only implements [`DesktopGl`] (window/context creation, per-frame/per-resize ops); doesn't cover mac's backends since GpuSurface/SoftwareSurface don't share this file's shape.

use super::engine::{on_render_update, RenderWaker};
use super::surface::{skip_frame, RenderSurface};
use libmpv_sys::*;
use std::ffi::{c_void, CStr};
use std::os::raw::c_char;
use std::sync::{Arc, Mutex};

// Compiled (unused) on non-Windows too, so this file's tests can run everywhere -- see mpv/mod.rs.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const MPV_RENDER_API_TYPE_OPENGL: &[u8] = b"opengl\0";

/// What one render tick should do. Split out of `render` so the rules -- a torn-down surface touches
/// nothing, a hidden one still *drains* mpv's queued frame -- are testable without a GL context or a
/// live mpv handle.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum Tick {
    Nothing,
    Skip,
    Draw { w: i32, h: i32 },
}

fn plan_tick(torn_down: bool, (w, h): (i32, i32)) -> Tick {
    if torn_down {
        Tick::Nothing
    } else if w <= 0 || h <= 0 {
        Tick::Skip
    } else {
        Tick::Draw { w, h }
    }
}

/// What a platform must provide so [`GlRenderSurface`] can own the rest -- window/GL-context creation
/// is each platform's own job (attach() builds one already current before touching this module).
pub(crate) trait DesktopGl: Send {
    /// Makes this platform's GL context current. `false` means skip this frame, try again next tick.
    fn make_current(&self) -> bool;
    /// Releases the context, must run after every make_current even on a no-frame tick -- otherwise the
    /// next thread's make_current fails against a context still considered current elsewhere (hard crash on Windows, black/frozen frame on Linux).
    fn release_current(&self);
    /// Presents the frame render() just drew (double-buffer swap).
    fn swap_buffers(&self);
    /// Repositions/resizes to content-view-local rect (points, top-left origin), or hides when w/h is zero.
    fn reposition_or_hide(&self, x: f64, y_top_left: f64, w: f64, h: f64);
    /// Frees GL-context/window resources. Called at most once, from teardown() or directly by attach() if mpv's render-context creation fails after a successful window/context setup.
    fn destroy(&mut self);
}

/// Creates the mpv GL render context against whatever GL context the caller already made current, wires up on_render_update -- never touches caller's window/context resources, on Err caller's own attach() tears those down.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) unsafe fn create_render_context(
    mpv: *mut mpv_handle,
    get_proc_address: unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void,
    waker: &Arc<RenderWaker>,
) -> Result<*mut mpv_render_context, String> {
    let api_type_ptr = MPV_RENDER_API_TYPE_OPENGL.as_ptr() as *const c_char;
    let mut init_params =
        mpv_opengl_init_params { get_proc_address: Some(get_proc_address), get_proc_address_ctx: std::ptr::null_mut(), extra_exts: std::ptr::null() };
    let mut params = [
        mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE, data: api_type_ptr as *mut c_void },
        mpv_render_param {
            type_: mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
            data: &mut init_params as *mut _ as *mut c_void,
        },
        mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
    ];
    let mut render_ctx: *mut mpv_render_context = std::ptr::null_mut();
    unsafe {
        let rc = mpv_render_context_create(&mut render_ctx, mpv, params.as_mut_ptr());
        if rc < 0 {
            let msg = CStr::from_ptr(mpv_error_string(rc)).to_string_lossy().into_owned();
            return Err(format!("mpv_render_context_create (opengl): {msg} ({rc})"));
        }
        mpv_render_context_set_update_callback(render_ctx, Some(on_render_update), Arc::as_ptr(waker) as *mut c_void);
    }
    Ok(render_ctx)
}

/// Shared `RenderSurface` impl every desktop-GL backend gets for free -- set_rect repositions/stores size/renders if visible; render does make-current, fbo=0/FLIP_Y=1 (default-framebuffer coords, unlike mac's own-FBO GpuSurface), mpv_render_context_render, swap-if-ok, release; teardown unregisters callback then frees context then platform-destroys.
pub(crate) struct GlRenderSurface<P: DesktopGl> {
    platform: P,
    render_ctx: *mut mpv_render_context,
    size: Mutex<(i32, i32)>, // current on-screen (w, h), (0, 0) while hidden -- Mutex here is for interior mutability (&self), not a real race (engine.rs serializes calls)
}

// render_ctx is a raw pointer (not auto-Send) -- safe for the same reason WglSurface/X11Surface are: only touched from render's background thread and set_rect's main thread, serialized by engine.rs's mutex.
unsafe impl<P: DesktopGl> Send for GlRenderSurface<P> {}

impl<P: DesktopGl> GlRenderSurface<P> {
    pub(crate) fn new(platform: P, render_ctx: *mut mpv_render_context) -> Self {
        Self { platform, render_ctx, size: Mutex::new((0, 0)) }
    }
}

impl<P: DesktopGl> RenderSurface for GlRenderSurface<P> {
    fn set_rect(&self, x: f64, y_top_left: f64, w: f64, h: f64) {
        self.platform.reposition_or_hide(x, y_top_left, w, h);
        let stored = if w <= 0.0 || h <= 0.0 { (0, 0) } else { (w as i32, h as i32) };
        *self.size.lock().unwrap() = stored;
        if stored.0 > 0 && stored.1 > 0 {
            self.render();
        }
    }

    fn render(&self) {
        let size = *self.size.lock().unwrap();
        let tick = plan_tick(self.render_ctx.is_null(), size);
        if tick == Tick::Nothing {
            return; // torn down
        }
        if !self.platform.make_current() {
            return; // couldn't acquire the context this tick, try again next
        }
        let Tick::Draw { w, h } = tick else {
            // Hidden (or not yet placed): consume the frame instead of leaving it queued, see skip_frame.
            unsafe { skip_frame(self.render_ctx) };
            self.platform.release_current();
            return;
        };
        let mut fbo_param = mpv_opengl_fbo { fbo: 0, w, h, internal_format: 0 };
        let mut flip_y: i32 = 1;
        let mut params = [
            mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_FBO, data: &mut fbo_param as *mut _ as *mut c_void },
            mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_FLIP_Y, data: &mut flip_y as *mut _ as *mut c_void },
            mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
        ];
        let rc = unsafe { mpv_render_context_render(self.render_ctx, params.as_mut_ptr()) };
        if rc >= 0 {
            self.platform.swap_buffers();
            // Tell mpv when the frame actually hit the screen so it can estimate vsync -- without this it
            // has no display timing at all and stays in the drop/dupe regime (24p on 60Hz judder).
            // Called after the swap, context still current, and only for frames we really presented
            // (render.h: reporting inconsistently is worse than not reporting).
            unsafe { mpv_render_context_report_swap(self.render_ctx) };
        }
        self.platform.release_current(); // must happen even on the "no frame ready" path
    }

    fn teardown(&mut self) {
        unsafe {
            mpv_render_context_set_update_callback(self.render_ctx, None, std::ptr::null_mut());
            mpv_render_context_free(self.render_ctx);
        }
        self.platform.destroy();
        self.render_ctx = std::ptr::null_mut();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    // Pure Rust, no GL/mpv FFI -- records every reposition_or_hide call instead of touching a real window.
    // render_ctx: null mirrors the "torn down" state render() already guards against, keeping tests away
    // from calling mpv_render_context_render against a fake pointer while still exercising set_rect logic.
    #[derive(Default)]
    struct FakeGl {
        rects: StdMutex<Vec<(f64, f64, f64, f64)>>,
        made_current: StdMutex<u32>,
        released: StdMutex<u32>,
        swaps: StdMutex<u32>,
    }

    impl DesktopGl for FakeGl {
        fn make_current(&self) -> bool {
            *self.made_current.lock().unwrap() += 1;
            true
        }
        fn release_current(&self) {
            *self.released.lock().unwrap() += 1;
        }
        fn swap_buffers(&self) {
            *self.swaps.lock().unwrap() += 1;
        }
        fn reposition_or_hide(&self, x: f64, y_top_left: f64, w: f64, h: f64) {
            self.rects.lock().unwrap().push((x, y_top_left, w, h));
        }
        fn destroy(&mut self) {}
    }

    fn surface() -> GlRenderSurface<FakeGl> {
        GlRenderSurface::new(FakeGl::default(), std::ptr::null_mut())
    }

    #[test]
    fn zero_size_hides_and_clears_stored_size() {
        let s = surface();
        s.set_rect(10.0, 20.0, 0.0, 0.0);
        assert_eq!(*s.size.lock().unwrap(), (0, 0));
        assert_eq!(s.platform.rects.lock().unwrap().as_slice(), &[(10.0, 20.0, 0.0, 0.0)]);
    }

    #[test]
    fn negative_size_is_treated_as_hidden_too() {
        let s = surface();
        s.set_rect(0.0, 0.0, -5.0, 100.0);
        assert_eq!(*s.size.lock().unwrap(), (0, 0));
    }

    #[test]
    fn real_size_repositions_and_stores_truncated_integer_size() {
        let s = surface();
        s.set_rect(12.5, 8.0, 100.4, 50.9);
        assert_eq!(*s.size.lock().unwrap(), (100, 50));
        assert_eq!(s.platform.rects.lock().unwrap().as_slice(), &[(12.5, 8.0, 100.4, 50.9)]);
    }

    #[test]
    fn a_torn_down_surface_is_a_safe_render_no_op() {
        // render_ctx is null -- render() must return before reaching a platform call or mpv FFI.
        let s = surface();
        s.set_rect(0.0, 0.0, 200.0, 100.0); // stores a real size...
        s.render(); // ...but this must still be a no-op, not a crash
        assert_eq!(*s.platform.made_current.lock().unwrap(), 0);
    }

    #[test]
    fn a_hidden_surface_drains_the_frame_instead_of_ignoring_it() {
        // Hidden used to mean "return early", which leaves mpv's frame queued forever and makes the core
        // log "mpv_render_context_render() not being called or stuck" -- audio keeps running, video
        // timing rots. It must consume the frame (without presenting anything) instead.
        assert_eq!(plan_tick(false, (0, 0)), Tick::Skip);
        assert_eq!(plan_tick(false, (-1, 100)), Tick::Skip);
        assert_eq!(plan_tick(false, (1280, 720)), Tick::Draw { w: 1280, h: 720 });
    }

    #[test]
    fn a_torn_down_surface_outranks_everything_else() {
        // Freed render context: no platform call, no mpv FFI, whatever the size says.
        assert_eq!(plan_tick(true, (1280, 720)), Tick::Nothing);
        assert_eq!(plan_tick(true, (0, 0)), Tick::Nothing);
    }
}
