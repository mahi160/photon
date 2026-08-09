# [2.0.0-pre.12](https://github.com/mahi160/photon/compare/v2.0.0-pre.11...v2.0.0-pre.12) (2026-08-09)


### Features

* **playback-info:** add Playback Info overlay panel with live mpv stats ([ea5e157](https://github.com/mahi160/photon/commit/ea5e157a831b092a367d0a2f09229fcfc07f8ccf)), closes [#49](https://github.com/mahi160/photon/issues/49)

# [2.0.0-pre.11](https://github.com/mahi160/photon/compare/v2.0.0-pre.10...v2.0.0-pre.11) (2026-08-09)


### Bug Fixes

* **mpv:** scale child-window rect to physical px on HiDPI Windows ([e14627c](https://github.com/mahi160/photon/commit/e14627c1a6a2e9e98a849f2d36c96823712cb4a8)), closes [#45](https://github.com/mahi160/photon/issues/45)

# [2.0.0-pre.10](https://github.com/mahi160/photon/compare/v2.0.0-pre.9...v2.0.0-pre.10) (2026-08-06)


### Bug Fixes

* **playback:** close mpv/jellyfin audit findings ([0d39ed7](https://github.com/mahi160/photon/commit/0d39ed7712e3b5b332abc41228f69f240ede8be0))

# [2.0.0-pre.9](https://github.com/mahi160/photon/compare/v2.0.0-pre.8...v2.0.0-pre.9) (2026-08-06)


### Features

* **api:** jellyfin v12 auth compat – apikey casing, device= hostname ([cf4f06e](https://github.com/mahi160/photon/commit/cf4f06e602ef895ad02cac7b056f744785f315f9))

# [2.0.0-pre.8](https://github.com/mahi160/photon/compare/v2.0.0-pre.7...v2.0.0-pre.8) (2026-08-06)


### Bug Fixes

* **auth:** warn when the entered Jellyfin server is plain HTTP ([cd547b6](https://github.com/mahi160/photon/commit/cd547b650fda0467cddd40fc08e719247318cda3))
* **commands:** surface fullscreen toggle failures instead of swallowing them ([b896c6a](https://github.com/mahi160/photon/commit/b896c6a099524ff04afe14d484028c87ed39d6b1))
* **linux:** composite mpv into a GtkGLArea under the webview ([6c468b1](https://github.com/mahi160/photon/commit/6c468b19f35cefb3e13eefcc1ab4bd353d0a817d))
* **linux:** make the GtkGLArea video surface correct under real GTK ([5027e68](https://github.com/mahi160/photon/commit/5027e680ed2fe21f75d82179c3cbbb3c41d629bf))
* **mpv:** clean up clippy warnings-as-errors failures ([a0b3fee](https://github.com/mahi160/photon/commit/a0b3fee95755b8e7c785b6cce62842542a4af5e7))
* **mpv:** consume frames while hidden and report swaps back to mpv ([3900fa1](https://github.com/mahi160/photon/commit/3900fa1c351487021e443ba6a69a7768e2444986))
* **mpv:** fix x11 and wayland display handling ([66402a9](https://github.com/mahi160/photon/commit/66402a9dfc05a074eff7e175e3f55ba0d07913da))
* **mpv:** keep the screen awake and surface mpv's own diagnostics ([8b7b065](https://github.com/mahi160/photon/commit/8b7b065769ef2ea1006db1d24c8a0495082c7c33))
* **mpv:** log failures setting built-in mpv options ([3748505](https://github.com/mahi160/photon/commit/37485052f58bcac62943ff713f01f41080eaadee))
* **mpv:** stop CPU HDR tonemap from running on the GPU render path ([91e34c6](https://github.com/mahi160/photon/commit/91e34c6475ca53de5edb1bde25450d3f67829112))
* **pip:** stop leaking Jellyfin token via spawned mpv argv ([6f92010](https://github.com/mahi160/photon/commit/6f92010da66ac0a19bcee7ad426741d8102fad57))
* **player:** guard arrow-key seek against OS key-repeat ([bc09eb1](https://github.com/mahi160/photon/commit/bc09eb1de147644872fcb980b8cb57e5bff4ed10))
* **player:** keep loading backdrop opaque until first mpv frame ([3ab229d](https://github.com/mahi160/photon/commit/3ab229de02b0933141c67545f1589b04a2276a37)), closes [#0e0e10](https://github.com/mahi160/photon/issues/0e0e10) [#0e0e10](https://github.com/mahi160/photon/issues/0e0e10)
* **player:** loosen DeviceProfile to match what mpv can actually decode ([d0c4bce](https://github.com/mahi160/photon/commit/d0c4bce7398240aded767d30e8cfc177549b32a5))
* **player:** restore missing PlayerEngineApi.runCommand ([a3b4c34](https://github.com/mahi160/photon/commit/a3b4c340a483fbd86d2bd192171993c381614c8c))
* **player:** serialize playback reporting, await stop before autoplay-next ([743c782](https://github.com/mahi160/photon/commit/743c782249dc313bb7a36651d4856b8ac4dbd62d))
* **player:** stop fullscreen toggle from double-firing the native call ([c7410c2](https://github.com/mahi160/photon/commit/c7410c2ada588861c6045c0e1f2aff920878ae0e))


### Features

* **mpv:** add wayland render backend for linux (issue [#27](https://github.com/mahi160/photon/issues/27)) ([a363244](https://github.com/mahi160/photon/commit/a36324464bace2ae6531d42b828935a4888a0c32))
* **player:** add run_command handler for generic mpv commands ([f471efe](https://github.com/mahi160/photon/commit/f471efea7c57393ecdd19cfa91db338cd5ef2ff5))
* **player:** pick the best MediaSource instead of always the first ([bd829e1](https://github.com/mahi160/photon/commit/bd829e13b8171c13be0ed7f9c54d397aedc6458d))


### Performance Improvements

* **player:** lazy-load external subtitles on selection, not all at load ([699d943](https://github.com/mahi160/photon/commit/699d943755e1635b4355825c68011ba4f588d146))

# [2.0.0-pre.7](https://github.com/mahi160/photon/compare/v2.0.0-pre.6...v2.0.0-pre.7) (2026-08-04)


### Features

* **mpv:** add wayland render backend for linux (issue [#27](https://github.com/mahi160/photon/issues/27)) ([5191488](https://github.com/mahi160/photon/commit/5191488ec6d5a657b5ba31df889021fce59d375a))
* **player:** add run_command handler for generic mpv commands ([71186aa](https://github.com/mahi160/photon/commit/71186aaf13bb7fba6a6a78827535cf28d8dc6e56))

# [2.0.0-pre.6](https://github.com/mahi160/photon/compare/v2.0.0-pre.5...v2.0.0-pre.6) (2026-07-26)


### Features

* **mpv:** real GLX (Linux/X11) and WGL (Windows) render surfaces ([#37](https://github.com/mahi160/photon/issues/37)) ([c8e34d7](https://github.com/mahi160/photon/commit/c8e34d7311bfc766c87478f7a2771754186ee32d)), closes [#27](https://github.com/mahi160/photon/issues/27)

# [2.0.0-pre.5](https://github.com/mahi160/photon/compare/v2.0.0-pre.4...v2.0.0-pre.5) (2026-07-24)


### Bug Fixes

* **theme:** revert default theme to gruvbox ([caa1cda](https://github.com/mahi160/photon/commit/caa1cdaddffd0e6faab557b52ea985b840b826ea))

# [2.0.0-pre.4](https://github.com/mahi160/photon/compare/v2.0.0-pre.3...v2.0.0-pre.4) (2026-07-23)


### Features

* **player:** show a calm overlay in-app while PiP owns playback ([#36](https://github.com/mahi160/photon/issues/36)) ([0901b33](https://github.com/mahi160/photon/commit/0901b3390e8d3dc381ff86558f72767b0dcc7f3b))

# [2.0.0-pre.3](https://github.com/mahi160/photon/compare/v2.0.0-pre.2...v2.0.0-pre.3) (2026-07-23)


### Bug Fixes

* **player:** don't leave playback paused when PiP fails to start ([#33](https://github.com/mahi160/photon/issues/33)) ([767b5ed](https://github.com/mahi160/photon/commit/767b5ed4e7e38d7902cb11da240ca8ce85ef639b))

# [2.0.0-pre.2](https://github.com/mahi160/photon/compare/v2.0.0-pre.1...v2.0.0-pre.2) (2026-07-23)


### Bug Fixes

* **release:** rotate updater signing keypair, matching private key set as GH secret ([#25](https://github.com/mahi160/photon/issues/25)) ([ddc8347](https://github.com/mahi160/photon/commit/ddc8347099210c0cc2535cb3048cdbb04383e9d2))
* **release:** windows bundler skips MSI for non-numeric prerelease versions ([#24](https://github.com/mahi160/photon/issues/24)) ([763d443](https://github.com/mahi160/photon/commit/763d4431002da2c9bae2ea53989efd362a9e5b74))

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
