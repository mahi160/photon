# MPV Player Audit

Scope: the full in-process libmpv playback stack — Rust engine/commands, the
`PlaybackEngine` implementation, both playback hooks, session/profile/config,
controls UI, hotkeys, and OS media-session wiring.

Files reviewed:

- `src-tauri/src/mpv/engine.rs`
- `src-tauri/src/mpv/commands.rs`
- `src-tauri/src/mpv/mod.rs`
- `src-tauri/src/lib.rs`
- `src/renderer/src/player/engine.ts`
- `src/renderer/src/player/mpv.ts`
- `src/renderer/src/player/usePlayerEngine.ts`
- `src/renderer/src/player/usePlayback.ts`
- `src/renderer/src/player/session.ts`
- `src/renderer/src/player/deviceProfile.ts`
- `src/renderer/src/player/mpvConfig.ts`
- `src/renderer/src/pages/Player.tsx`
- `src/renderer/src/lib/useHotkeys.ts`
- `src/renderer/src/hooks/useMediaSession.ts`
- `src/renderer/src/components/PlayerControls.tsx`
- `src/renderer/src/components/ControlsBar.tsx`
- `src/renderer/src/pages/Shortcuts.tsx`

---

## Verdict

Architecture is sound and unusually well-reasoned. The `ponytail:` notes show
the hard races (loadfile async, track-list index shift, CoreAnimation flush,
mutex serialization) were already found and defended. Wiring from hotkey →
hook → IPC → mpv is consistent end to end.

Found **one real correctness race**, a few **latent/low-severity** issues, and
some **notes**. No showstoppers.

Priority order: fix #1 (defer `set_text_track`), then #2. Everything else is
optional.

---

## Findings

### 1. Text-subtitle selection is NOT deferred to `FILE_LOADED` — asymmetric with audio/embedded

**Severity: MEDIUM — correctness / race**

Every other post-`loadfile` selection is queued and drained on
`MPV_EVENT_FILE_LOADED`, precisely because "selecting a track right after
`loadfile` races the async load":

- `seek` → deferred via `pending.start_seconds`
- `select_track` (audio + embedded sub) → deferred via `pending.queued_tracks`

But `set_text_track` in `engine.rs` sets `sid` **immediately**, bypassing
`pending`:

```rust
pub fn set_text_track(&self, sid: Option<i64>) -> Result<(), String> {
    // sets the sid property directly — no pending.loaded check
}
```

Flow in `usePlayback.loadFor`: `engineLoad()` awaits `mpv_load` (which returns
as soon as `loadfile` is *queued*) plus the `add_subtitle` calls, then
synchronously calls `setTextTrack(sel.textTrack)`. mpv runs its **automatic
default-subtitle selection as part of file load** — if `FILE_LOADED` fires
*after* `setTextTrack`, mpv's autoselect clobbers the chosen external sub.
Timing-dependent → flaky "subtitle sometimes doesn't turn on / wrong sub shows
at start."

The `else if (sel.embeddedTrack === null) selectEmbeddedSubtitleTrack(null)`
"turn off container default" guard only runs in the **subtitles-off** branch,
never when a text track is chosen — so the text-track path has zero protection
against load-time autoselect.

**Fix:** route `set_text_track` through the same `pending` queue as
`select_track` (queue a text-sid entry when `!loaded`, apply it on
`FILE_LOADED`). One-line symmetry with the mechanism already present.

---

### 2. Initial volume/mute can be silently dropped on first attach

**Severity: LOW — race**

`mpv.ts` only awaits `this.ready` inside `load()`. But
`usePlayerEngine.ensureEngine` fires `e.setVolume()` / `e.setMuted()` at engine
construction, before `mpv_attach` resolves:

```ts
this.ready = invoke('mpv_attach', ...)          // async
// ...
setVolume(volume) { void invoke('mpv_set_volume', ...) }  // does NOT await ready
```

Rust `with_engine` returns `Ok(T::default())` when the engine slot is `None` —
a silent no-op. `mpv_attach` and `mpv_set_volume` both grab the `MpvState`
mutex; if `set_volume` wins the (non-FIFO) lock race it sees `None`, and the
persisted `lastVolume`/`lastMuted` is lost for the whole session. Self-corrects
on the next volume change and volume is persisted, so low severity — but real.

**Fix:** `await this.ready` in `setVolume`/`setMuted`, or re-apply initial
volume/mute inside `load()` after `await this.ready`.

---

### 3. All external subtitles are downloaded eagerly at load

**Severity: LOW — performance**

`add_subtitle` uses `sub-add url select` for **every** text track (needed for
the sid-readback trick, per the in-code comment). The `select` argument forces
mpv to fetch each subtitle over HTTP. A file with many external subs (10+
languages) triggers N fetches on load, not just the one the user wants.
`Promise.all` parallelizes the JS side, but it is still N network round-trips
at startup.

**Fix (only if it bites):** add without `select` and resolve the sid via
`track-list` `ff-index` / `external-filename` mapping, the same way
`find_track_id` already resolves embedded tracks. Not worth it unless startup
latency shows up in practice. Acceptable as-is.

---

### 4. Global `MpvState` mutex serializes the render tick against all input

**Severity: LOW — latency, by design**

Both `spawn_render_loop` and every command lock `state.0`. This is exactly what
makes concurrent `render_ctx` access safe (good — there is no data race despite
two threads calling `render()`), but it means a heavy **software** render frame
(module doc: "very slow, everything on the CPU") holds the lock while
`play`/`pause`/`seek`/`volume` wait. Worst case: input latency of one frame's
render time on each 16 ms tick.

Acceptable given the "buffer pool / IOSurface zero-copy / update-callback"
upgrade path already flagged in the module doc. Noted for completeness — a
known ceiling, not a bug.

---

## Smaller notes

- **Stale comment**, `usePlayerEngine.togglePlay`: *"decide off the element,
  not mirrored state — during 'buffering' the mirror can't tell..."* — but
  `MpvEngine.paused()` returns `this.last.paused`, which **is** mirrored state
  (comment carried over from the old HTML5 `<video>` engine). Functionally OK
  (last tick is fresh enough); the comment now lies. Fix the comment.

- **`hls` in `LoadRequest` is dead for mpv** — `MpvEngine.load` ignores it; mpv
  handles `.m3u8` transparently. Harmless interface leftover; leave it.

- **`navigator.mediaSession.playbackState` is never set.** `play`/`pause` both
  map to `togglePlay`, relying on the OS to guess state. Setting
  `playbackState = 'playing' | 'paused'` on each state change would make the OS
  overlay button (and the action it dispatches) reliably correct. Minor polish.

- **PiP (`P`)** is a confirmed no-op (ADR-0006): the `pip` event never emits, so
  the icon never flips and the `minimizeWindow`/`restoreWindow` effect in
  `Player.tsx` is dead until #8. Documented, fine.

- **`toDemuxedIndex`** (the External-sub index-shift correction in
  `session.ts`) is the most fragile piece in the whole path — it is the single
  point where a wrong count silently selects the wrong track. Confirm
  `session.test.ts` covers: multiple External subs before the target, an
  External sub *after* the target (must not shift), and mixed
  embedded+external ordering. Most likely thing to regress silently.

---

## What's solid

- loadfile-async race handling, seek/track deferral, track-list `ff-index`
  resolution, CATransaction flush, and drop-order teardown
  (stop → quit → join → free) are all correct and documented.
- The `MpvState` mutex genuinely serializes `render_ctx` access — no data race
  despite two threads reaching `render()`.
- Direct-play-always model (ADR-0008) is consistently threaded through
  profile → session → engine; audio and embedded-subtitle switching without a
  reload is correct.
- Subtitles-off explicitly overrides mpv's container-default autoselect (except
  the text-track gap in finding #1).
- Volume is single-source-of-truth via the `volume` event; mute-at-zero UX and
  rate-survives-reload are handled.
- Hotkeys check out: `shift+>` / `shift+<` match correctly (`>` = Shift+`.` →
  `e.key='>'` → `shift+>`), `[` / `]` are unshifted, `shift+arrowleft/right`
  don't collide with bare arrows, and the `:focus-visible` + `preventDefault`
  guard correctly prevents the Space double-toggle after a mouse click.
