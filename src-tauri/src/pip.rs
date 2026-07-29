//! Picture-in-Picture, ADR-0006: hands off to a spawned standalone system `mpv` (`--no-border --ontop`, own JSON IPC) instead of shrinking Photon's window. PiP is optional unlike primary playback (ADR-0003) -- `pip_available` gates the UI, no system mpv just means no PiP button.
//! `--input-ipc-server` is a Unix socket path on macOS/Linux, named pipe on Windows -- Windows side unverified (no test box) but low-risk: plain blocking pipe I/O, not GPU/compositing.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
#[cfg(unix)]
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Where mpv's `--input-ipc-server` listens -- real socket file path on Unix, Win32 named-pipe name on Windows.
#[cfg(unix)]
fn ipc_path() -> PathBuf {
    std::env::temp_dir().join(format!("photon-pip-{}.sock", std::process::id()))
}

#[cfg(windows)]
fn ipc_path() -> PathBuf {
    PathBuf::from(format!(r"\\.\pipe\photon-pip-{}", std::process::id()))
}

/// Connects to whichever transport `ipc_path` returned -- `UnixStream`/`File` share Read+Write+try_clone, so `spawn_poller` never branches on platform beyond this.
#[cfg(unix)]
fn connect_ipc(path: &Path) -> Option<UnixStream> {
    UnixStream::connect(path).ok()
}

#[cfg(windows)]
fn connect_ipc(path: &Path) -> Option<std::fs::File> {
    std::fs::OpenOptions::new().read(true).write(true).open(path).ok()
}

#[derive(Default, Clone)]
pub struct PipState(pub Arc<Mutex<Option<Child>>>);

/// GUI apps launched via Finder/Dock don't inherit the login-shell PATH -- confirmed: PiP's mpv probe worked in `pnpm dev` (terminal PATH) but failed after installing the .dmg, hiding the PiP button even with mpv installed. Checked ahead of bare "mpv" so a resolving PATH still wins.
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
    sub_url: Option<String>,
    sub_lang: Option<String>,
) -> Result<(), String> {
    let mut slot = state.0.lock().unwrap();
    if slot.is_some() {
        return Ok(()); // already open -- idempotent
    }

    let socket_path = ipc_path();
    let _ = std::fs::remove_file(&socket_path); // stale socket from a crashed previous run

    let mut cmd = Command::new(mpv_binary());
    cmd.arg("--no-border")
        .arg("--ontop")
        .arg("--on-all-workspaces") // follows across macOS Spaces / virtual desktops
        .arg("--title=Photon — Picture in Picture")
        .arg("--autofit=640x360") // sizes to video's own aspect ratio, avoids letterboxing a fixed WxH
        .arg("--geometry=-24-24") // bottom-right corner of the screen
        .arg(format!("--input-ipc-server={}", socket_path.display()))
        .arg(format!("--start={start_seconds}"))
        .arg(format!("--volume={}", (volume.clamp(0.0, 1.0) * 100.0).round()))
        .arg(format!("--mute={}", if muted { "yes" } else { "no" }))
        .arg(format!("--speed={rate}"))
        .arg(format!("--pause={}", if paused { "yes" } else { "no" }));
    // Carries the active text subtitle over, if any -- embedded (non-text) picks have no URL to hand off, so it plays without subs then.
    if let Some(sub_url) = sub_url {
        cmd.arg(format!("--sub-file={sub_url}"));
        if let Some(lang) = sub_lang {
            cmd.arg(format!("--slang={lang}"));
        }
    }
    let child = cmd
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

/// Force-closes the spawned mpv (user toggled PiP off). `spawn_poller`'s thread notices the socket close either way and does cleanup/`pip://ended`.
#[tauri::command]
pub fn pip_stop(state: tauri::State<'_, PipState>) {
    if let Some(child) = state.0.lock().unwrap().as_mut() {
        let _ = child.kill();
    }
}

/// Polls mpv's JSON IPC for position every 500ms -- simpler than wiring an async event stream for one value. mpv also pushes unprompted event lines, so responses are picked out by their "error" field, not assumed to be the next line. Reports last known position back once socket closes so Photon can resume.
fn spawn_poller(app: AppHandle, state: Arc<Mutex<Option<Child>>>, socket_path: PathBuf, start_seconds: f64) {
    std::thread::spawn(move || {
        let mut last_position = start_seconds;

        // mpv creates the socket file asynchronously after spawn -- retry briefly instead of racing it
        let mut connected = None;
        for _ in 0..50 {
            if let Some(s) = connect_ipc(&socket_path) {
                connected = Some(s);
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        if let Some(stream) = connected {
            let mut reader = BufReader::new(stream.try_clone().expect("clone ipc stream"));
            let mut writer = stream;
            let request = format!("{}\n", json!({ "command": ["get_property", "time-pos"] }));
            'poll: loop {
                if writer.write_all(request.as_bytes()).is_err() {
                    break;
                }
                // skip past mpv's unprompted event lines to find our response (bounded, never blocks forever)
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
