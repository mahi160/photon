//! Render-loop profiler: times each real render call, logs a rolling summary every `LOG_INTERVAL` frames. stdlib only, not permanent telemetry -- answers "how slow is render, really" once, backend-agnostic.
//! Opt-in via `PHOTON_PROFILE_RENDER=1`: it used to write a /tmp log in every shipped build, and on Linux it timed the wrong thing entirely (`RenderSurface::render` there only posts a message to the GTK main thread, so it measured a channel send -- linux/mod.rs now times inside the GLArea render signal instead).

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const LOG_INTERVAL: u32 = 150; // ~5s at 30fps

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

const ENV_VAR: &str = "PHOTON_PROFILE_RENDER";

impl RenderProfiler {
    /// `None` unless `PHOTON_PROFILE_RENDER` is set to something other than "0"/"".
    pub(crate) fn new() -> Option<Self> {
        match std::env::var(ENV_VAR) {
            Ok(v) if v != "0" && !v.is_empty() => Some(Self::forced()),
            _ => None,
        }
    }

    fn forced() -> Self {
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
    fn off_unless_the_env_var_asks_for_it() {
        // Shipped builds must not write a /tmp log per launch.
        assert!(std::env::var(ENV_VAR).is_err(), "test env must not preset {ENV_VAR}");
        assert!(RenderProfiler::new().is_none());
    }

    #[test]
    fn logs_only_after_the_interval_and_resets_afterward() {
        let profiler = RenderProfiler::forced();
        for _ in 0..LOG_INTERVAL - 1 {
            profiler.time(|| {});
        }
        assert_eq!(profiler.stats.lock().unwrap().frames, LOG_INTERVAL - 1);
        profiler.time(|| {});
        assert_eq!(profiler.stats.lock().unwrap().frames, 0); // logged and reset, not just capped
    }

    #[test]
    fn max_tracks_the_slowest_call_not_the_last_one() {
        let profiler = RenderProfiler::forced();
        profiler.time(|| std::thread::sleep(Duration::from_millis(5)));
        profiler.time(|| {});
        assert!(profiler.stats.lock().unwrap().max >= Duration::from_millis(5));
    }
}
