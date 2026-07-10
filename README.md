# Photon

A calm, minimal desktop media player for Jellyfin.

Sign in to your server, browse Movies and TV Shows, hit play. No dashboards,
no library management, no clutter.

## Features

- Continue Watching, Recently Added Movies, Recently Added Shows on Home
- Movies and TV Shows grids, all libraries merged
- Instant local search plus server-side episode search
- Direct play via HTML5/HLS or a local `mpv` process, server transcodes when needed
- Audio and subtitle track switching, subtitle delay and styling
- Picture-in-Picture, fullscreen, playback speed
- Keyboard-first controls
- Watch progress synced back to Jellyfin

## Install

Download a build from [Releases](https://github.com/mahi160/photon/releases).

macOS builds are ad-hoc signed, not notarized, so Gatekeeper will flag them
after download. Fix once:

```bash
xattr -cr /Applications/Photon.app
```

### mpv (optional)

Photon's built-in player (HTML5/HLS) needs no setup. For guaranteed direct
play with zero server transcoding, install [mpv](https://mpv.io) and switch
to it in Settings → Playback → Player ("Built-in · mpv when transcoding" or
"Always mpv"). mpv plays in its own window; Picture-in-Picture always falls
back to the built-in player. Photon does not bundle mpv — install it separately:

```bash
# macOS
brew install mpv

# Windows — installs mpv.exe on PATH (mpv.net is a different app, won't work)
choco install mpv
# or: scoop install mpv

# Linux
sudo apt install mpv      # Debian/Ubuntu
sudo pacman -S mpv        # Arch
```

## Keyboard shortcuts

| Key      | Action             |
| -------- | ------------------ |
| Space    | Play / pause       |
| ← / →    | Seek ±10s          |
| ↑ / ↓    | Volume             |
| F        | Fullscreen         |
| P        | Picture-in-Picture |
| M        | Mute               |
| Esc      | Exit fullscreen    |
| Ctrl/⌘+F | Search             |

## Development

```bash
pnpm install
pnpm dev        # run in development
pnpm build      # typecheck + build
pnpm lint       # eslint
npx vitest run  # tests
pnpm build:mac  # package (also build:win, build:linux)
```

Contributor and architecture notes live in [AGENTS.md](AGENTS.md).

## License

MIT
