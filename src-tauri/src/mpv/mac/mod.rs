//! Mac-specific half of the mpv render backend (ADR-0009). Everything
//! Cocoa/OpenGL/IOSurface/Metal-specific lives here, behind the
//! [`RenderSurface`] trait -- `engine.rs` (mpv lifecycle, command dispatch,
//! the pending-operations queue, tick/property observation) only ever calls
//! mpv's plain C API and never learns which backend is active, or that a
//! GPU→CPU fallback happened. A future Windows/Linux backend plugs in the
//! same way: its own module, its own `attach()`, same trait.

mod gpu;
mod software;

use super::engine::RenderWaker;
use libmpv_sys::mpv_handle;
use objc2_app_kit::NSView;
use std::sync::Arc;

/// The three operations the shared engine code needs from whichever backend
/// is active: reposition/hide, render one frame, and tear down before mpv
/// itself is destroyed. `Send`: the render loop (`spawn_render_loop`,
/// commands.rs) calls `render()` from its own background thread -- each
/// implementation's own `unsafe impl Send` doc explains why that's safe for
/// its particular AppKit/GL/Metal object graph.
pub(crate) trait RenderSurface: Send {
    /// Repositions to the given content-view-local rect (points, top-left
    /// origin, matching `getBoundingClientRect()`), or hides entirely when
    /// `w`/`h` is zero (placeholder not visible/mounted).
    fn set_rect(&self, x: f64, y_top_left: f64, w: f64, h: f64);
    /// Renders one ready mpv frame onto the surface, if one is available.
    fn render(&self);
    /// Frees GL/Metal/mpv-render-context resources. Must run strictly
    /// before `mpv_terminate_destroy` -- see `MpvEngine::drop`.
    fn teardown(&mut self);
}

/// Which backend actually ended up active -- surfaced up through
/// `MpvEngine`/the `mpv_attach` Tauri command so the player-overlay badge
/// (issue #12) can show a CPU-fallback indicator only when it's true.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Backend {
    Gpu,
    Cpu,
}

impl Backend {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Backend::Gpu => "gpu",
            Backend::Cpu => "cpu",
        }
    }
}

/// The one entry point the shared engine calls. Tries the GPU surface
/// first, falling back to the CPU path on any setup failure -- entirely
/// inside this module; the caller only learns which backend it got, never
/// *why* a fallback happened beyond the diagnostic line below.
pub(crate) fn attach(
    mpv: *mut mpv_handle,
    content_view: &NSView,
    waker: &Arc<RenderWaker>,
) -> Result<(Box<dyn RenderSurface>, Backend), String> {
    let (result, backend) = try_or_fallback(
        || gpu::GpuSurface::new(mpv, content_view, waker).map(|s| Box::new(s) as Box<dyn RenderSurface>),
        || software::SoftwareSurface::new(mpv, content_view, waker).map(|s| Box::new(s) as Box<dyn RenderSurface>),
    );
    result.map(|surface| (surface, backend))
}

/// The GPU-vs-CPU fallback decision, pulled out as a pure function of two
/// closures so it's unit-testable independent of the real OpenGL/Metal
/// calls `gpu`/`fallback` make in `attach()` above (ADR-0009's testing
/// decision) -- prints the one diagnostic line either way (issue #12's
/// "clear log line" requirement) so a user report can be diagnosed without
/// reproducing anything GPU-specific.
fn try_or_fallback<T>(
    gpu: impl FnOnce() -> Result<T, String>,
    fallback: impl FnOnce() -> Result<T, String>,
) -> (Result<T, String>, Backend) {
    match gpu() {
        Ok(v) => {
            eprintln!("mpv: GPU render surface active (OpenGL -> IOSurface -> Metal)");
            (Ok(v), Backend::Gpu)
        }
        Err(reason) => {
            eprintln!("mpv: GPU render surface unavailable ({reason}), falling back to CPU");
            match fallback() {
                Ok(v) => (Ok(v), Backend::Cpu),
                Err(fallback_err) => {
                    (Err(format!("GPU setup failed ({reason}); CPU fallback also failed: {fallback_err}")), Backend::Cpu)
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gpu_success_never_calls_fallback() {
        let (result, backend) = try_or_fallback(
            || Ok::<_, String>("gpu"),
            || panic!("fallback must not run when the GPU attempt succeeds"),
        );
        assert_eq!(result, Ok("gpu"));
        assert_eq!(backend, Backend::Gpu);
    }

    #[test]
    fn gpu_failure_falls_back_to_cpu() {
        let (result, backend) =
            try_or_fallback(|| Err::<&str, _>("no GL context".to_string()), || Ok("cpu"));
        assert_eq!(result, Ok("cpu"));
        assert_eq!(backend, Backend::Cpu);
    }

    #[test]
    fn both_failing_reports_both_reasons() {
        let (result, backend) = try_or_fallback(
            || Err::<&str, _>("no GL context".to_string()),
            || Err("no software render either".to_string()),
        );
        let err = result.unwrap_err();
        assert!(err.contains("no GL context"), "{err}");
        assert!(err.contains("no software render either"), "{err}");
        assert_eq!(backend, Backend::Cpu); // still reported as attempted-CPU, not a mystery state
    }
}
