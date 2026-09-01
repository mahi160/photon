# Photon UI/UX Audit

Scope: every `.tsx` + `.module.css` under `src/renderer/src`, plus `styles/`,
`index.html`, router config. 44 findings, each with the smallest fix that works.

**Verdict.** Design system is genuinely good — token layer is well built (relative
colors, `color-mix`, one place to change a theme), motion vocabulary is coherent,
comments explain *why* not *what*. The problems are not taste, they're **five real
behavioural bugs, a contrast floor that fails AA on every theme, and ~500 lines of
hand-rolled UI that `@base-ui/react` already ships in the bundle you're paying for.**

Ratings: visual design 9/10 · interaction correctness 5/10 · accessibility 4/10 ·
code economy 6/10.

---

## P0 — Broken

### 1. Double-click-to-fullscreen is dead ~90% of the time

`pages/Player.tsx:313`

```tsx
onDoubleClick={(e) => {
  const t = e.target as HTMLElement
  if (t === e.currentTarget || t === videoRef.current) toggleFullscreen()
}}
```

`.layer` (`PlayerControls`) is `position:absolute; inset:0` and is rendered
whenever `visible`. Moving the mouse → `poke()` → `visible` → layer covers the
stage. So by the time you can double-click, `e.target` is `.layer`, never
`.stage`/`videoRef`. Fullscreen-by-double-click only fires in the ~3s window after
controls fade — i.e. when the mouse is *not* moving. Unreachable in practice.

**Fix** — kill the target check, guard on interactive descendants instead:

```tsx
onDoubleClick={(e) => {
  if (!(e.target as HTMLElement).closest('button,input,[role="menu"]')) toggleFullscreen()
}}
```

### 2. Wheel over the volume slider double-steps

`components/ControlsBar.tsx:366` (`<input class=volume onWheel>`) and
`components/PlayerControls.tsx:169` (`<div class=dock onWheel>`). The input is a
descendant of the dock; React wheel events bubble. One notch over the slider →
`onVolumeStep` twice → 10% jump, and the toast shows the post-second-call value so
it doesn't even look wrong, it just feels twitchy.

**Fix** — delete the inner handler (`ControlsBar.tsx:366`). Dock already covers it.

Related, same handler: scrolling anywhere over the dock — **including the
timeline** — changes volume. Every other player scrubs or ignores there. Scope the
listener to `.controlsRow` or exclude the timeline.

### 3. `--fg-faint` fails WCAG AA on all six themes; `--fg-muted` fails on both light ones

Measured contrast vs `--bg` (sRGB approximation of the `color-mix` result):

| theme | `--fg` | `--fg-muted` | `--fg-faint` |
| --- | --- | --- | --- |
| gruvbox | 8.16 | 5.30 | **3.10** |
| graphite | 19.06 | 7.76 | **3.81** |
| obsidian | 15.69 | 7.51 | **3.81** |
| midnight | 17.19 | 7.79 | **3.90** |
| rosepine | 6.66 | **4.02** | **2.29** |
| everforest | 5.18 | **3.08** | **1.97** |

AA small text needs 4.5. `--fg-faint` carries card subtitles (year, `S1:E4`),
library counts, every settings hint, placeholder text, `.qcHint`, `.statsNote`,
`.epNumberLine`. On Everforest at 1.97 that copy is essentially decorative.
`--border-strong` sits at 1.50–2.52 — below the 3.0 non-text minimum, so form
field boundaries are invisible on the light themes.

**Fix** — one line in `styles/tokens.css`. `--fg-faint` is currently 65% of muted:

```css
--fg-faint: color-mix(in oklch, var(--fg-muted) 82%, var(--bg));
```

and lift the two light themes' `--fg-muted` (`rosepine` → `#6e6a86`,
`everforest` → `#708089`). Then re-check with a `contrast-color()` fallback later
when it lands. Don't add a "high contrast" setting — fix the floor.

### 4. No scroll restoration: back from a title dumps you at the top of the library

`router.tsx` has `defaultPreload`, `defaultViewTransition`, but no scroll
restoration, and the scroll container is `.main` (`AppLayout`), not the window.
Browse 400 movies, open one, hit Back → row 1. This is the single most
frustrating thing in the app.

**Fix** — TanStack Router supports non-window containers:

```tsx
// router.tsx
createRouter({ ..., scrollRestoration: true })
```

```tsx
// AppLayout.tsx — needs a stable id on the scroll element
const entry = useElementScrollRestoration({ getElement: () => scrollRef.current })
<main ref={scrollRef} data-scroll-restoration-id="app-main" data-scroll-root>
```

### 5. Home's staggered reveal desyncs whenever the error banner shows

`pages/Home.module.css:8` targets `:nth-child(2|3|4)`. `Home.tsx` renders the
error `<div>` as child 1 *conditionally*. Error present → Continue Watching gets
the 60ms delay meant for Next Up, and Recently Added Shows gets none. Also breaks
when any `Row` returns `null` (empty list) — the count shifts.

**Fix** — index-driven, not position-driven:

```css
.page > section { animation: rise var(--dur-slow) var(--ease-out) backwards; animation-delay: calc(var(--i, 0) * 60ms); }
```

```tsx
<Row style={{ '--i': 1 }} ... />
```

Or simpler and more honest: drop the stagger. Four rows appearing in sequence
delays the fourth by 180ms every single launch, forever, for a decoration nobody
sees twice.

### 6. `pnpm lint:css` fails with 121 problems and runs nowhere

`.github/workflows/ci.yml` only runs `pnpm lint` (eslint). Husky only has
`commit-msg`. So `lint:css` is a script that has never passed:
64 `alpha-value-notation`, 38 `properties-order`, 16
`custom-property-empty-line-before`, 3 `comment-empty-line-before`.
All auto-fixable.

**Fix** — `pnpm lint:css:fix`, then add `- run: pnpm lint:css` to ci.yml.
A linter that can't be run isn't a linter, it's a lie in package.json.

---

## P1 — UX gaps

### 7. `defaultPreload: 'intent'` never fires anywhere it matters

Every card, every episode row, every season chip uses `navigate()` from a
`<button>`. Router preloading only hooks `<Link>`. So the config on
`router.tsx:135` does nothing for the 95% of navigation that happens from a
poster. Hovering a card should already have the item + MediaSources in cache by
the time you click; instead the detail fetch starts on mousedown and you watch a
skeleton.

**Fix** — `Card.tsx`, swap the title/poster buttons for `<Link>` with `render`
semantics preserved:

```tsx
<Link to="/movies/$itemId" params={{ itemId: item.Id }} className={styles.title}>
```

For the poster (which plays, not navigates) keep the button but add manual
prefetch on hover — one line:

```tsx
onPointerEnter={() => router.preloadRoute({ to: '/movies/$itemId', params: { itemId: item.Id } })}
```

### 8. "Instant" local search is debounced 250ms

`pages/Search.tsx:55,72`. ADR-0001 and the idle copy both promise movies/shows
filter *instantly*; the code makes them wait a quarter second, same as the
server-side episode path. `filterLocal` is a single `for` loop over a few
thousand strings — sub-millisecond.

**Fix** — use the raw term locally, keep the debounce for episodes only:

```tsx
const local = useMemo(() => (q.length >= 2 && index.data ? filterLocal(index.data, q) : []), [index.data, q])
const episodes = useQuery(episodeSearchQuery(debounced))
```

Bonus: history saves any term you pause on for 1s, including zero-result typos.
Gate it: `if (settled.length >= 2 && local.length) addHistory(settled)`.

### 9. Settings sections aren't routes

`Settings.tsx` swaps panels off `useSettings.settingsSection` (persisted to
localStorage). Consequences: no deep link to `/settings/playback`, Back from
Playback exits Settings entirely instead of returning to General, and the
last-section-restore behaviour surprises people who expect Settings to open where
Settings opens.

**Fix** — one child route, `panels` map already exists:

```tsx
const settingsSectionRoute = createRoute({
  getParentRoute: () => settingsRoute, path: '$section',
  component: () => panels[useParams({ from: ... }).section]
})
```

Delete `settingsSection` from the settings store while you're there.

### 10. Scrubbing the timeline fights playback ticks

`TimelinePreview.tsx` renders a controlled `<input type=range value={currentTime}>`
that the engine rewrites every tick. Drag slowly and the thumb snaps backward
between `onChange` and the next `time` event. Classic controlled-media-slider bug.

**Fix** — local drag state, ~4 lines:

```tsx
const [scrub, setScrub] = useState<number | null>(null)
value={scrub ?? Math.min(currentTime, duration || 0)}
onChange={(e) => setScrub(Number(e.target.value))}
onPointerUp={() => { if (scrub !== null) onSeek(scrub); setScrub(null) }}
```

Or swap for `@base-ui/react/slider`, which handles this plus keyboard, and is
already installed.

### 11. The entire player is `tabIndex={-1}`

Every control in `ControlsBar`, `TrackSelectMenu`, `PlayerControls`, `NextUpCard`,
`SkipSegmentButton`. The rationale (`useHotkeys.ts`) is sound — a focused button
would eat Space — but the outcome is a media player with **zero** keyboard or
screen-reader reachable controls. Hotkeys cover most of it, `Shift+S` screenshot
and "Skip Intro" are not equivalently reachable, and AT users get nothing.

**Fix** — don't un-tab everything. Make the hotkey handler ignore *activation*
keys on focused buttons instead, which it already half-does via `:focus-visible`:

```ts
if (target?.matches('button:focus-visible') && (e.key === ' ' || e.key === 'Enter')) return
```

Then drop `tabIndex={-1}` from `SkipSegmentButton`, `NextUpCard` and the play/next
buttons at minimum. Menus can stay as-is.

### 12. Toasts are invisible to assistive tech

`pages/Player.module.css:.toast` + `Player.tsx` render a bare `<div>`. "Muted",
"Skipped intro", "Subtitle delay +0.5s" are the only feedback for those actions.

**Fix** — `<div role="status" aria-live="polite" className={styles.toast}>`.
Better: `@base-ui/react/toast` is installed and gives you the live region,
stacking, hover-pause and swipe-dismiss for less code than `useToast.ts`
(33 lines) currently costs.

### 13. Two select systems

Base UI `Select` in the player (glass, themed, keyboard-navigable) vs native
`<select>` in `MovieDetails`, `EpisodeDetails`, `PlaybackSettings`. The native
popup renders in OS chrome — light-grey list on Gruvbox, ignores every token.
Same app, two visual languages, for the same job.

**Fix** — one shared `<Select>` wrapper over `@base-ui/react/select` (already in
the bundle; using it more costs zero bytes). Deletes `.select` duplication in
`Details.module.css` + `Settings.module.css`.

### 14. `user-select: none` on `body` blocks copying anything

`styles/base.css:18`. Cannot copy: a Quick Connect code, an error message from
`RouteError`, the version string from About, a Jellyfin server URL, an item
overview.

**Fix** — invert the default:

```css
body { user-select: none }
p, .overview, input, textarea, [data-selectable] { user-select: text }
```

Or narrower and cheaper: put `user-select: none` on `.shell`/`.layer` only.

### 15. Window title never changes

No `document.title` write anywhere. Alt-Tab / dock / taskbar always says "Photon",
even mid-film. Free context, one effect.

```tsx
useEffect(() => {
  document.title = session?.item ? `${session.item.Name} — Photon` : 'Photon'
}, [session?.item])
```

### 16. Right-click to toggle remaining time is undiscoverable

`TimelinePreview.tsx` binds `onContextMenu` on the duration label, hinted only by
a native `title` (1s+ delay, unstyled, inconsistent with `Tip`). Not in the
shortcuts sheet. Not in AGENTS.md's key table.

**Fix** — make it a left click (`onClick`), keep it a `<button>`, and wrap in
`Tip label="Toggle remaining"`. One-word change, ten times the discovery rate.

### 17. The shortcuts sheet lies in three places

`pages/Shortcuts.tsx`:
- `Item label="Back / close" keys={['Esc']}` under **Global** — there is no global
  Esc handler. `AppLayout`'s `useHotkeys` map has none; Esc only closes Base UI
  dialogs and exits fullscreen inside the player.
- Two consecutive rows both labelled "Search" (`/` and `⌘F`). Merge:
  `<Item label="Search" keys={['/']} alt={[mod,'F']} />` or just show `/`.
- `navigator.platform` (line 41) is deprecated and reports `MacIntel` under
  Rosetta. Use `navigator.userAgent.includes('Mac')`.

Also: `<` / `>` are registered as `shift+<` / `shift+>` in `Player.tsx` but AGENTS
documents them unshifted. They agree by accident (US layout `>` requires shift);
on layouts where `>` is unshifted, speed control is dead. Register both.

### 18. No "Auto" theme

Six themes, four dark, two light, and no `prefers-color-scheme` follow. Desktop
users on macOS/Windows expect the app to flip at sunset with the OS.

**Fix** — `theme: 'auto'` resolving in `main.tsx`'s `applyAppearance`:

```ts
const t = settings.theme === 'auto'
  ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'gruvbox' : 'rosepine')
  : settings.theme
```

plus one `matchMedia(...).addEventListener('change', applyAppearance)`.

### 19. Volume level is invisible at rest

`.volume { inline-size: 0; opacity: 0 }` until `.volumeGroup:hover`. You cannot
see whether you're at 20% or 80% without hovering, and the mute icon only
distinguishes 0 from not-0. Calm ≠ hidden state.

**Fix** — keep the unfold, but make the mute icon carry the level:
`<Volume>` at ≥50%, a low-volume glyph below, `<Mute>` at 0. Or reveal on
`.controlsRow:hover` instead of the button itself — you're already hovering the
dock when you care.

### 20. Horizontal rows have no scroll affordance for mouse users

`Row.module.css:.track` hides the scrollbar (`scrollbar-width: none`) and relies
on a cut-off card. Trackpad users are fine. A mouse user with no horizontal wheel
has *no* way to reach card 12 of 20 except drag-selecting or keyboard-tabbing
through every card.

**Fix** — cheapest real fix is `scroll-snap-type: inline proximity` on `.track` +
`scroll-snap-align: start` on children, then two chevron buttons that call
`track.scrollBy({ left: ±track.clientWidth * 0.8, behavior: 'smooth' })`. ~12
lines. Or use `@base-ui/react/scroll-area` (installed) for a styled, always-legible
thin scrollbar and skip the buttons.

### 21. Tooltips have no shared delay group

`Tip.tsx` sets `delay={1000}` per trigger, with no `Tooltip.Provider`. Sweeping
across the 8 icon buttons in the dock means waiting a full second at each one,
every time. Base UI ships the fix.

**Fix** — one wrapper in `main.tsx`:

```tsx
<Tooltip.Provider delay={600} closeDelay={0} timeout={400}>
```

Then drop the per-trigger `delay`. Adjacent tooltips become instant. This is the
single highest polish-per-line change in the audit.

### 22. Three tooltip systems coexist

Base UI `Tip` (icon buttons), native `title=` (`Card.tsx` title/subtitle,
`PlayerControls.tsx` badges, `TimelinePreview` duration), and `aria-label`-only
(`Ratings`). Native `title` has a ~1.5s delay, OS styling, and never appears on
touch or for keyboard focus.

**Fix** — `Tip` everywhere, or accept `title` for genuinely-truncated text only
(`Card.title`, where it's the right tool) and remove it from the badges.

---

## P2 — Performance, bundle, duplication

### 23. `backdrop-filter` stays live over playing video while controls are hidden

`.hidden { pointer-events: none; opacity: 0 }` — the element is still painted and
composited, and `.dock::before` carries `backdrop-filter: blur(10px)` plus a
gradient + mask over the *live decoded video surface*, every frame, for the entire
film. `.menu`, `.syncPopup`, `.skipSegment`, `.nextUp` are `blur(20px)`.

**Fix** — one declaration:

```css
.hidden { visibility: hidden; pointer-events: none; opacity: 0 }
```

`visibility` still transitions (with `transition-behavior: allow-discrete` or just
`transition: opacity ..., visibility 0s var(--dur-med)`), and drops the layer out
of compositing entirely. Measurable on integrated GPUs during 4K playback.

### 24. `libraryQuery` and `searchIndexQuery` fetch the whole library, uncapped, full-fat

`lib/queries.ts:71` — no `Limit`, and `Fields: 'ProductionYear,DateCreated'` *adds*
to the default field set rather than restricting it. For a 10k-item library that's
a multi-megabyte JSON parsed on the main thread at first paint of `/movies`.
`searchIndexQuery` (line 87) has no `Fields` at all despite the comment promising
"id, title, year".

**Fix** — `EnableUserData=true&EnableImages=true&ImageTypeLimit=1&EnableImageTypes=Primary`
is already right on the index query; add `Fields: 'PrimaryImageAspectRatio'` only,
and drop `Overview` from `resumeItemsQuery` (line 30) — `Card` never renders it.
If libraries are genuinely 10k+, `useInfiniteQuery` with `StartIndex`/`Limit: 200`
is the honest fix; the virtualizer is already there to consume it.

### 25. Every playback tick re-applies the theme

`main.tsx:23` — `useSettings.subscribe(applyAppearance)` with no selector fires on
*any* store write. `lastVolume`, `lastSpeed`, `lastSubtitleDelay` are all written
to that store during playback. Each write sets `dataset.theme` and loops 7
`setProperty`/`removeProperty` calls on `documentElement` → style recalc.

**Fix** — `subscribeWithSelector` middleware, or two lines:

```ts
let prev = ''
useSettings.subscribe((s) => {
  const key = s.theme + JSON.stringify(s.customColors)
  if (key !== prev) { prev = key; applyAppearance() }
})
```

### 26. `content-visibility: auto` on cards inside a virtualizer

`Card.module.css:5` sets `content-visibility: auto; contain-intrinsic-size: auto 280px`,
and `LibraryGrid` passes those same cards to `virtualizer.measureElement`. Skipped
cards report the *placeholder* size, so measured row heights can be wrong until
paint → the total size jitters and the scrollbar walks. Two virtualization
mechanisms fighting.

**Fix** — pick one. The virtualizer already guarantees off-screen cards don't
exist; drop `content-visibility` from `.card` (keep it if you ever want it for
`Row`, but scope it to `.track > .card`).

### 27. Shimmer animates `background-position` (paint, not composite)

`CardSkeleton.module.css` and `Details.module.css` both run a 1.6s infinite
`background-position` animation across up to 24 elements. Repaints every frame on
the main thread while the network request is in flight — exactly when the main
thread is busiest.

**Fix** — animate `transform: translateX()` on an overlay pseudo-element, or drop
to an `opacity` pulse. Same look, GPU-only.

### 28. Images: no `decoding`, no DPR awareness on the hero

`imageUrl(item, 360|480)` is fine for cards (≈2× at 11rem). `backdropUrl(item, 1280)`
is not: the hero spans the full window, so a 2560-logical-px window at DPR 2 gets a
1280px source upscaled 4×. Visibly soft.

**Fix** — one line each:

```ts
const dpr = Math.min(2, devicePixelRatio)   // in jellyfin.ts
`...fillWidth=${Math.round(width * dpr)}&quality=90`
```

and add `decoding="async"` to every `<img>` (`Card`, `DetailsShell`, `EpisodeRow`,
`NextUpCard`) — avoids synchronous decode jank on scroll.

### 29. Duration formatting exists four times

`TimelinePreview.fmt`, `PipOverlay.fmt`, `MovieDetails.fmtRuntime`,
`EpisodeDetails.fmtRuntime` (byte-identical), `StatsSettings.fmtDur`. Five
functions, three formats, one job.

**Fix** — `lib/format.ts` with `hms(seconds)` and `humanDuration(seconds)`.
Net −40 lines.

### 30. `MovieDetails` and `EpisodeDetails` are ~90 duplicated lines

Identical: `fmtRuntime`, stream splitting, `meta` array, `badges` block, the
Resume/Play/Watched actions row, and the entire audio+subtitle `<select>` block
(45 lines, character-for-character).

**Fix** — `DetailsShell` already exists and is the right home. Add
`<DetailsActions item position onPlay />` and `<DetailsTrackPickers streams audio sub onAudio onSub />`.
Net −120 lines across the two pages.

### 31. `NextUpCard` duplicates its own visibility condition

`PlayerControls.tsx:120` computes `showNextUp` (duration > 0, remaining ≤ 30,
remaining > 0, not dismissed) and only then renders `<NextUpCard>`, which
re-checks the first three in its own body and returns `null`. Dead branch.

**Fix** — delete the guard inside `NextUpCard`.

### 32. Hand-rolled components that Base UI already ships (installed, tree-shaken)

| hand-rolled | lines | Base UI equivalent |
| --- | --- | --- |
| `ToggleSwitch.tsx` | 21 + 30 CSS | `@base-ui/react/switch` |
| `useToast.ts` + `.toast` CSS | 33 + 30 | `@base-ui/react/toast` |
| `LibraryGrid` sort pills (`role=group` + `aria-pressed`) | ~20 | `@base-ui/react/toggle-group` (roving tabindex, arrow keys, free) |
| `Row.track` hidden scrollbar | — | `@base-ui/react/scroll-area` |
| `.timeline` / `.volume` `<input type=range>` | ~60 CSS, WebKit-thumb only | `@base-ui/react/slider` |
| `Settings.tsx` sidebar | ~25 | `@base-ui/react/tabs` (or routes, see #9) |

You already pay for the package. Using six more subpaths of it adds ~8 KB gzipped
and deletes ~200 lines of app code plus the a11y bugs in #10/#11. This is the
laziest possible net-negative-diff win in the codebase.

### 33. Grid sort resets on every navigation

`LibraryGrid.tsx:47` — `useState<SortKey>('added')`. Sort by Name, open a movie,
come back: Added. Everything else in the app persists (theme, settings section,
search history).

**Fix** — it's a URL concern, not a store concern:
`validateSearch` on `moviesRoute` + `useNavigate({ search })`. Free deep links,
free back/forward, free persistence.

---

## P3 — Polish, micro-animation, a11y one-liners

### 34. Shared-element transition, card → hero

`defaultViewTransition: true` is already on, so route crossfade works. The obvious
next step costs almost nothing: name the clicked poster and the details poster the
same, and the browser morphs one into the other.

```css
/* Card.module.css */ .poster { view-transition-name: var(--vt, none) }
/* Details.module.css */ .posterImg { view-transition-name: var(--vt, none) }
```

```tsx
style={{ '--vt': `poster-${item.Id}` }}
```

Guard with `@supports (view-transition-name: none)`; degrades to the current
crossfade on older WebKitGTK. This is the one animation people will screenshot.

### 35. `accent-color`

Native `<input type=range|color>`, focus rings on native controls, `<progress>` —
all themeable with one declaration in `tokens.css`:

```css
:root { accent-color: var(--accent) }
```

### 36. `<html>` has no `lang`

`index.html:2` — `<html>`. Screen readers guess the pronunciation language.
`<html lang="en">`.

### 37. Nav links don't expose active state to AT

`AppLayout.tsx` relies on TanStack's `data-status="active"` for styling only.
Add `activeProps={{ 'aria-current': 'page' }}` to each `<Link>`. One prop.

### 38. `Ratings` puts `aria-label` on a `<span>`

`components/Ratings.tsx:14` — `aria-label` on a non-interactive, role-less element
is ignored by most screen readers. Add `role="img"` (then the label is honoured).

### 39. Stat bars are a chart with no values

`StatsSettings.tsx:82` — 30 bars, one `aria-label` on the container, no per-bar
information for anyone (mouse users included).

```tsx
title={`${dayLabel} · ${fmtDur(b)}`}
```

Cheap, helps everyone, no tooltip library needed.

### 40. Search input has no clear affordance

`pages/Search.tsx:103` — plain `<input>`. `type="search"` gives you the native
clear button in WebKit for free, plus Esc-to-clear. One attribute.
(Also: results have no counts, and Enter doesn't open the first hit — the two
things people expect from a search box.)

### 41. Shortcuts dialog doesn't animate closed

`Shortcuts.module.css` uses `@keyframes card-in` / `overlay-in`, so open animates
and close is instantaneous. `PlaybackInfo.module.css` does it correctly with
`[data-starting-style]` / `[data-ending-style]` transitions and even documents why.
Two dialogs, two techniques, one of them wrong.

**Fix** — copy `PlaybackInfo.module.css`'s pattern into `Shortcuts.module.css`.
Better: the two files are 90% identical — extract `styles/dialog.module.css` and
`composes:` from both.

### 42. `<details>` disclosure doesn't animate

`PlaybackSettings.tsx`'s Advanced section. Now solvable without JS:

```css
:root { interpolate-size: allow-keywords }
.advancedBody { transition: height var(--dur-med) var(--ease); }
.advanced::details-content { block-size: 0; transition: block-size var(--dur-med), content-visibility var(--dur-med) allow-discrete; }
.advanced[open]::details-content { block-size: auto }
```

Chromium-only today — check availability before shipping; degrades to the current
instant toggle, so it's safe behind `@supports selector(::details-content)`.

### 43. `:focus-visible` sets `border-radius` globally

`styles/base.css:91` — `border-radius: var(--radius-s)` applies to the *element*,
not the outline. It happens to be harmless today only because CSS Modules are
injected after `base.css` and win the equal-specificity tiebreak. Any change to
bundling order squares off every pill button on focus.

**Fix** — delete the line. Outlines already follow the element's own radius.

### 44. Misc

- **`prefers-reduced-transparency`** — the app leans hard on `backdrop-filter`
  (dock, menus, login panel, tooltips, PlaybackInfo). One media query dropping
  blurs to solid `--player-glass-strong` respects the setting and is a free perf
  win on weak GPUs.
- **Quick Connect polls forever** — `Login.tsx:44`, 2s interval, no expiry. Jellyfin
  codes expire; the UI says "Waiting for approval…" indefinitely. Add a 5-minute
  cap with a "Code expired, try again" state.
- **Empty-state voice drifts** — "Cannot reach server.", "No movies yet. Add media
  to your Jellyfin library.", "Nothing here yet.", "Nothing found",
  "Nothing yet — stats count watch time…". Five phrasings of two ideas. Pick
  "Nothing here yet." + a specific second line, and give the error states one
  shared `<Status>` component (they're three copies of the same retry markup:
  `Home.tsx:29`, `LibraryGrid.tsx:130`, `DetailsShell.tsx:36`).
- **`handleEnded` boots you to Home** — `usePlayback.ts:305`. Film ends, hard cut
  to the Home grid. A "Finished · back to Home in 5s / Watch again" beat costs one
  small component and is the difference between a player and a media *player*.
- **`MIN_CARD_PX = 168` hardcodes `1rem = 16px`** — `LibraryGrid.tsx:26`. Breaks the
  column math under OS font scaling. `parseFloat(getComputedStyle(document.documentElement).fontSize) * 10.5`.
- **`.grid` is an empty rule** — `LibraryGrid.module.css:99`, comment only. Delete
  it (this is one of the 121 stylelint errors).

---

## Do this first

Ordered by (impact × 1/lines):

1. `Tooltip.Provider` — 1 line, transforms dock feel. (#21)
2. Delete `ControlsBar.tsx:366` `onWheel` — 1 line, fixes volume. (#2)
3. `.hidden { visibility: hidden }` — 1 line, real GPU win during playback. (#23)
4. Fix `onDoubleClick` target check — 3 lines, restores fullscreen. (#1)
5. `--fg-faint` mix ratio + two light `--fg-muted` — 3 lines, fixes AA everywhere. (#3)
6. `role="status" aria-live` on toast, `lang="en"`, `accent-color`, `aria-current`,
   `role="img"`, `type="search"` — 6 lines total. (#12, #36, #35, #37, #38, #40)
7. Undebounce local search — 2 lines. (#8)
8. `pnpm lint:css:fix` + wire into CI — 2 lines. (#6)
9. Scroll restoration — ~6 lines, kills the worst daily annoyance. (#4)
10. `<Link>` / `preloadRoute` on cards — ~4 lines, makes the whole app feel instant. (#7)

That's under 40 lines of change for 10 of the 12 things a user would actually
notice.

## Explicitly not worth doing

- A design-token build step / CSS-in-JS. The current `tokens.css` +
  `color-mix`/relative-color layer is better than what a tool would generate.
- A component library beyond Base UI. You need six more subpaths of what you have,
  not a second dependency.
- Custom focus-management, a keyboard-shortcut library, or a state machine for the
  player. `useHotkeys.ts` is 44 lines and correct; the bug is in what it's applied
  to (#11), not in it.
- Storybook, visual regression, or a theming UI beyond the 7 existing swatches.
- i18n. Not a stated goal, and it would triple the surface of every string above.
