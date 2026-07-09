# Photon

A calm, minimal desktop media player built exclusively for Jellyfin.

> Photon is not a media manager. It is a media player.

Every feature must answer yes to: does this make watching media better? If no, it
doesn't belong here. Not building: live TV, music, photos, books, server admin,
metadata/user/plugin management, casting, mobile/browser support.

## Stack

Electron + React + TypeScript + Vite, TanStack Router/Query, Zustand, Tailwind v4.
Single Jellyfin server per install. Movies/Shows grids merge all server libraries
of that type — library boundaries are invisible in the UI.

## Domain language

- **Server** — the one Jellyfin server Photon is signed in to. Not "instance/backend/connection".
- **Card** — a poster tile anywhere in the app. Click card/hover-play → plays; click title → opens details. Not "tile/thumbnail/item".
- **Movies / Shows** — the two browsable catalogs; each merges every server library of its type. Not "library" as a UI concept.
- **Text Subtitle** — a track the server can deliver as text (e.g. VTT). Only text subs support delay/appearance styling. Not "soft sub".
- **Burned-in Subtitle** — rendered into the video by the server transcoder (PGS/VOBSUB/styled ASS). Delay/styling disabled for these. Not "hardsub".
- **Continue Watching** — server-provided partially-watched list, ordered by recency. The only resume surface. Not "resume list".

## Architecture decisions

- **PlaybackEngine interface from day one** (`src/renderer/src/player/engine.ts`).
  The UI never touches `<video>` directly. One interface — load, play/pause, seek,
  rate, volume, track selection, subtitle delay, PiP enter/exit — emits events
  (time, state, ended, error). Progress sync, hotkeys, autoplay-next, subtitle
  styling all consume events, none reach into the DOM. Deliberate one-implementation
  interface: the planned MPV backend is a native surface, and any DOM assumption
  leaking into the interface turns that swap into a rewrite instead of a drop-in.
- **Hybrid search** (`src/renderer/src/lib/search.ts`). Movies/shows: fetch a
  lightweight index (id, title, year) once per launch, fuzzy-filter locally,
  <100ms. Episodes: server-side search, debounced, results stream in — a large
  server can hold 100k+ episodes, indexing those locally would blow startup
  time/memory. Two search paths in code is the accepted cost.

## Playback

v1 uses Electron's HTML5 `<video>` (direct play or silent server transcode), or
hands off to a local `mpv` process for guaranteed direct play with no
transcoding. Server always decides direct-play/remux/transcode via an accurate
DeviceProfile — client has no custom transcoding logic or quality heuristics.

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

## Releasing

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `chore:`, etc.) — enforced by commitlint (husky `commit-msg`
hook locally, CI on PRs). Merging into `prod` runs semantic-release: computes
next version from commit types, tags, updates `CHANGELOG.md`, drafts a GitHub
Release. Windows/macOS/Linux builds attach to that release, which only goes
public once all three succeed.

## macOS Gatekeeper note

Photon's macOS build is ad-hoc signed, not notarized (requires paid Apple
Developer account). Gatekeeper blocks any downloaded app in that state — false
positive, not a corrupt download. One-time fix after moving to Applications:

```bash
xattr -cr /Applications/Photon.app
```

## License

MIT
