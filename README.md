# Photon

A calm, minimal desktop media player built exclusively for Jellyfin.

> Photon is not a media manager. It is a media player.

## Features

- Sign in to one Jellyfin server; session persists in the OS keychain
- Home: Continue Watching, Recently Added Movies, Recently Added Shows — nothing else
- Movies and TV Shows grids (all libraries merged), sorted by added/name/release
- Instant search: movies and shows filter locally, episodes stream in from the server
- Player: HTML5/HLS with direct play when Chromium can decode it, silent server
  transcode when it can't — or hand off to a local `mpv` for direct play with no
  transcoding at all
- Audio and subtitle track switching, subtitle delay and styling (text subs)
- Picture-in-Picture, fullscreen, playback speed, keyboard-first controls
- Watch progress synced back to Jellyfin

## macOS: "Photon.app is damaged and can't be opened"

Photon's macOS build is ad-hoc signed, not notarized (that requires a paid
Apple Developer account). Gatekeeper blocks any downloaded app in that state.
This is a false positive, not a corrupt download — one-time fix:

```bash
xattr -cr /Applications/Photon.app
```

Run it after moving Photon to Applications, then launch normally.

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

## Architecture

- Electron + React + TypeScript + Vite, TanStack Router/Query, Zustand, Tailwind v4
- The UI never touches `<video>` directly — see `src/renderer/src/player/engine.ts`
  and [ADR-0002](docs/adr/0002-playback-engine-interface.md)
- Domain language lives in [CONTEXT.md](CONTEXT.md); decisions in `docs/adr/`

## License

MIT
