//! Render-loop profiler (perf-audit follow-up, see AUDIT.md #9/#11): times
//! each `surface.render()` call from `spawn_render_loop` and appends a
//! rolling summary to a log file every `LOG_INTERVAL` frames. stdlib only —
//! no `tracing`/`log` crate pulled in for what's meant to answer "how slow
//! is the render loop, really" on a real machine, not permanent telemetry.
//! Backend-agnostic on purpose: wraps the one call site both the GPU and
//! software (`mac/software.rs`) surfaces go through, instead of duplicating
//! timing inside each backend.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const LOG_INTERVAL: u32 = 150; // ~5s at mpv's 30fps render-loop target

#[derive(Default)]
struct Stats {
    frames: u32,
    total: Duration,
    max: Duration,
}

pub(crate) struct RenderProfiler {
    log_path: PathBuf,
    stats: Mutex<Stats>,
}

impl RenderProfiler {
    pub(crate) fn new() -> Self {
        let log_path = std::env::temp_dir().join("photon-render-profile.log");
        eprintln!("[photon] render profiler logging to {}", log_path.display());
        Self {
            log_path,
            stats: Mutex::new(Stats::default()),
        }
    }

    /// Times `render` (a `surface.render()` call) and appends a summary
    /// line to the log file every `LOG_INTERVAL` frames.
    pub(crate) fn time(&self, render: impl FnOnce()) {
        let start = Instant::now();
        render();
        let elapsed = start.elapsed();

        let mut stats = self.stats.lock().unwrap();
        stats.frames += 1;
        stats.total += elapsed;
        stats.max = stats.max.max(elapsed);

        if stats.frames < LOG_INTERVAL {
            return;
        }
        let avg = stats.total / stats.frames;
        let line = format!(
            "{:?} frames={} avg={:?} max={:?}\n",
            std::time::SystemTime::now(),
            stats.frames,
            avg,
            stats.max
        );
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
        {
            let _ = file.write_all(line.as_bytes());
        }
        *stats = Stats::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logs_only_after_the_interval_and_resets_afterward() {
        let profiler = RenderProfiler::new();
        for _ in 0..LOG_INTERVAL - 1 {
            profiler.time(|| {});
        }
        assert_eq!(profiler.stats.lock().unwrap().frames, LOG_INTERVAL - 1);
        profiler.time(|| {});
        // logged and reset -- back to zero, not LOG_INTERVAL
        assert_eq!(profiler.stats.lock().unwrap().frames, 0);
    }

    #[test]
    fn max_tracks_the_slowest_call_not_the_last_one() {
        let profiler = RenderProfiler::new();
        profiler.time(|| std::thread::sleep(Duration::from_millis(5)));
        profiler.time(|| {});
        assert!(profiler.stats.lock().unwrap().max >= Duration::from_millis(5));
    }
}
