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

    // No `url`/`sub_url` in argv (jellyfin.ts's directStreamUrl/subtitleStreamUrl embed `ApiKey=<token>`
    // in the query string) -- a spawned process's argv is world-readable via `ps`/`/proc/*/cmdline`. mpv
    // starts idle instead and gets both handed over `loadfile`/`sub-add` on its own IPC socket once
    // connected (spawn_poller). Everything else here (position/volume/mute/rate/pause) carries no secret.
    let child = Command::new(mpv_binary())
        .arg("--idle=yes")
        .arg("--no-border")
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
        .arg(format!("--pause={}", if paused { "yes" } else { "no" }))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to spawn mpv: {e}"))?;
    *slot = Some(child);
    drop(slot);

    spawn_poller(app, state.0.clone(), socket_path, start_seconds, url, sub_url, sub_lang);
    Ok(())
}

/// Force-closes the spawned mpv (user toggled PiP off). `spawn_poller`'s thread notices the socket close either way and does cleanup/`pip://ended`.
#[tauri::command]
pub fn pip_stop(state: tauri::State<'_, PipState>) {
    if let Some(child) = state.0.lock().unwrap().as_mut() {
        let _ = child.kill();
    }
}

/// One mpv IPC command, request/reply. Skips past mpv's unprompted event lines (bounded, never blocks
/// forever) to find the matching "error"-bearing reply -- same trick the old inline time-pos poll used,
/// now shared with the initial `loadfile`/`sub-add` handoff below.
enum CmdOutcome {
    Closed,        // socket closed -- mpv exited
    Reply(Option<Value>), // got a reply this round (possibly with no "data")
}

fn send_command(writer: &mut impl Write, reader: &mut impl BufRead, args: Value) -> CmdOutcome {
    let request = format!("{}\n", json!({ "command": args }));
    if writer.write_all(request.as_bytes()).is_err() {
        return CmdOutcome::Closed;
    }
    for _ in 0..10 {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => return CmdOutcome::Closed,
            Ok(_) => {}
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if v.get("error").is_some() {
            return CmdOutcome::Reply(v.get("data").cloned());
        }
    }
    CmdOutcome::Reply(None) // no matching reply found this round, connection still alive
}

/// Connects to mpv's JSON IPC, hands over the actual media (`loadfile`)/subtitle (`sub-add`) -- kept off
/// argv entirely, see `pip_start`'s doc -- then polls position every 500ms until the socket closes.
/// Reports last known position back so Photon can resume.
fn spawn_poller(
    app: AppHandle,
    state: Arc<Mutex<Option<Child>>>,
    socket_path: PathBuf,
    start_seconds: f64,
    url: String,
    sub_url: Option<String>,
    sub_lang: Option<String>,
) {
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

            let loaded = !matches!(
                send_command(&mut writer, &mut reader, json!(["loadfile", url, "replace"])),
                CmdOutcome::Closed
            );
            if loaded {
                // Carries the active text subtitle over, if any -- embedded (non-text) picks have no URL
                // to hand off, so it plays without subs then. sub-add signature: url[,flags[,title[,lang]]].
                if let Some(sub_url) = sub_url {
                    let mut cmd = vec![json!("sub-add"), json!(sub_url), json!("select")];
                    if let Some(lang) = sub_lang {
                        cmd.push(json!(""));
                        cmd.push(json!(lang));
                    }
                    send_command(&mut writer, &mut reader, Value::Array(cmd));
                }

                'poll: loop {
                    match send_command(&mut writer, &mut reader, json!(["get_property", "time-pos"])) {
                        CmdOutcome::Closed => break 'poll,
                        CmdOutcome::Reply(Some(v)) => {
                            if let Some(p) = v.as_f64() {
                                last_position = p;
                            }
                        }
                        CmdOutcome::Reply(None) => {}
                    }
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
        }

        if let Some(mut child) = state.lock().unwrap().take() {
            let _ = child.wait(); // reap -- avoid a zombie process
        }
        let _ = std::fs::remove_file(&socket_path);
        let _ = app.emit("pip://ended", last_position);
    });
}
