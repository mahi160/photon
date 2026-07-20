# Replace OS-integrated PiP with an app-level mini window

mpv-only playback (ADR-0003) removes the HTML5 `<video>` hand-off that today's
`P` shortcut relies on for real OS-integrated Picture-in-Picture (AVKit on macOS,
Compact Overlay on Windows) — that hand-off exists specifically because mpv's
rendered surface isn't a video element those APIs can attach to, and bridging
mpv's frames into one (as IINA does) is real per-platform engineering, not
justified for this. `P` now shrinks Photon's own window into an always-on-top
mini window instead — same mpv surface, no OS PiP chrome, won't survive
Mission Control space switches like real PiP does.

ponytail: this is a known ceiling, not the final word — real per-OS PiP bridging
can be revisited later if the mini window turns out not to be enough.
