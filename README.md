# Photon

A calm, minimal desktop media player for Jellyfin, powered by real mpv
playback.

## If mpv can play it, Photon plays it

Photon embeds mpv directly, in-process, via its render API — the actual mpv
decoder/renderer compositing straight into Photon's own window, GPU-rendered
with automatic CPU fallback if a machine can't do that. **Always direct
play** — the server never has to transcode. This is the whole reason Photon
exists; everything else is the UI around it.

Sign in to your server, browse Movies and TV Shows, hit play. No dashboards,
no library management, no clutter. Photon is not a media manager. It is a
media player.

## Features

- **mpv-quality playback in the same window** — GPU-rendered, CPU fallback,
  always direct play, server decides remux/transcode
- Continue Watching, Recently Added Movies, Recently Added Shows on Home
- Movies and TV Shows grids, all libraries merged
- Instant local search plus server-side episode search
- Audio and subtitle track switching; delay and styling for text subtitles
- Picture-in-Picture (hands off to a standalone `mpv`, if one's on `PATH`),
  fullscreen, playback speed
- Keyboard-first controls
- Watch progress synced back to Jellyfin

## Install

**macOS**:

```bash
brew install --cask mahi160/photon/photon
```

or download the `.dmg` from [Releases](https://github.com/mahi160/photon/releases).
It bundles its own `mpv` — nothing to install first. It is ad-hoc signed but
not notarized, so Gatekeeper needs a one-time fix after moving it to
Applications (the cask does this for you):

```bash
xattr -cr /Applications/Photon.app
```

**Windows**: `.exe` installer from
[Releases](https://github.com/mahi160/photon/releases). Bundles its own
`mpv`.

**Linux**: `.deb` / `.rpm` from
[Releases](https://github.com/mahi160/photon/releases). These depend on your
distribution's libmpv (`libmpv2` / `mpv-libs`) rather than bundling one, so
hardware decode keeps working with your own GPU drivers; your package manager
pulls it in. No AppImage, and therefore no in-app auto-update on Linux —
update through the package.

Current releases are flagged **pre-release** on GitHub. Hardware decode on
Linux is the last thing still unverified.

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
`brew install mpv` on macOS, `apt install libmpv-dev` on Linux).

Contributor and architecture notes live in [AGENTS.md](AGENTS.md).

## License

Photon's source is **MIT** — see [LICENSE](LICENSE).

The macOS and Windows downloads bundle [libmpv](https://mpv.io), which is
GPLv2-or-later, so those builds are conveyed as GPLv2-or-later as a whole.
The Linux packages contain no mpv code and are MIT. Details and corresponding
source in [NOTICE.md](NOTICE.md).
