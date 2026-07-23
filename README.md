# Photon

A calm, minimal desktop media player for Jellyfin.

Sign in to your server, browse Movies and TV Shows, hit play. No dashboards,
no library management, no clutter. Photon is not a media manager. It is a
media player.

## Features

- Continue Watching, Recently Added Movies, Recently Added Shows on Home
- Movies and TV Shows grids, all libraries merged
- Instant local search plus server-side episode search
- In-process libmpv playback — GPU-rendered with automatic CPU fallback,
  always direct play, server decides remux/transcode
- Audio and subtitle track switching; delay and styling for text subtitles
- Picture-in-Picture (hands off to a standalone `mpv`, if one's on `PATH`),
  fullscreen, playback speed
- Keyboard-first controls
- Watch progress synced back to Jellyfin

## Install

**macOS** (verified, working):

```bash
brew install --cask mahi160/photon/photon
```

or download the `.dmg` from [Releases](https://github.com/mahi160/photon/releases)
— ad-hoc signed, not notarized, so Gatekeeper needs a one-time fix (the cask
does this automatically):

```bash
xattr -cr /Applications/Photon.app
```

**Windows / Linux** (installers build and run, but video playback doesn't
render yet — [#27](https://github.com/mahi160/photon/issues/27) tracks the
remaining work): `.exe`/`.deb`/`.rpm`/`.AppImage` builds are on
[Releases](https://github.com/mahi160/photon/releases) for anyone who wants
to help finish that.

Current releases are flagged **pre-release** on GitHub until Windows/Linux
playback is verified.

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

MIT
