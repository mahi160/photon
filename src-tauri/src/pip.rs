//! Picture-in-Picture, ADR-0006 revision: hands playback off to a spawned,
//! standalone system `mpv` (`--no-border --ontop`, its own JSON IPC) instead
//! of shrinking Photon's own window. Unlike primary playback (ADR-0003: mpv
//! must never be an optional, probed dependency), PiP genuinely is optional
//! here -- `pip_available` gates the whole feature in the UI, and "no system
//! mpv" just means no PiP button, not degraded core playback.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Default, Clone)]
pub struct PipState(pub Arc<Mutex<Option<Child>>>);

/// A GUI app launched via Finder/Dock/a `.dmg` install doesn't inherit the
/// user's login-shell `PATH` -- confirmed report: PiP's "is mpv on PATH"
/// probe worked in `pnpm dev` (started from a terminal, full `PATH`
/// inherited) but always failed after installing the built `.dmg` and
/// launching normally, hiding the PiP button even with `brew install mpv`
/// already done. `brew`'s own bin dir (`/opt/homebrew` on Apple Silicon,
/// `/usr/local` on Intel) never reaches a bare `Command::new("mpv")` there.
/// Checked ahead of the bare name so an already-resolving `PATH` (dev
/// builds, a differently configured shell) still wins.
fn mpv_binary() -> PathBuf {
    for candidate in ["/opt/homebrew/bin/mpv", "/usr/local/bin/mpv", "/opt/local/bin/mpv"] {
        let p = PathBuf::from(candidate);
        if p.is_file() {
            return p;
        }
    }
    PathBuf::from("mpv")
}

#[tauri::command]
pub fn pip_available() -> bool {
    Command::new(mpv_binary())
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn pip_start(
    app: AppHandle,
    state: tauri::State<'_, PipState>,
    url: String,
    start_seconds: f64,
    volume: f64,
    muted: bool,
    rate: f64,
    paused: bool,
) -> Result<(), String> {
    let mut slot = state.0.lock().unwrap();
    if slot.is_some() {
        return Ok(()); // already open -- idempotent
    }

    let socket_path = std::env::temp_dir().join(format!("photon-pip-{}.sock", std::process::id()));
    let _ = std::fs::remove_file(&socket_path); // stale socket from a crashed previous run

    let child = Command::new(mpv_binary())
        .arg("--no-border")
        .arg("--ontop")
        .arg("--on-all-workspaces") // follows across macOS Spaces / virtual desktops
        .arg("--title=Photon — Picture in Picture")
        // --autofit sizes the window to the video's own aspect ratio (mpv's
        // default keepaspect-window locks window size to it) -- a fixed
        // WxH here would letterbox/pillarbox any video that isn't 16:9.
        // --geometry (position only, no size) then places it bottom-right.
        .arg("--autofit=640x360")
        .arg("--geometry=-24-24") // mpv's own geometry syntax: bottom-right corner of the screen
        .arg(format!("--input-ipc-server={}", socket_path.display()))
        .arg(format!("--start={start_seconds}"))
        .arg(format!("--volume={}", (volume.clamp(0.0, 1.0) * 100.0).round()))
        .arg(format!("--mute={}", if muted { "yes" } else { "no" }))
        .arg(format!("--speed={rate}"))
        .arg(format!("--pause={}", if paused { "yes" } else { "no" }))
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to spawn mpv: {e}"))?;
    *slot = Some(child);
    drop(slot);

    spawn_poller(app, state.0.clone(), socket_path, start_seconds);
    Ok(())
}

/// Force-closes the spawned mpv (e.g. the user toggled PiP off from
/// Photon's own UI). The poller thread started in `pip_start` notices the
/// socket close either way -- this kill, or the user closing mpv's own
/// window -- and does the actual cleanup/`pip://ended` emit, so there's
/// nothing else to do here.
#[tauri::command]
pub fn pip_stop(state: tauri::State<'_, PipState>) {
    if let Some(child) = state.0.lock().unwrap().as_mut() {
        let _ = child.kill();
    }
}

/// Polls the spawned mpv's own JSON IPC for its current position every
/// 500ms -- simpler than wiring `observe_property`'s async event stream for
/// one value, and mpv's IPC also pushes unrelated built-in event
/// notifications unprompted, so responses to our own requests are picked
/// out by their `"error"` field rather than assumed to be the very next
/// line -- until the socket closes (mpv exited, killed or by the user),
/// then reports the last known position back so the frontend can resume
/// Photon's own (paused, still-loaded-at-the-handoff-point) engine there.
fn spawn_poller(app: AppHandle, state: Arc<Mutex<Option<Child>>>, socket_path: PathBuf, start_seconds: f64) {
    std::thread::spawn(move || {
        let mut last_position = start_seconds;

        // mpv creates the socket file asynchronously after spawn -- retry
        // briefly instead of racing it.
        let mut connected = None;
        for _ in 0..50 {
            if let Ok(s) = UnixStream::connect(&socket_path) {
                connected = Some(s);
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        if let Some(stream) = connected {
            let mut reader = BufReader::new(stream.try_clone().expect("clone unix stream"));
            let mut writer = stream;
            let request = format!("{}\n", json!({ "command": ["get_property", "time-pos"] }));
            'poll: loop {
                if writer.write_all(request.as_bytes()).is_err() {
                    break;
                }
                // skip past mpv's own unprompted event lines to find our
                // request's actual response (bounded -- never block forever
                // on a line that isn't coming)
                for _ in 0..10 {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        break 'poll; // socket closed -- mpv exited
                    }
                    let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                    if v.get("error").is_some() {
                        if let Some(p) = v.get("data").and_then(Value::as_f64) {
                            last_position = p;
                        }
                        break;
                    }
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        }

        if let Some(mut child) = state.lock().unwrap().take() {
            let _ = child.wait(); // reap -- avoid a zombie process
        }
        let _ = std::fs::remove_file(&socket_path);
        let _ = app.emit("pip://ended", last_position);
    });
}
