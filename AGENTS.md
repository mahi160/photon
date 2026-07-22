# Photon

A calm, minimal desktop media player built exclusively for Jellyfin.

> Photon is not a media manager. It is a media player.

Every feature must answer yes to: does this make watching media better? If no, it
doesn't belong here. Not building: live TV, music, photos, books, server admin,
metadata/user/plugin management, casting, mobile/browser support.

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
- **Text Subtitle** — a track the server can deliver as text (e.g. VTT). Only text subs support delay/appearance styling. Not "soft sub".
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
hides itself when no system `mpv` is on `PATH`.

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
`brew install mpv` on macOS). The shipped app will vendor its own LGPL libmpv
build (ADR-0004); that vendoring isn't wired up yet, so dev builds link
whatever `mpv` pkg-config resolves to on the machine.

## Releasing

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `chore:`, etc.) — enforced by commitlint (husky `commit-msg`
hook locally, CI on PRs). Merging into `prod` runs semantic-release: computes
next version from commit types, tags, updates `CHANGELOG.md`, drafts a GitHub
Release.

**Not wired up yet**: the platform-build-and-publish half of the pipeline
(Tauri bundler artifacts, code signing, the auto-updater) — that's tracked
work, not done. `release.yml`'s build/publish jobs are disabled until it
lands; semantic-release itself (versioning/changelog/tagging) still runs.

## macOS Gatekeeper note

Photon's macOS build is ad-hoc signed, not notarized (requires paid Apple
Developer account). Gatekeeper blocks any downloaded app in that state — false
positive, not a corrupt download. One-time fix after moving to Applications:

```bash
xattr -cr /Applications/Photon.app
```

## Agent skills

### Issue tracker

GitHub Issues on `mahi160/photon`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` (created lazily) + `docs/adr/`. See `docs/agents/domain.md`.

## License

MIT
