# mpv is the sole playback engine

Photon is moving from Electron to Tauri, embedding mpv in the app window instead of
Electron's HTML5 `<video>`. We considered keeping the current dual-engine setup
(HTML5 `<video>` as default, mpv as an opt-in fallback for guaranteed direct play),
but a Tauri webview has no equivalent decode path worth maintaining as a second
engine, and "web player" stops meaning anything once mpv owns rendering. `PlaybackEngine`
(ADR-0002) collapses to one implementation. mpv is no longer an optional runtime
dependency the app probes for and falls back away from — Photon must vendor/bundle
it, since "not installed" is no longer an acceptable playback state.
