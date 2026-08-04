//! Mac half of mpv render backend (ADR-0009). Cocoa/OpenGL/IOSurface/Metal lives here behind [`RenderSurface`] (`mpv/surface.rs`) -- engine.rs never learns which backend is active or that a GPU->CPU fallback happened. windows/linux plug in the same way.

mod gpu;
mod software;

use super::engine::RenderWaker;
use super::surface::{try_or_fallback, Backend, RenderSurface};
use libmpv_sys::mpv_handle;
use objc2_app_kit::NSView;
use raw_window_handle::{RawDisplayHandle, RawWindowHandle};
use std::sync::Arc;

/// Entry point the shared engine calls. Unwraps the bare `RawWindowHandle` into a real `NSView`, tries GPU first, falls back to CPU on setup failure. Caller only learns which backend it got, not why.
pub(crate) fn attach(
    mpv: *mut mpv_handle,
    handle: RawWindowHandle,
    _display_handle: RawDisplayHandle, // unused here -- only linux/wayland.rs needs the display handle (wl_display), see engine.rs's attach
    waker: &Arc<RenderWaker>,
) -> Result<(Box<dyn RenderSurface>, Backend), String> {
    let RawWindowHandle::AppKit(appkit) = handle else {
        return Err("expected an AppKit window handle on macOS".into());
    };
    // SAFETY: ns_view is a non-owning pointer per raw-window-handle's contract; window keeps ownership. No main-thread-affinity check here, preserved as-is (ADR-0009).
    let content_view: &NSView = unsafe { &*(appkit.ns_view.as_ptr() as *const NSView) };

    let (result, backend) = try_or_fallback(
        || gpu::GpuSurface::new(mpv, content_view, waker).map(|s| Box::new(s) as Box<dyn RenderSurface>),
        || software::SoftwareSurface::new(mpv, content_view, waker).map(|s| Box::new(s) as Box<dyn RenderSurface>),
    );
    result.map(|surface| (surface, backend))
}

// `try_or_fallback` (GPU-vs-CPU decision + tests) lives in mpv/surface.rs, shared with windows/linux.
