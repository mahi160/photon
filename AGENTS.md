# Photon

A calm, minimal desktop media player built exclusively for Jellyfin.

> Photon is not a media manager. It is a media player.

Every feature must answer yes to: does this make watching media better? If no, it
doesn't belong here. Not building: live TV, music, photos, books, server admin,
metadata/user/plugin management, casting, mobile/browser support, remote control from other
Jellyfin clients (no `/Sessions/Capabilities` registration, no persistent WebSocket connection to
the server -- a deliberate omission, not a gap; see `jellyfin.ts`'s `configure`).

## Stack

Tauri (Rust shell) + React + TypeScript + Vite, TanStack Router/Query, Zustand,
CSS Modules. In-process libmpv (render API) is the sole playback engine —
see `src-tauri/src/mpv/` and ADR-0003/0005. Single Jellyfin server per
install. Movies/Shows grids merge all server libraries of that type — library
boundaries are invisible in the UI.

## Domain language

- **Server** — the one Jellyfin server Photon is signed in to. Not "instance/backend/connection".
- **Card** — a poster tile anywhere in the app. Click card/hover-play → plays; click title → opens details. Not "tile/thumbnail/item".
- **Movies / Shows** — the two browsable catalogs; each merges every server library of its type. Not "library" as a UI concept.
- **Text Subtitle** — a track the server can deliver as text (e.g. SRT). Only text subs support delay/appearance styling. Not "soft sub".
- **Burned-in Subtitle** — rendered into the video by the server transcoder (PGS/VOBSUB/styled ASS). Delay/styling disabled for these. Not "hardsub".
- **Continue Watching** — server-provided partially-watched list, ordered by recency. The only resume surface. Not "resume list".

## Architecture decisions

- **PlaybackEngine interface** (`src/renderer/src/player/engine.ts`). One
  interface — load, play/pause, seek, rate, volume, track selection, subtitle
  delay, PiP enter/exit — emits events (time, state, ended, error). Progress
  sync, hotkeys, autoplay-next all consume events. `MpvEngine`
  (`src/renderer/src/player/mpv.ts`) is the only implementation, backed by
  in-process libmpv composited under a transparent window region — see
  `docs/adr/0003` onward.
- **Hybrid search** (`src/renderer/src/lib/search.ts`). Movies/shows: fetch a
  lightweight index (id, title, year) once per launch, fuzzy-filter locally,
  <100ms. Episodes: server-side search, debounced, results stream in — a large
  server can hold 100k+ episodes, indexing those locally would blow startup
  time/memory. Two search paths in code is the accepted cost.

## Playback

In-process libmpv, embedded via its render API and composited into the app's
own window (no separate mpv window, no `--wid` embedding). Server always
decides direct-play/remux/transcode via a DeviceProfile — client has no
custom transcoding logic or quality heuristics.

Picture-in-Picture (ADR-0006) hands off to a spawned, standalone system `mpv`
process (`--no-border --ontop`) rather than a real OS PiP panel — the only
place Photon treats mpv as an optional, probed dependency; the PiP button
hides itself when no system `mpv` is on `PATH`. On Wayland `--ontop` is a no-op
(no protocol for it), so PiP there is just a separate window; the `.deb`/`.rpm`
only *recommend* `mpv`, so most Linux installs have no PiP button at all.

Screen blanking during playback is inhibited by the renderer's Screen Wake Lock
API on macOS/Windows and by `org.freedesktop.ScreenSaver.Inhibit`
(`src-tauri/src/idle.rs`) on Linux, where WebKitGTK has no `navigator.wakeLock`.
`vo=libmpv` has no window, so mpv's own `stop-screensaver` can't help.

## Keyboard shortcuts

| Key       | Action                  |
| --------- | ----------------------- |
| Space     | Play / pause            |
| ← / →     | Seek ±10s               |
| ↑ / ↓     | Volume                  |
| Shift+←/→ | Previous / next chapter |
| S         | Skip intro / segment    |
| A         | Cycle audio track       |
| C         | Cycle subtitle track    |
| < / >     | Playback speed          |
| [ / ]     | Subtitle delay          |
| F         | Fullscreen              |
| P         | Picture-in-Picture      |
| M         | Mute                    |
| , / .     | Frame step back/forward |
| D         | Toggle deinterlace      |
| Shift+S   | Screenshot              |
| Esc       | Exit fullscreen         |
| Ctrl/⌘+F  | Search                  |

## Development

```bash
pnpm install
pnpm dev        # run in development (Tauri)
pnpm build      # typecheck + build + bundle
pnpm lint       # eslint
npx vitest run  # tests
```

Requires Rust + a system `mpv` install (dev builds link it via pkg-config —
`brew install mpv` on macOS, `apt install libmpv-dev libwebkit2gtk-4.1-dev
libgtk-3-dev` on Debian/Ubuntu). The shipped app will vendor its own LGPL libmpv
build (ADR-0004); that vendoring isn't wired up yet, so dev builds link
whatever `mpv` pkg-config resolves to on the machine.

Diagnostics (all platforms): mpv's own warnings/errors go to stderr and to the
`mpv://log` event (devtools console), and the hwdec that actually engaged is
logged per file as `mpv: hwdec-current=…`. `PHOTON_PROFILE_RENDER=1` times the
real render call into a temp-dir log; `PHOTON_DEBUG_RECT=1` (Linux) prints the
CSS rect, the translated GTK allocation and the scale factor on every geometry
change.

## Releasing

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `chore:`, etc.) — enforced by commitlint (husky `commit-msg`
hook locally, CI on PRs). Merging into `prod` runs semantic-release: computes
next version from commit types, tags, updates `CHANGELOG.md`, drafts a GitHub
Release.

Platform builds/publishing (ticket #11): `release.yml` builds and publishes
a macOS artifact (Tauri bundler, ad-hoc signed, updater-signed) once a
release is cut, then undrafts it. Windows/Linux builds are wired up too
(`build-windows`/`build-linux`, both `continue-on-error: true` — that flag
stays regardless of verification status, purely so a Windows/Linux build
failure can never block publish-release/the macOS release; see
`release.yml`'s comments). `mpv/windows` (WGL) is a real render surface, and
Linux is a `GtkGLArea` composited under the webview (ADR-0010) — the older
raw X11 child-window and `wl_subsurface` backends are deleted, so there is
no `GDK_BACKEND` pinning and one path serves X11/Wayland/XWayland. Windows
has been watched playing video on real hardware (a release built by
`build-windows` was tested end-to-end, not just compiled/linked on CI's
`windows-latest` runner). Linux's GTK path has been run on a live Wayland
session (window, reparent, GL context, mpv render, rect geometry, mpv log
plumbing); hardware decode is still unverified there — the test box has no
working VAAPI/NVDEC, so `hwdec-current=no` is all it can prove. See
ADR-0010's smoke-test checklist before trusting a Linux release.

Linux packaging: `deb`/`rpm` only (no AppImage — Tauri's AppImage bundler
copies `libva*` into the AppDir, which then version-mismatches the host's
VAAPI driver and silently kills hardware decode, and it offers no way to
exclude a library). The binary hard-links `libmpv.so.2`, so
`bundle.linux.deb.depends`/`rpm.depends` must name it — without that the
package installs cleanly and then dies at startup on `libmpv.so.2: cannot
open shared object file`. Consequence of dropping AppImage: no in-app
auto-update on Linux (Tauri's updater only handles AppImage there);
distro packages are updated by the distro/user.

None of the three platforms use ADR-0004's vendored LGPL libmpv build yet (macOS links
Homebrew's GPL build, same as local dev; Windows/Linux similarly link a full
GPL build in CI) — which also means the shipped `.deb`/`.rpm` link a GPL
libmpv into an MIT app. That's ADR-0004's job to fix and it is not done.

## macOS Gatekeeper note

Photon's macOS build is ad-hoc signed, not notarized (requires paid Apple
Developer account). Gatekeeper blocks any downloaded app in that state — false
positive, not a corrupt download. `brew install --cask mahi160/photon/photon`
(see `mahi160/homebrew-photon`) handles this automatically; installing the
`.dmg` by hand needs a one-time fix after moving to Applications:

```bash
xattr -cr /Applications/Photon.app
```

The in-app auto-updater (Tauri's updater plugin, ticket #11) doesn't change
this — it verifies its own update-package signature (a separate Tauri-signing
keypair, unrelated to Apple code signing) but installs the same ad-hoc-signed
`.app`, so a fresh install after auto-updating can still need the same
`xattr -cr` fix (or reinstalling via the Homebrew cask, once one exists for
the installed version).

## Agent skills

### Issue tracker

GitHub Issues on `mahi160/photon`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` (created lazily) + `docs/adr/`. See `docs/agents/domain.md`.

## License

MIT
