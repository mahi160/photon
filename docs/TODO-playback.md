# Playback TODO: closing the gap with raw mpv

Tracks everything still open after the mpv player audits
(`docs/audits/mpv-player-audit.md`, `docs/audits/mpv-optimization-research.md`)
and the session that acted on them. Codec/audio/direct-play coverage is close
to raw mpv now; what's left is color-pipeline fidelity, PiP, and frame timing —
all real architecture-level items, not config tweaks. Ordered by impact.

---

## 1. Verify the HDR tonemap filter against a real HDR file/display

**Status:** implemented, unverified. **Size:** small (verification only, code
already written).

`engine.rs`'s `apply_hdr_tonemap` was written against mpv's documented API and
the standard community ffmpeg `zscale`+`tonemap` recipe, but never run against
a real HDR10/HLG file on a real display — no test file or display was
available when it was written.

- [ ] Get one real HDR10 file and one real HLG file (different mastering
      metadata / peak nits ideally).
- [ ] Play both in Photon; compare against `mpv --vo=gpu-next` on the same
      files (known-good reference) side by side.
- [ ] Confirm: no blown-out highlights, no crushed shadows, no visible color
      shift vs. the reference.
- [ ] Confirm the filter actually toggles: load an HDR file then an SDR file
      back to back, confirm SDR playback isn't affected (check `video-params/gamma`
      via `mpv_get_property` / OSD if needed to sanity-check the observed value).
- [ ] If it looks wrong: the tunable is `npl=100` (assumed nominal peak
      luminance when a file has no mastering-display metadata) and the
      `tonemap=hable` curve — both are the one place this could plausibly need
      adjusting per real content.

---

## 2. Real EDR / wide-gamut HDR display — architectural, needs an ADR

**Status:** not started. **Size:** large — a real design decision, not a
patch.

`MPV_RENDER_API_TYPE_SW` (the render API Photon uses, ADR-0005) only supports
8-bit RGB output formats (`rgb0`/`bgr0`/`0bgr`/`0rgb`) — confirmed in mpv's own
`render.h`. There is no path to real HDR/EDR (brighter-than-SDR, wide gamut,
e.g. macOS's Extended Dynamic Range on XDR displays) through this render path,
full stop. The tonemap filter (#1) makes HDR content display with *correct*
colors on an *SDR* target — it does not make it *actually HDR*.

Closing this for real needs one of:

- [ ] **Revisit the GPU render API** (`gpu`/`gpu-next`). ADR-0005 ruled this
      out because of a real bug: `NSOpenGLView` rendered flat gray, and
      transparent OpenGL surfaces have been broken on macOS since 10.11. Worth
      re-checking whether `gpu-next`'s Metal backend (rather than the OpenGL
      backend originally tried) sidesteps that bug entirely — Metal-backed
      layers don't have the same transparency/compositing history OpenGL does
      on macOS. This is the "do it properly" option: real HDR/EDR, GPU-side
      tone-mapping via libplacebo, and hardware-accelerated color management,
      but it's a real rewrite of the compositing layer (ADR-0003/0005's whole
      "software render API + CALayer" approach goes away).
- [ ] **Or:** confirm mpv's `cocoa-cb` backend (native window, not embedded)
      genuinely can't be composited under a transparent WKWebView region the
      way the current NSView is — if there's a way to make `cocoa-cb`'s own
      window (which does have real EDR support landing, mpv PR #14017) sit
      correctly under Photon's UI, that avoids a full GPU-render-API rewrite.
      Worth a spike before committing to the larger rewrite above.
- [ ] **Or:** accept the ceiling and document it as a known, permanent
      limitation of Photon's compositing model — not every media player needs
      to chase XDR displays, and this is a legitimate "not worth it" call if
      the above two options both turn out to be real dead ends.

This needs its own spike + ADR, not a todo checkbox that gets casually ticked.

---

## 3. Real OS-integrated Picture-in-Picture

**Status:** known ceiling, documented (ADR-0006). **Size:** medium-large,
per-platform.

`P` currently shrinks Photon's own window into an always-on-top mini window —
not real OS PiP (AVKit on macOS, Compact Overlay on Windows). ADR-0006's own
words: "a known ceiling, not the final word — real per-OS PiP bridging can be
revisited later if the mini window turns out not to be enough." mpv's render
API frames aren't attached to an actual `<video>`/`AVPlayerLayer` those OS APIs
can hook into (same underlying issue as #2 — a GPU-composited surface, not a
plain CPU CALayer, is what those APIs expect) — bridging this is real,
per-platform engineering (this is exactly what IINA does to get real PiP).

- [ ] Decide if the mini-window substitute is actually a pain point for real
      users before investing here — ADR-0006 flagged it as revisit-if-needed,
      not "must do."
- [ ] If yes: macOS first (AVKit `AVPictureInPictureController` needs a
      `AVPlayerLayer`-compatible content source — investigate `AVSampleBufferDisplayLayer`
      as a bridge target instead of `CALayer.contents`, since mpv's decoded
      frames could in principle be pushed into a sample buffer layer, which
      AVKit's PiP controller *can* attach to).

---

## 4. Render loop is a fixed-rate timer poll, not vsync-locked

**Status:** known ceiling, documented in code. **Size:** medium.

`spawn_render_loop` (commands.rs) ticks at a fixed ~60fps (`sleep(16ms)`) —
not driven by `mpv_render_context_set_update_callback` + a display link, which
is what would actually sync rendering to the display's real refresh rate and
mpv's own "new frame ready" signal. Current approach can drop or repeat frames
relative to true vsync — a real, if usually subtle, judder source, most
noticeable on 24fps/23.976fps film content on a 60Hz display (no 3:2 pulldown
timing) or on ProMotion displays with variable refresh.

- [ ] Wire `mpv_render_context_set_update_callback` to signal a real render
      request (e.g. bump an atomic + `CVDisplayLink` or `CADisplayLink`-driven
      tick) instead of the current fixed sleep loop.
- [ ] Verify against a 23.976fps source specifically — that's where fixed-poll
      judder shows up first and most visibly.

---

## 5. Rendering at point resolution, not full Retina backing resolution

**Status:** known, deliberate tradeoff, documented in code. **Size:** small
per-frame cost model change, but real: currently the only thing keeping the
software renderer at 30fps instead of beachballing.

`engine.rs`'s `render()`: renders at CSS point resolution, not
`convertRectToBacking:`'s actual 2x/3x pixel resolution — quarters (or worse)
the per-frame buffer/CGImage cost on Retina displays. mpv's own comment: "most
streamed video isn't native 4K anyway, so this is rarely a visible loss" — true
for typical 1080p/1440p streams upscaled to a window, less true for anyone
actually playing native 4K content on a Retina display at a large window size,
where this is a genuine, visible softness.

- [ ] Not urgent on its own — tied to #4 and generally to whether the sw
      render path's CPU cost model changes (e.g. if hwdec's now-real
      acceleration, #1 in the optimization audit, frees up enough CPU budget
      to afford full-resolution rendering without regressing frame rate,
      re-measure before deciding).
- [ ] If revisited: needs a real perf measurement (frame render time at full
      backing resolution vs. point resolution, on real 4K content), not a
      blind flip.

---

## Explicitly not on this list (already investigated, correctly closed)

- **Eager subtitle fetch** (`sub-add ... select`) — tested against real mpv
  via JSON IPC; confirmed both `select` and `auto` flags fetch synchronously
  regardless. No fix exists at the `sub-add` flag level; not a real gap.
- **Compressed audio passthrough** (`--audio-spdif` for TrueHD/DTS-HD
  bitstreaming) — mpv's own docs recommend against it; lossless PCM decode
  (which Photon now gets via the `audio-channels` fix) is the better path.
  Only a "want" if a specific AVR's Atmos indicator light matters cosmetically
  — not a playback-quality gap.
