# Replace OS-integrated PiP with a spawned standalone mpv window

mpv-only playback (ADR-0003) removes the HTML5 `<video>` hand-off that today's
`P` shortcut relies on for real OS-integrated Picture-in-Picture (AVKit on macOS,
Compact Overlay on Windows) — that hand-off exists specifically because mpv's
rendered surface isn't a video element those APIs can attach to, and bridging
mpv's frames into one (as IINA does) is real per-platform engineering, not
justified for this.

`P` hands playback off to a spawned, standalone system `mpv` process instead
(`--no-border --ontop`, positioned via mpv's own `--geometry`) — not a real OS
PiP panel either, but it gets borderless/always-on-top/drag/resize chrome for
free from mpv itself, no custom window-geometry code on Photon's side. The
in-process engine (ADR-0005) pauses for the handoff (same file, can't have both
decoding audio at once) and resumes, at whatever position the spawned mpv
reports back over its own JSON IPC (`--input-ipc-server`), once that process
exits — either the user closed its window, or `P` was pressed again.

This is the one place Photon treats mpv as an optional, probed runtime
dependency rather than a bundled given (ADR-0003's "not installed is no longer
an acceptable playback state" is about the in-process *primary* playback path,
not this): PiP fully hides itself in the UI when no system `mpv` is on `PATH`,
since it is genuinely optional in a way core playback isn't.

The spawned mpv also gets `--on-all-workspaces` (X11/macOS), so unlike the
previous window-resize revision, it does follow across Spaces/virtual
desktops — one of the two things ADR-0006's original ceiling named.

ponytail: still not real OS PiP — no Dock/taskbar thumbnail the way real
AVKit/Compact Overlay PiP gets, and it's a plain floating window rather than a
dedicated PiP panel. An earlier revision of this ADR instead shrank Photon's
own window in place; spawning a separate mpv gets real window chrome (drag,
resize, its own close button, Spaces-following) without hand-rolling any of
it, at the cost of requiring a system mpv install for this one feature. Real
per-OS PiP bridging can still be revisited later if this turns out not to be
enough.
