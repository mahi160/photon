# [2.0.0-pre.1](https://github.com/mahi160/photon/compare/v1.6.0...v2.0.0-pre.1) (2026-07-23)


* Electron → Tauri replatform, mpv-only playback engine ([#17](https://github.com/mahi160/photon/issues/17)) ([19dc386](https://github.com/mahi160/photon/commit/19dc38661bb85d4d1fcfadd84d03d4b7c0c1f2b0)), closes [#3](https://github.com/mahi160/photon/issues/3) [#4](https://github.com/mahi160/photon/issues/4) [-#11](https://github.com/-/issues/11) [#4](https://github.com/mahi160/photon/issues/4) [#4](https://github.com/mahi160/photon/issues/4) [#3](https://github.com/mahi160/photon/issues/3) [#5](https://github.com/mahi160/photon/issues/5) [#10](https://github.com/mahi160/photon/issues/10) [#5](https://github.com/mahi160/photon/issues/5) [#6](https://github.com/mahi160/photon/issues/6) [#10](https://github.com/mahi160/photon/issues/10) [#11](https://github.com/mahi160/photon/issues/11) [#5](https://github.com/mahi160/photon/issues/5) [#6](https://github.com/mahi160/photon/issues/6) [#6](https://github.com/mahi160/photon/issues/6) [#4](https://github.com/mahi160/photon/issues/4) [#7](https://github.com/mahi160/photon/issues/7) [#8](https://github.com/mahi160/photon/issues/8) [#6](https://github.com/mahi160/photon/issues/6) [#6](https://github.com/mahi160/photon/issues/6) [#7](https://github.com/mahi160/photon/issues/7) [#8](https://github.com/mahi160/photon/issues/8) [#6](https://github.com/mahi160/photon/issues/6) [#0e0e10](https://github.com/mahi160/photon/issues/0e0e10) [#10](https://github.com/mahi160/photon/issues/10) [#7](https://github.com/mahi160/photon/issues/7) [#7](https://github.com/mahi160/photon/issues/7) [#7](https://github.com/mahi160/photon/issues/7) [#9](https://github.com/mahi160/photon/issues/9) [#9](https://github.com/mahi160/photon/issues/9) [#9](https://github.com/mahi160/photon/issues/9) [#6](https://github.com/mahi160/photon/issues/6) [#7](https://github.com/mahi160/photon/issues/7) [#9](https://github.com/mahi160/photon/issues/9) [#6](https://github.com/mahi160/photon/issues/6) [#5](https://github.com/mahi160/photon/issues/5) [#10](https://github.com/mahi160/photon/issues/10) [#6](https://github.com/mahi160/photon/issues/6) [#7](https://github.com/mahi160/photon/issues/7) [#9](https://github.com/mahi160/photon/issues/9) [#7](https://github.com/mahi160/photon/issues/7) [#11](https://github.com/mahi160/photon/issues/11) [#3](https://github.com/mahi160/photon/issues/3) [jellyfin/jellyfin#16687](https://github.com/jellyfin/jellyfin/issues/16687) [#18](https://github.com/mahi160/photon/issues/18) [#19](https://github.com/mahi160/photon/issues/19)


### Bug Fixes

* **release:** add main as plain release branch to satisfy semantic-release validation ([#22](https://github.com/mahi160/photon/issues/22)) ([7a83ffd](https://github.com/mahi160/photon/commit/7a83ffd809fd02fa8302be7728cafea60b8d72a7))
* **release:** sync tauri version fields during semantic-release ([#20](https://github.com/mahi160/photon/issues/20)) ([886e13f](https://github.com/mahi160/photon/commit/886e13f9555fd3bab6c370dbc93d47cca217efe4))


### BREAKING CHANGES

* window.api removed from the renderer global; any code
depending on it must call @tauri-apps/api/core invoke() directly.

* perf: virtualize library grid, pool render buffers, profile render loop

- LibraryGrid: replace the "render first N, load more on scroll" cap with
  real row-based virtualization (@tanstack/react-virtual). Columns are
  computed from container width via ResizeObserver to mirror the CSS
  grid's repeat(auto-fill, minmax(...)) math, rows are chunked from the
  flat item list and absolutely positioned, virtualizer measures actual
  row height post-render. DOM node count now stays bounded regardless of
  library size, not just the initial mount.
- AppLayout: mark .main (the actual overflow-y:auto scrolling ancestor)
  with data-scroll-root so LibraryGrid's virtualizer can find it.
- software.rs (macOS CPU-fallback mpv renderer): replace the per-frame
  Vec<u8> allocation with a bounded buffer pool. Buffers only rejoin the
  pool via PooledBuffer's Drop impl, which only runs once CoreGraphics's
  own CGDataProvider release callback fires -- reuse can't race a frame
  CoreGraphics is still compositing.
- new mpv/profile.rs: backend-agnostic RenderProfiler wired into the one
  render-loop call site (spawn_render_loop). Times each surface.render()
  call, appends a rolling avg/max summary to a temp-dir log file every
  150 frames -- stdlib only, meant to answer "how slow is this, really"
  on a real machine rather than add a logging dependency.

* fix(library-grid): attach ResizeObserver via callback ref, not stale useRef

The grid div only mounts once `data` has loaded (behind a loading
conditional). A plain useRef's effect runs once on mount with deps that
never change -- at that point .current was still null, so the observer
never attached and column count stayed stuck at its default of 1,
rendering one huge full-width poster per row instead of a responsive
grid. Switched to a state-backed callback ref so the effect re-fires
(and actually observes) once the div mounts for real.

* feat: show source frame rate as a details-page badge

Jellyfin's MediaStream carries RealFrameRate (23.976/29.97/59.94 etc);
surface it in mediaBadges() rounded to the nominal rate (24/30/60fps)
so movie/show details pages show it alongside resolution/codec/HDR.
Player-overlay badges (playerSpecialBadges) intentionally don't get
it -- that surface is reserved for 4K/HDR/Atmos only, per its own doc.

* feat: episode details page

- new EpisodeDetails.tsx page (/episode/$itemId, under the shell route):
  hero image (episode backdrop, falling back to its thumb), series-link
  button, season/episode line, badges, overview, play/resume, watched
  toggle, audio/subtitle track pickers -- mirrors MovieDetails/ShowDetails'
  existing shape
- computes and shows a "Next Episode" card: same season's next index, or
  the next season's first episode if this one is last in its season
  (defensively sorted by IndexNumber, not trusting server array order)
- Card.tsx: episode cards now split title/subtitle into two independent
  targets -- title shows the series name and links to the series (what
  you're actually browsing), subtitle shows "SxEy - Episode Name" and
  links to the new episode details page. Movie/Series cards unchanged.
  Fixes Home's Continue Watching/Next Up rows too (they render through
  the same Card), which previously had no way to reach episode details.
- ShowDetails.tsx's episode rows restructured to match: two sibling
  buttons (thumb = play, title = details) instead of a role="button" div
  wrapping a nested real <button>, which is invalid HTML. WatchedButton
  moved beside the thumb button instead of inside it, same reason.

* fix(ui): improve subtitle colors and episode section spacing

* refactor(mpv): use RawWindowHandle for platform-agnostic engine<->mac seam

Engine.rs now passes a bare RawWindowHandle to mac::attach instead of
importing AppKit directly. Lets windows/linux backends slot in without
engine.rs knowing their types. Add raw-window-handle 0.6 (same version
tauri uses for its Window trait).

* chore: bump version to 2.0.0-next

* feat(theme): add named theme palette and helpers

Replace dark/light/system model with gruvbox, jellyfin, aurora, rosepine.

Add Theme type, themes array with labels and dark/light flag, and helpers:
themeLabel(), isDark(), nextTheme(). Update default to gruvbox.
Add styles for all four theme schemes.

* refactor(ui): use theme model and cycle through named themes

Update components to use new Theme type and helpers. Simplify theme toggle
from dark/light binary to cycling through all named themes with Palette icon.
Remove system theme mode and OS preference listener.

* feat(ui/cards): add image load state and placeholder icon

- fade-in on load, jump-start with opacity: 0
- use Clapperboard icon for missing poster

* feat(ui/library-grid): show skeleton grid while loading

* feat(ui/row): show skeleton skeletons while loading

* feat(ui/home): wire loading state to Row components

* feat(ui/details): add image load state, placeholders, and ambient backdrop

- fade-in image loading with opacity: 0 jump-start
- Clapperboard icon placeholders for missing poster/backdrop
- blur backdrop wash bleeding into content
- DetailsLoading skeleton structure

* feat(styles/details): add skeleton loaders and ambient backdrop

- shimmer keyframe animation
- hero/poster skeleton placeholders
- ambient backdrop styles
- image load state classes
- placeholder icon styles

* feat(styles/tokens): add artwork fallback and View Transition easing

- artwork-fallback-bg: accent-tinted gradient for missing images
- View Transition pseudo-element animations
- respects prefers-reduced-motion

* feat(router): enable View Transitions for route crossfades

* chore(config): change default theme to jellyfin

* style: add new themes

* refactor(settings): split into modular sections

# [1.6.0](https://github.com/mahi160/photon/compare/v1.5.1...v1.6.0) (2026-07-14)


### Bug Fixes

* **player:** consolidate subtitle state, stabilize callbacks, fix progress reporting ([5b77114](https://github.com/mahi160/photon/commit/5b771143297af919c697cf22e4045eb6f400f4cd))


### Features

* **jellyfin:** add Quick Connect auth, media stream metadata, and trickplay info ([0258f44](https://github.com/mahi160/photon/commit/0258f44d81bbb613f207b59f9c7a5436cb746c7d))

## [1.5.1](https://github.com/mahi160/photon/compare/v1.5.0...v1.5.1) (2026-07-10)


### Bug Fixes

* **main:** resolve autoUpdater undefined at runtime in packaged builds ([8c0156d](https://github.com/mahi160/photon/commit/8c0156d00877dfab66f69c6b9cddc04adbd37477))

# [1.5.0](https://github.com/mahi160/photon/compare/v1.4.1...v1.5.0) (2026-07-10)


### Features

* **updater:** surface error messages instead of silently failing ([b79b451](https://github.com/mahi160/photon/commit/b79b4511ba84a0c59d954f24af31b68e4a6a155c))

## [1.4.1](https://github.com/mahi160/photon/compare/v1.4.0...v1.4.1) (2026-07-10)


### Bug Fixes

* **jellyfin:** validate auth response and improve error messages ([6cef70e](https://github.com/mahi160/photon/commit/6cef70e8d240e8f484a76cc81636b0eef759fe1a))

# [1.4.0](https://github.com/mahi160/photon/compare/v1.3.0...v1.4.0) (2026-07-10)


### Bug Fixes

* **api:** add request timeout and dynamic app version header ([7b983f7](https://github.com/mahi160/photon/commit/7b983f73417a24773d7a3816949ab3aeee50c889))


### Features

* **app:** wire router error handler and pass app version to API ([c26648d](https://github.com/mahi160/photon/commit/c26648d84ffcf8cc17262c86bfc69c49ea714370))
* **ui:** add route error and 404 fallback pages ([c327487](https://github.com/mahi160/photon/commit/c327487e76311016af59356bba2b11e6feba3e69))

# [1.3.0](https://github.com/mahi160/photon/compare/v1.2.1...v1.3.0) (2026-07-09)


### Features

* **main:** broadcast updater status to renderer on state changes ([7057049](https://github.com/mahi160/photon/commit/7057049168c94f2e5f891b7cbfc38ca70468046f))
* **preload:** add updater status API and event listener ([c76514a](https://github.com/mahi160/photon/commit/c76514a9a81fe5b5d4513ffb133b955656c2123a))
* **ui/login:** add panel container and enhance field styling ([ae5339b](https://github.com/mahi160/photon/commit/ae5339b8ff3d7aff36e8e45f26c38c99f34b5be5))
* **ui/settings:** show updater status and restart-to-update button ([573b693](https://github.com/mahi160/photon/commit/573b693a4a685cd1d127592396f9e28121047407))

## [1.2.1](https://github.com/mahi160/photon/compare/v1.2.0...v1.2.1) (2026-07-09)


### Bug Fixes

* **build:** unbreak launch on macOS and Windows ([a7a27ee](https://github.com/mahi160/photon/commit/a7a27eed231eb9a243f13241853d555167911f6d))

# [1.2.0](https://github.com/mahi160/photon/compare/v1.1.0...v1.2.0) (2026-07-09)


### Features

* **release:** automate releases with semantic-release + commitlint ([5bde74b](https://github.com/mahi160/photon/commit/5bde74b187189ca01c9b9b19d4ca1738e2719202))
* **ui:** migrate to reicon icons, add PhotonMark component ([bfafac3](https://github.com/mahi160/photon/commit/bfafac379ce4b56b72b09db8db9310e1324b1025))


### Performance Improvements

* memoize playback menus and stabilize callback identities ([657f872](https://github.com/mahi160/photon/commit/657f872ddee6ca99a5639f5dd382c0cba09a8c19))
