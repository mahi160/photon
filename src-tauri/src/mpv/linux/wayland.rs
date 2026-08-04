//! Wayland half of the Linux render backend (ADR-0009 follow-up, issue #27) -- EGL onto a `wl_subsurface`
//! instead of GLX onto a plain X11 child window (x11.rs). Same job as x11.rs (an opaque surface, positioned
//! under the transparent webview, that mpv's render API draws into), different mechanism because Wayland has
//! no reparenting child windows: the compositor owns stacking/positioning via the subsurface protocol instead.
//!
//! We open a *second*, independent wayland-client connection onto the *same* `wl_display` WRY/GTK already
//! holds (`Backend::from_foreign_display`, its own sanctioned "plug into someone else's connection" mode --
//! server events aimed at objects we didn't create are silently dropped once we're gone, which is fine, we
//! never expect any). The window's own `wl_surface` (from Tauri's `RawWindowHandle::Wayland`) is imported
//! read-only into that connection (`ObjectId::from_ptr`) purely to hand it to `wl_subcompositor.get_subsurface`
//! as the parent -- we never send it a destroy request, GTK still owns it.
//!
//! ponytail: first cut, unverified against a real Wayland compositor (no dev machine with one available --
//! this was written from documented crate APIs, not compiled). Smoke-test before relying on it; the "expected
//! an Xlib/Xcb/Wayland window handle" error elsewhere is the safe fallback if attach() bails.

use super::super::engine::RenderWaker;
use super::super::gl_surface::{create_render_context, DesktopGl, GlRenderSurface};
use super::super::surface::{Backend, RenderSurface};
use khronos_egl as egl;
use libmpv_sys::*;
use raw_window_handle::{RawDisplayHandle, RawWindowHandle};
use std::ffi::c_void;
use std::os::raw::c_char;
use std::sync::{Arc, OnceLock};
use wayland_backend::sys::client::{Backend as WlBackend, ObjectId};
use wayland_client::globals::{registry_queue_init, GlobalListContents};
use wayland_client::protocol::{
    wl_compositor::WlCompositor, wl_registry::WlRegistry, wl_subcompositor::WlSubcompositor, wl_subsurface::WlSubsurface,
    wl_surface::WlSurface,
};
use wayland_client::{delegate_noop, Connection, Dispatch, Proxy, QueueHandle};
use wayland_egl::WlEglSurface;

/// EGL entry points, dlopen'd once (`khronos-egl`'s `dynamic` feature) -- mpv's get_proc_address callback
/// has no context pointer to carry this through (create_render_context always passes null, see gl_surface.rs),
/// so it has to come from a static instead.
static EGL: OnceLock<egl::DynamicInstance<egl::EGL1_2>> = OnceLock::new();

struct AppState;
delegate_noop!(AppState: ignore WlCompositor);
delegate_noop!(AppState: ignore WlSubcompositor);
delegate_noop!(AppState: ignore WlSurface);
delegate_noop!(AppState: ignore WlSubsurface);

impl Dispatch<WlRegistry, GlobalListContents> for AppState {
    fn event(
        _: &mut Self,
        _: &WlRegistry,
        _: wayland_client::protocol::wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        // No dynamic global add/remove handling needed -- compositor/subcompositor are grabbed once at
        // startup from the initial registry snapshot registry_queue_init already gives us.
    }
}

pub(crate) fn attach(
    mpv: *mut mpv_handle,
    handle: RawWindowHandle,
    display_handle: RawDisplayHandle,
    waker: &Arc<RenderWaker>,
) -> Result<(Box<dyn RenderSurface>, Backend), String> {
    let RawWindowHandle::Wayland(win) = handle else {
        return Err("expected a Wayland window handle".into());
    };
    let RawDisplayHandle::Wayland(disp) = display_handle else {
        return Err("expected a Wayland display handle alongside the Wayland window handle".into());
    };

    let mut platform = WaylandSurface::new(disp.display.as_ptr(), win.surface.as_ptr())?;
    // platform's EGL context is current here (new()'s last step), required for mpv_render_context_create; released right after either way, see DesktopGl::release_current's doc.
    let result = unsafe { create_render_context(mpv, egl_get_proc_address, waker) };
    platform.release_current();
    match result {
        Ok(render_ctx) => Ok((Box::new(GlRenderSurface::new(platform, render_ctx)) as Box<dyn RenderSurface>, Backend::Gpu)),
        Err(e) => {
            platform.destroy(); // nothing else owns this subsurface/context now
            Err(e)
        }
    }
}

/// mpv's OPENGL_INIT_PARAMS callback -- looks up `eglGetProcAddress` through the dlopen'd EGL instance
/// `WaylandSurface::new` populates; `EGL` is guaranteed set by the time mpv calls this (create_render_context
/// runs after `new()` returns).
unsafe extern "C" fn egl_get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    let Some(egl) = EGL.get() else { return std::ptr::null_mut() };
    let name = unsafe { std::ffi::CStr::from_ptr(name) };
    let Ok(name) = name.to_str() else { return std::ptr::null_mut() };
    egl.get_proc_address(name).map(|f| f as *mut c_void).unwrap_or(std::ptr::null_mut())
}

struct WaylandSurface {
    // Kept alive for the connection's lifetime even though nothing reads them again after setup --
    // dropping any of compositor/subcompositor/subsurface would be a protocol object leak on the
    // server side (their destructors never run), not just an unused-value warning.
    _conn: Connection,
    _compositor: WlCompositor,
    _subcompositor: WlSubcompositor,
    child_surface: WlSurface,
    subsurface: WlSubsurface,
    egl_window: WlEglSurface,
    egl_display: egl::Display,
    egl_surface: egl::Surface,
    egl_context: egl::Context,
}

// render()/reposition_or_hide() run on the render loop's background thread and main thread respectively,
// never concurrently (engine.rs serializes both via one mutex) -- same rationale as X11Surface's impl Send.
unsafe impl Send for WaylandSurface {}

impl WaylandSurface {
    fn new(display_ptr: *mut c_void, parent_surface_ptr: *mut c_void) -> Result<Self, String> {
        // Second connection onto WRY/GTK's existing wl_display -- see module doc. Safety: display_ptr comes
        // straight from Tauri's own HasDisplayHandle, so it outlives this call by construction.
        let backend = unsafe { WlBackend::from_foreign_display(display_ptr.cast()) }
            .map_err(|e| format!("Backend::from_foreign_display: {e}"))?;
        let conn = Connection::from_backend(backend);

        let (globals, mut queue) = registry_queue_init::<AppState>(&conn).map_err(|e| format!("registry_queue_init: {e}"))?;
        let qh = queue.handle();
        let compositor: WlCompositor =
            globals.bind(&qh, 1..=6, ()).map_err(|e| format!("no wl_compositor global: {e}"))?;
        let subcompositor: WlSubcompositor =
            globals.bind(&qh, 1..=1, ()).map_err(|e| format!("no wl_subcompositor global: {e}"))?;

        // Read-only import of the *foreign* parent wl_surface (owned by WRY/GTK) so it can be named as
        // get_subsurface's parent -- we never destroy it or otherwise take ownership, see module doc.
        let parent_id = unsafe { ObjectId::from_ptr(WlSurface::interface(), parent_surface_ptr.cast()) }
            .map_err(|e| format!("ObjectId::from_ptr (parent wl_surface): {e}"))?;
        let parent_surface =
            WlSurface::from_id(&conn, parent_id).map_err(|e| format!("WlSurface::from_id (parent): {e}"))?;

        let child_surface = compositor.create_surface(&qh, ());
        let subsurface = subcompositor.get_subsurface(&child_surface, &parent_surface, &qh, ());
        // Our commits (each render()) must not wait on the parent (WRY's webview) committing too -- default
        // sync mode would otherwise stall/batch our frames behind whatever cadence GTK repaints on.
        subsurface.set_desync();
        subsurface.set_position(0, 0);
        child_surface.commit();

        // Land the surface/subsurface/bind requests before EGL touches the same objects.
        conn.flush().map_err(|e| format!("Connection::flush: {e}"))?;
        queue.roundtrip(&mut AppState).map_err(|e| format!("initial roundtrip: {e}"))?;

        // 1x1 placeholder, like X11Surface -- resized by the first real set_rect.
        let egl_window = unsafe { WlEglSurface::new(child_surface.id(), 1, 1) }.map_err(|e| format!("WlEglSurface::new: {e}"))?;

        let egl = EGL.get_or_init(|| unsafe { egl::DynamicInstance::<egl::EGL1_2>::load_required() }.expect("libEGL.so.1 not found"));
        let egl_display = unsafe { egl.get_display(display_ptr) }.ok_or("eglGetDisplay returned null")?;
        egl.initialize(egl_display).map_err(|e| format!("eglInitialize: {e}"))?;
        egl.bind_api(egl::OPENGL_API).map_err(|e| format!("eglBindAPI(EGL_OPENGL_API): {e}"))?;

        let config_attribs = [
            egl::SURFACE_TYPE,
            egl::WINDOW_BIT,
            egl::RENDERABLE_TYPE,
            egl::OPENGL_BIT,
            egl::RED_SIZE,
            8,
            egl::GREEN_SIZE,
            8,
            egl::BLUE_SIZE,
            8,
            egl::NONE,
        ];
        let config = egl
            .choose_first_config(egl_display, &config_attribs)
            .map_err(|e| format!("eglChooseConfig: {e}"))?
            .ok_or("no matching EGL config (RGBA8, window-capable, desktop GL)")?;

        let egl_context = egl
            .create_context(egl_display, config, None, &[egl::NONE])
            .map_err(|e| format!("eglCreateContext: {e}"))?;

        let egl_surface = unsafe { egl.create_window_surface(egl_display, config, egl_window.ptr() as egl::NativeWindowType, None) }
            .map_err(|e| format!("eglCreateWindowSurface: {e}"))?;

        egl.make_current(egl_display, Some(egl_surface), Some(egl_surface), Some(egl_context))
            .map_err(|e| format!("eglMakeCurrent: {e}"))?;

        Ok(Self {
            _conn: conn,
            _compositor: compositor,
            _subcompositor: subcompositor,
            child_surface,
            subsurface,
            egl_window,
            egl_display,
            egl_surface,
            egl_context,
        })
    }
}

impl DesktopGl for WaylandSurface {
    fn make_current(&self) -> bool {
        let Some(egl) = EGL.get() else { return false };
        egl.make_current(self.egl_display, Some(self.egl_surface), Some(self.egl_surface), Some(self.egl_context)).is_ok()
    }

    fn release_current(&self) {
        if let Some(egl) = EGL.get() {
            let _ = egl.make_current(self.egl_display, None, None, None);
        }
    }

    fn swap_buffers(&self) {
        if let Some(egl) = EGL.get() {
            let _ = egl.swap_buffers(self.egl_display, self.egl_surface);
        }
    }

    fn reposition_or_hide(&self, x: f64, y_top_left: f64, w: f64, h: f64) {
        // Wayland surfaces are already top-left origin (like X11, unlike AppKit's bottom-left NSView).
        if w <= 0.0 || h <= 0.0 {
            // No "unmap" concept for a subsurface -- attaching a null buffer is the equivalent of X11's
            // XUnmapWindow: the compositor stops showing old content without destroying the surface.
            self.child_surface.attach(None, 0, 0);
            self.child_surface.commit();
            return;
        }
        self.subsurface.set_position(x as i32, y_top_left as i32);
        self.egl_window.resize(w as i32, h as i32, 0, 0);
        self.child_surface.commit();
    }

    fn destroy(&mut self) {
        if let Some(egl) = EGL.get() {
            let _ = egl.make_current(self.egl_display, None, None, None);
            let _ = egl.destroy_surface(self.egl_display, self.egl_surface);
            let _ = egl.destroy_context(self.egl_display, self.egl_context);
        }
        // egl_window (the wl_egl_window) must go before the wl_surface it wraps -- WlEglSurface's own
        // Drop handles that; child_surface/subsurface destructors run via their Rust Drop impls too.
    }
}
