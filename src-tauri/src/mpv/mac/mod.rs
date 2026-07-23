//! Mac-specific half of the mpv render backend (ADR-0009). Everything
//! Cocoa/OpenGL/IOSurface/Metal-specific lives here, behind the
//! [`RenderSurface`] trait (`mpv/surface.rs`, platform-neutral) -- `engine.rs`
//! (mpv lifecycle, command dispatch, the pending-operations queue, tick/
//! property observation) only ever calls mpv's plain C API and never learns
//! which backend is active, or that a GPU→CPU fallback happened. The
//! `windows`/`linux` sibling modules plug in the same way: their own module,
//! their own `attach()`, same trait.

mod gpu;
mod software;

use super::engine::RenderWaker;
use super::surface::{try_or_fallback, Backend, RenderSurface};
use libmpv_sys::mpv_handle;
use objc2_app_kit::NSView;
use raw_window_handle::RawWindowHandle;
use std::sync::Arc;

/// The one entry point the shared engine calls. `engine.rs` (platform-
/// agnostic) hands over a bare `RawWindowHandle` -- unwrapping it into a
/// real `NSView` is this module's own job, same as everything else
/// AppKit-specific. Tries the GPU surface first, falling back to the CPU
/// path on any setup failure; the caller only learns which backend it got,
/// never *why* a fallback happened beyond the diagnostic line below.
pub(crate) fn attach(
    mpv: *mut mpv_handle,
    handle: RawWindowHandle,
    waker: &Arc<RenderWaker>,
) -> Result<(Box<dyn RenderSurface>, Backend), String> {
    let RawWindowHandle::AppKit(appkit) = handle else {
        return Err("expected an AppKit window handle on macOS".into());
    };
    // # Safety: `ns_view` is a non-owning pointer to the window's content
    // view (raw-window-handle's own documented contract for this variant);
    // the window itself keeps ownership for as long as `attach`'s caller
    // (`MpvEngine::attach`) holds it. Neither this cast nor the backends'
    // own `NSView::alloc` check main-thread affinity -- preserved as-is
    // rather than adding a new runtime check as a drive-by (ADR-0009).
    let content_view: &NSView = unsafe { &*(appkit.ns_view.as_ptr() as *const NSView) };

    let (result, backend) = try_or_fallback(
        || gpu::GpuSurface::new(mpv, content_view, waker).map(|s| Box::new(s) as Box<dyn RenderSurface>),
        || software::SoftwareSurface::new(mpv, content_view, waker).map(|s| Box::new(s) as Box<dyn RenderSurface>),
    );
    result.map(|surface| (surface, backend))
}

// `try_or_fallback` (the GPU-vs-CPU decision + its tests) now lives in
// `mpv/surface.rs`, shared with the `windows`/`linux` backends.
