//! Linux half of mpv render backend (ADR-0009). Picks x11.rs (GLX, Xlib/Xcb window handles) or
//! wayland.rs (EGL + wl_subsurface, issue #27) based on which raw window handle Tauri/WRY hands us --
//! both share render-context creation and the GL-single-thread dance with windows/mod.rs via gl_surface.rs.

mod wayland;
mod x11;

use super::engine::RenderWaker;
use super::surface::{Backend, RenderSurface};
use libmpv_sys::mpv_handle;
use raw_window_handle::{RawDisplayHandle, RawWindowHandle};
use std::sync::Arc;

pub(crate) fn attach(
    mpv: *mut mpv_handle,
    handle: RawWindowHandle,
    display_handle: RawDisplayHandle,
    waker: &Arc<RenderWaker>,
) -> Result<(Box<dyn RenderSurface>, Backend), String> {
    match handle {
        RawWindowHandle::Xlib(_) | RawWindowHandle::Xcb(_) => x11::attach(mpv, handle, waker),
        RawWindowHandle::Wayland(_) => wayland::attach(mpv, handle, display_handle, waker),
        _ => Err("expected an X11 or Wayland window handle on Linux".into()),
    }
}
