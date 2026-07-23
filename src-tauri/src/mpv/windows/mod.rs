//! Windows half of the mpv render backend (ADR-0009's `RenderSurface` seam,
//! `mpv/surface.rs`). **Stub only** -- no WGL/D3D11 surface has been written
//! yet, `attach()` always returns a clear "not implemented" error. This
//! exists so the crate compiles/links on Windows at all (real libmpv
//! linkage is build.rs's job, see its own Windows-specific comment) and so
//! `MpvEngine::attach` fails with an explicit message instead of a build
//! break -- not so playback actually renders video on this platform yet.
//!
//! To finish this: create an OpenGL (WGL) or ANGLE/D3D11 context for the
//! window handle below, then follow the same shape as `mac/gpu.rs` --
//! `mpv_render_context_create` with `MPV_RENDER_PARAM_API_TYPE_OPENGL` (or
//! D3D11's own params), `mpv_render_context_render` on `RenderSurface::render`,
//! present the frame, `mpv_render_context_free` on `teardown`.

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
    let RawWindowHandle::Win32(_) = handle else {
        return Err("expected a Win32 window handle on Windows".into());
    };
    Err("Windows render surface not implemented yet (ADR-0009 follow-up: WGL/D3D11 backend, see mpv/windows/mod.rs)".into())
}
