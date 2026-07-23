# Embed mpv via the in-process libmpv render API, not a spawned/embedded process

With libmpv vendored (ADR-0003/0004), Photon links it directly (Rust FFI, e.g.
`libmpv-rs`) and drives an `mpv_render_context`, compositing its output frames into
a native surface beneath a transparent region of the Tauri webview. This was
chosen over spawning the bundled mpv binary and embedding it via `--wid` (a native
child window glued to Photon's frame, as today's fallback path does). The render
API is the only route to true alpha-composited overlay UI — mpv's own OSC/OSD is
disabled, and Photon's existing custom control overlay (already driving
`PlaybackEngine` for the HTML5 `<video>` path) becomes the single UI for
playback controls, deleting the mpv-OSC/Photon-controls split that existed while
mpv was a fallback-only external window.
