//! Linux half of the mpv render backend (ADR-0009's `RenderSurface` seam,
//! `mpv/surface.rs`). **Stub only** -- no GLX (X11) or EGL (Wayland) surface
//! has been written yet, `attach()` always returns a clear "not implemented"
//! error. This exists so the crate compiles/links on Linux at all (real
//! libmpv linkage is a plain pkg-config probe, see build.rs) and so
//! `MpvEngine::attach` fails with an explicit message instead of a build
//! break -- not so playback actually renders video on this platform yet.
//!
//! One binary needs to handle *both* X11 and Wayland here -- unlike
//! Windows/macOS there's no single native windowing API, `raw-window-handle`
//! hands back an `Xlib`/`Xcb` variant under X11 and a `Wayland` variant under
//! Wayland (WRY/GTK pick the backend at runtime, same as any GTK app). To
//! finish this: GLX off the `Xlib`/`Xcb` display for the X11 case, EGL
//! (`wl_egl_window`) off the `Wayland` display/surface for the Wayland case,
//! then the same `mpv_render_context_create`
//! (`MPV_RENDER_PARAM_API_TYPE_OPENGL`) / `render()` / `teardown()` shape as
//! `mac/gpu.rs`.

use super::engine::RenderWaker;
use super::surface::{Backend, RenderSurface};
use libmpv_sys::mpv_handle;
use raw_window_handle::RawWindowHandle;
use std::sync::Arc;

pub(crate) fn attach(
    _mpv: *mut mpv_handle,
    handle: RawWindowHandle,
    _waker: &Arc<RenderWaker>,
) -> Result<(Box<dyn RenderSurface>, Backend), String> {
    match handle {
        RawWindowHandle::Xlib(_) | RawWindowHandle::Xcb(_) | RawWindowHandle::Wayland(_) => {}
        _ => return Err("expected an X11 or Wayland window handle on Linux".into()),
    }
    Err("Linux render surface not implemented yet (ADR-0009 follow-up: GLX/EGL backend for X11 and Wayland, see mpv/linux/mod.rs)".into())
}
