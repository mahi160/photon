//! Platform-neutral half of mpv render backend (ADR-0009): `RenderSurface` trait, `Backend` enum, GPU-vs-CPU fallback decision every platform module implements against. engine.rs depends only on this + `backend::attach` alias, never a platform module directly.

/// Ops shared engine code needs from active backend: reposition/hide, render one frame, teardown before mpv destroyed. `Send`: render() runs off the render loop's background thread, see each impl's own `unsafe impl Send` doc.
pub(crate) trait RenderSurface: Send {
    /// Repositions to content-view-local rect (points, top-left origin), or hides when w/h is zero.
    fn set_rect(&self, x: f64, y_top_left: f64, w: f64, h: f64);
    /// Renders one ready mpv frame, if available.
    fn render(&self);
    /// Frees GL/GPU/mpv-render-context resources -- must run before `mpv_terminate_destroy`, see `MpvEngine::drop`.
    fn teardown(&mut self);
}

/// Which backend ended up active -- surfaced via `mpv_attach` for the CPU-fallback badge (issue #12).
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

/// GPU-vs-CPU fallback decision as a pure function of two closures, unit-testable without real GL/GPU calls (ADR-0009). Always logs one diagnostic line (issue #12).
/// Only mac/mod.rs calls this today (Windows/Linux surfaces don't have a GPU/CPU split yet) -- dead on
/// other targets' plain (non-test) build, hence the allow; the `#[cfg(test)]` block below still exercises it everywhere.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn try_or_fallback<T>(
    gpu: impl FnOnce() -> Result<T, String>,
    fallback: impl FnOnce() -> Result<T, String>,
) -> (Result<T, String>, Backend) {
    match gpu() {
        Ok(v) => {
            eprintln!("mpv: GPU render surface active");
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
        assert_eq!(backend, Backend::Cpu); // reported as attempted-CPU, not unknown
    }
}
