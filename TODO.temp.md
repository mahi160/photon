# Famto build — resume notes

Decisions locked (see CONTEXT.md + docs/adr/): single server, silent transcode fallback
(accurate DeviceProfile), 3-section Home, no Remember Me (safeStorage keychain), merged
libraries, hybrid search (local movie/show index + server episode search), favorites cut,
burned-in subs = disabled delay/styling, card click=play + label=details + hover play btn,
PlaybackEngine interface (primitives+events only), TanStack Query + Zustand + hand-rolled
shortcut map, English-only.

Stack: electron-vite (react-ts) + updater plugin, Tailwind v4, TanStack Router (code-based),
TanStack Query, Zustand, Zod, pnpm. Plain fetch Jellyfin client (no SDK dep).

## Phases (commit per phase, conventional commits)
- [ ] Phase 1 chore: scaffold + deps + tailwind + run verify
      BLOCKER: electron binary not extracting (dist/ only LICENSES.chromium.html, no path.txt).
      Fix: clear ~/Library/Caches/electron zip, rerun node install.js in
      node_modules/.pnpm/electron@*/node_modules/electron
- [ ] Phase 2 feat(auth): jellyfin client, login screen, token via safeStorage IPC, router shell
- [ ] Phase 3 feat(browse): home (3 rows), movies/shows grids (merged libs), hybrid search
- [ ] Phase 4 feat(player): PlaybackEngine iface + Html5Engine, PlaybackInfo/DeviceProfile,
      progress reporting (start/10s/pause/stop), controls, shortcuts, PiP
- [ ] Phase 5 feat(details+settings): movie/show details, subtitle styling settings,
      settings page (general/playback/subtitles/server/about), polish
- [ ] Phase 6 chore: vitest checks, lint, build verify, README

## Jellyfin API notes
- auth: POST /Users/AuthenticateByName, header Authorization: MediaBrowser Client="Famto",
  Device=.., DeviceId=.., Version=.., Token=..
- resume: /UserItems/Resume (new) or /Users/{id}/Items/Resume
- latest: /Users/{id}/Items/Latest?IncludeItemTypes=Movie|Series
- browse: /Items?IncludeItemTypes=Movie&Recursive=true&SortBy=..
- index for search: /Items?IncludeItemTypes=Movie,Series&Recursive=true&Fields=&sortBy=SortName
- episode search: /Items?searchTerm=..&IncludeItemTypes=Episode&Recursive=true
- seasons/episodes: /Shows/{id}/Seasons, /Shows/{id}/Episodes?seasonId=
- playback: POST /Items/{id}/PlaybackInfo {DeviceProfile,...} -> MediaSources
  direct: /Videos/{id}/stream?static=true&mediaSourceId=..&api_key=..
  transcode: TranscodingUrl from response
- progress: POST /Sessions/Playing, /Sessions/Playing/Progress, /Sessions/Playing/Stopped
- images: /Items/{id}/Images/Primary?fillWidth=400
