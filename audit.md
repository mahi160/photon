# Photon — Thermo-Nuclear Code Quality Audit

Date: 2026-07-03 · Scope: full codebase (`src/`, ~4.8k lines incl. CSS)

> **Status: all findings resolved** (same day). Items 1–9 of the priority table
> fixed, plus the §8 accepted-duplication extras (`readPrefs`, `AUTO_BITRATE`
> move). `Player.tsx` is now ~140 lines; playback logic lives in
> `player/usePlayerEngine.ts` + `player/usePlayback.ts`. `schemePrimitives`
> deleted; tokens.css is the single palette source.

## Verdict

Codebase is small, boring, and mostly disciplined — plain-fetch Jellyfin client, one
playback engine behind a real interface, zero dead abstraction layers. That's the
right shape. The rot is concentrated in exactly one place: **`Player.tsx` is a god
component in the making**, and it already contains two latent correctness bugs caused
by the same structural problem (React state mirroring engine state through stale
closures). Everything else is polish.

Priority order below. Items 1–4 are the ones worth doing this week.

---

## 1. Structural: `Player.tsx` is the growth hotspot (434 lines, 13 `useState`, 5 refs, 3 `eslint-disable exhaustive-deps`)

**File:** `src/renderer/src/pages/Player.tsx`

Every player feature added so far (toast, subtitle delay, hotkeys, autoplay-next,
burn-in reload, auto-hide controls) landed in this one component. Three
`eslint-disable react-hooks/exhaustive-deps` comments are the tell: the component is
fighting the hooks model because it holds **two sources of truth** — engine state
(`video.currentTime`, `playbackRate`, `volume`…) mirrored into React state (`time`,
`rate`, `volume`, `muted`, `pip`, `state`), plus `session` duplicated as both state
and `sessionRef`.

This structure has already produced real bugs (see §2). It will produce more with
every feature. The code-judo move is not "split the file" — it's **stop mirroring**:

- **Extract `usePlayerEngine(videoRef)`** — owns the `Html5Engine`, subscribes to its
  events, exposes `{ state, time, duration, volume, muted, rate, pip }` plus command
  fns (`seek`, `setVolume`, `toggleMute`, `setRate`…) that write to the engine *and*
  the mirrored state in one place. Kills the `engineRef.current?.setVolume(v); setVolume(v)`
  duplication that currently exists in **three** places (arrowup, arrowdown, `onVolume`)
  and the mute toggle duplicated in two (`m` hotkey, `onMute`).
- **Extract `usePlaybackSession(item)`** — owns `startPlayback`/`load`/track selection/
  progress reporting. `session` state + `sessionRef` collapse to one.
- `Player.tsx` becomes wiring + JSX (~150 lines), and the `exhaustive-deps` disables
  disappear because commands live in stable closures over refs.

This is the single highest-leverage change in the repo. Do it before the next player
feature, not after.

## 2. Correctness bugs (both symptoms of §1)

### 2a. Stale playback rate on track switch — **bug**

`load` is a `useCallback` whose deps deliberately exclude `rate`
(`eslint-disable`d). Inside it: `engine.setRate(rate)`.

Repro: set speed to 2×, then switch audio track (or select a burned-in subtitle —
both call `load`). The reload calls `setRate` with the **initial** rate. UI shows 2×,
playback runs 1×. Fix today with a `rateRef`; fix properly via §1.

### 2b. Subtitle-delay cue mutation breaks on track switch — **bug**

`Html5Engine.setSubtitleDelay` applies a *cumulative shift by mutating cue times* on
**all** text tracks, and resets `delay` only on `load`. Sequence: enable track A, set
delay +2s → switch to text track B (no reload, no delay reset) → B's cues were never
shifted, but engine thinks applied delay is 2s. Nudging to 2.5s shifts B by only 0.5s
while the UI reports 2.5s. Also: cues fetched after the shift (lazy VTT load,
`disabled` tracks) are never shifted at all.

Mutating shared cue state and tracking one global cumulative offset is the hacky
version. Minimum honest fix: keep applied-shift **per track**
(`Map<TextTrack, number>`) and reconcile in `setTextTrack`/`setSubtitleDelay`; reset
delay UI state in `selectSubtitle` when the track changes.

### 2c. Stale `handleEnded` closure — latent

The `ended` listener is bound in a `[session]` effect and captures `handleEnded` →
`settings` from that render. Low practical impact today (settings unreachable during
playback), but it's the same disease as 2a and goes away with §1.

### 2d. `Shortcuts.tsx` — key on wrong element

`Keys` maps to a keyless `<>` fragment with `key` on the inner `<kbd>`. React key
warning + incorrect reconciliation semantics. Use `<Fragment key={k}>`.

## 3. Code judo: delete `colorSchemes.ts` data duplication via CSS cascade (~90 lines gone)

**Files:** `src/renderer/src/lib/colorSchemes.ts`, `src/renderer/src/styles/tokens.css`,
`src/renderer/src/pages/Settings.tsx`

`schemePrimitives` duplicates 4 schemes × 2 themes × 6 colors that already live in
`tokens.css`. The comment admits it ("kept as data here so Settings can render
swatches"). This is drift waiting to happen — change a hex in CSS, the Settings
swatches silently lie.

The elegant move: tokens.css selectors are plain attribute selectors
(`[data-scheme='gruvbox'][data-theme='dark']`), **not** scoped to `html`. So render
each scheme slab as:

```tsx
<button data-scheme={s.key} data-theme={dark ? 'dark' : 'light'}
        style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
  <i style={{ background: 'var(--accent)' }} /> …
```

The cascade hands each slab its own scheme's variables for free. Same trick for the
subtitle color swatches (wrap in an element carrying the attrs). `colorSchemes.ts`
shrinks to the `{key, label}` list; the entire `schemePrimitives` table and its
`Primitives` interface get deleted. One source of truth, zero new machinery.

(Caveat: `preferredSubtitleLanguage`-style persistence of a swatch picked as
`var(--accent)` needs the resolved hex — read it once via
`getComputedStyle(el).getPropertyValue('--accent')` at click time, or persist the
semantic name instead of the hex. Either is smaller than the current table.)

## 4. Dead weight — delete or wire

- **`zod` is a declared dependency with zero imports.** Remove it, or actually use it
  for `validateSearch` in `router.tsx` (the manual `typeof` checks are fine; removal
  is the lazier correct answer).
- **`checkUpdates` / `update:check` is a dead end-to-end path.** Preload exposes it,
  main handles it, **nothing in the renderer ever calls it** — so auto-update never
  runs despite `electron-updater` + `dev-app-update.yml` being shipped. Either call
  it once on app start (`main.tsx` or main-process `whenReady`) or delete the
  handler, the preload method, and the dependency. Shipping an updater that never
  fires is the worst of both.
- **No `test` script.** `lib.test.ts` + vitest exist, `package.json` has no
  `"test": "vitest"`. Tests that don't run in CI are decoration. Add the script and
  wire it into the GitHub workflow.

## 5. Missing micro-model: the "is this a text track?" predicate

`sess.textTracks.some((t) => t.index === subtitleIndex)` appears **four times** in
`Player.tsx` (`shiftSubtitleDelay`, `selectSubtitle`, `selectAudio`, `subtitleIsText`).
Repeated inline predicate = missing helper. One line on `PlaybackSession`'s module:

```ts
export const isTextTrack = (s: PlaybackSession, index: number): boolean =>
  s.textTracks.some((t) => t.index === index)
```

Folds naturally into the §1 session hook.

## 6. `Html5Engine` listener boilerplate → `AbortController`

**File:** `src/renderer/src/player/html5.ts`

9 paired `addEventListener`/`removeEventListener` lines. Replace with one
`AbortController`:

```ts
private ac = new AbortController()
// constructor: video.addEventListener('timeupdate', this.onTime, { signal: this.ac.signal }) …
// destroy(): this.ac.abort()
```

Deletes ~9 lines and the "forgot to remove one" failure class. Same file also hosts
bug 2b.

## 7. Theme resolution is circuitous

`main.tsx#applyTheme` computes dark-ness from `matchMedia` and writes
`dataset.theme`; `theme.ts#resolvedDark` then *reads the dataset back* for the
`'system'` case. Two half-implementations of one concept, coupled through the DOM.
Unify: `theme.ts` exports `resolveTheme(t): 'dark' | 'light'` using `matchMedia`;
`main.tsx` and `resolvedDark` both call it. Also: the `system` listener is missing —
OS theme change mid-session does nothing until a settings write. One
`matchMedia(...).addEventListener('change', …)` in `main.tsx` fixes it.

## 8. Accepted duplication — flagging, not blocking

- **Shortcuts page vs hotkey maps.** Keybindings defined twice (`Player.tsx` /
  `AppLayout.tsx` handlers vs `Shortcuts.tsx` display). A shared
  `{combo, label, hint}` table is possible but the wiring machinery outweighs 12
  entries. Accept until a third consumer appears — but if a shortcut changes and the
  page lies, that's the trigger.
- **"Cannot reach server. Retry" block ×3** (`MovieDetails`, `ShowDetails`,
  `LibraryGrid`). Extractable `<QueryError retry={…}/>`; marginal. Do it
  opportunistically, not as a project.
- **`main/index.ts` reads `prefs.json` in two places.** Extract `readPrefs()` when
  next touching the file.
- **`AUTO_BITRATE` lives in `stores/settings.ts`, used only by `player/session.ts`.**
  Wrong home; move to `deviceProfile.ts` alongside the profile it feeds.

## 9. What is genuinely good (keep it this way)

- `engine.ts` boundary is real and earns its keep — Jellyfin sync, hotkeys, autoplay
  all correctly live outside the engine (ADR-0002 honored).
- Plain-fetch `jellyfin.ts` instead of the SDK: right call, small surface, typed just
  enough. `queries.ts` as a flat list of `queryOptions` is exactly the boring shape
  React Query wants.
- Router: manual route table, guards via `beforeLoad`, no codegen. Fine at this size.
- Main process at 122 lines with keychain-only session storage and no plaintext
  fallback (`ponytail:` comment honest about it). Good.
- CSS tokens derive every surface from 6 primitives via `color-mix` — the *CSS side*
  of the scheme system is the model `colorSchemes.ts` should defer to (§3).
- `filterLocal`, `useHotkeys`, `useDebounced`: correctly hand-rolled, correctly tiny.

## Priority summary

| # | Item | Type | Effort |
|---|------|------|--------|
| 1 | Fix stale-rate bug (2a) | bug | XS (rateRef) |
| 2 | Fix subtitle-delay track-switch bug (2b) | bug | S |
| 3 | Extract `usePlayerEngine` + `usePlaybackSession` from `Player.tsx` | structure | M |
| 4 | Delete `schemePrimitives`, use CSS cascade for swatches | judo/deletion | S |
| 5 | Remove `zod`; wire-or-delete `checkUpdates`; add `test` script | hygiene | XS |
| 6 | `isTextTrack` helper (folds into #3) | dedup | XS |
| 7 | `AbortController` in `Html5Engine` | dedup | XS |
| 8 | Unify theme resolution + system-theme listener | cleanup | XS |
| 9 | `Shortcuts.tsx` fragment key (2d) | bug | XS |

No file is near the 1k-line boundary (max 434). No blocker on size — the blocker is
`Player.tsx`'s state model, not its line count.
