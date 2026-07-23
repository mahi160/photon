# MPV Playback: Codec/HDR/Audio Optimization Research

Scope: does Photon's current mpv config play back everything mpv/ffmpeg can
handle, as well as it can be played back? Sourced from mpv's own header/docs
(not blog posts), Jellyfin's server source, and comparable clients
(jellyfin-media-player, IINA).

Reviewed: `src-tauri/src/mpv/engine.rs`, `src/renderer/src/player/deviceProfile.ts`,
mpv's `include/mpv/render.h`, `DOCS/man/options.rst`, Jellyfin's
`VideoRangeType` enum.

---

## Verdict

Codec *coverage* is already excellent (ADR-0008's direct-play-always model,
broad `DeviceProfile` codec list) — that part isn't the gap. The gap is
**decode/render pipeline configuration**: hardware decoding is force-disabled,
HDR has no tone-mapping path at all (confirmed straight from mpv's own
header), and audio channel layout is left on mpv's stereo-biased default.
None of these need the GPU render API Photon deliberately avoided (ADR-0005) —
they're config gaps on top of the existing software render pipeline.

Priority: #1 (hwdec) and #4 (audio channels) are safe, scoped, low-risk fixes.
#2 (HDR) is a real architectural ceiling that needs a test file + a display to
verify against, not a blind config change. #3 (Dolby Vision DeviceProfile) is
safe but its payoff depends on #2.

---

## Findings

### 1. Hardware decoding is force-disabled — biggest performance gap

**Severity: HIGH — performance/battery, easy fix**

`engine.rs`: `set_option(mpv, "hwdec", "no")`, commented "software render API
only ever gets software-decoded frames anyway." That's true for plain
`videotoolbox`, but not for its copy variant — confirmed directly from mpv's
own `DOCS/man/options.rst`:

> `videotoolbox`: requires `--vo=gpu` or `--vo=gpu-next` (macOS only) ...
> `videotoolbox-copy`: **copies video back into system RAM** (macOS 10.15+)

Unlike every non-`-copy` hwdec, `-copy` variants are not listed as requiring
a GPU `vo` — that's the point of the mode: decode on the hardware decoder,
then copy the frame back into a plain CPU buffer, which the software render
API can consume like any other frame. mpv's own top-level guidance: `auto` /
`auto-copy` limits itself to hwdecs "actively supported by the development
team" (safe default), rather than hand-picking `videotoolbox-copy`.

Right now every file (4K HEVC/AV1 HDR included) is fully software-decoded —
high CPU/battery cost, and 4K60 HEVC/AV1 may not even keep up on modest
hardware (mpv's own docs specifically call out "sufficiently complex content
(eg: 4K60 AV1) may require [hw decoding]").

**Fix:** `set_option(mpv, "hwdec", "auto-copy")`. One-line, no render
pipeline change, no license/vendoring implications.

---

### 2. HDR has no tone-mapping path — confirmed architectural gap, not just unconfigured

**Severity: HIGH — correctness, needs real hardware to verify, not a blind fix**

Straight from mpv's `include/mpv/render.h` (not third-party docs):

> `MPV_RENDER_API_TYPE_SW` provides an extremely simple (but slow) renderer...
> **You probably don't want to use this.** Use other render API types...
> In addition, certain multimedia job creation measures like **HDR may not
> work properly, and will have to be manually handled by for example
> inserting filters.**

And the software renderer's `MPV_RENDER_PARAM_SW_FORMAT` only accepts 4 pixel
formats: `rgb0`, `bgr0`, `0bgr`, `0rgb` — **all 8-bit-per-component RGB**. No
10/16-bit output format exists in this API at all (`engine.rs` already uses
`rgb0`/`CGImageAlphaNoneSkipLast`, 8bpc, confirming this in Photon's own
code).

Two separate consequences:
- **Real HDR/EDR display (brighter-than-SDR, wide gamut, e.g. macOS's
  Extended Dynamic Range on XDR/HDR displays) is not reachable through this
  render path at all** — it would require the GPU render API
  (`gpu`/`gpu-next`), which ADR-0003/0005 deliberately ruled out (the
  `NSOpenGLView` transparency bug documented there). This is a real ceiling
  of the current architecture, not a missing flag.
- **Even basic HDR→SDR tone-mapping isn't automatic** in this path per the
  header note above — without an explicitly inserted filter, HDR (PQ/HLG)
  content may render over-bright, blown-out, or with wrong colors on an
  ordinary SDR display today. This part *might* be fixable without the GPU
  render API (e.g. `--vf=zscale`/an explicit tone-map filter running on the
  CPU before the sw output stage), but I can't respond to a config I can't
  verify — this needs a real HDR test file against a real display.

**Recommendation:** don't guess a filter chain blind. Get one real HDR10/HLG
test file, watch it in Photon vs. `mpv` CLI directly (`--vo=gpu-next`, known
good) side by side, and only then decide whether a CPU tone-map filter closes
the gap or whether this needs its own ADR (e.g. revisiting the GPU render API
now that mpv's HDR/EDR support has moved since ADR-0005 was written — mpv PR
#14017 is actively adding EDR color-space transforms to its native macOS
Cocoa backend, separate from the render-API embedding Photon uses).

---

### 3. `DeviceProfile` doesn't declare any Dolby Vision variant

**Severity: MEDIUM — unnecessary transcodes, payoff depends on #2**

Jellyfin's `VideoRangeType` enum (`Jellyfin.Data/Enums/VideoRangeType.cs`)
has 13 values: `Unknown, SDR, HDR10, HLG, DOVI, DOVIWithHDR10, DOVIWithHLG,
DOVIWithSDR, DOVIWithEL, DOVIWithHDR10Plus, DOVIWithELHDR10Plus, DOVIInvalid,
HDR10Plus`. `deviceProfile.ts`'s `hdrRanges` only claims
`'SDR|HDR10|HDR10Plus|HLG'` — every DOVI* variant is undeclared, so the
server's `GetVideoDirectPlayProfile` rejects direct play for *any* Dolby
Vision file and transcodes it, even though ffmpeg (mpv's decoder backend)
does decode Dolby Vision streams (at minimum via the HDR10-compatible base
layer/RPU-agnostic path for profiles 5/8). This is the exact same class of
bug Jellyfin's own issue tracker documents for other clients
(jellyfin/jellyfin#16687: Android TV/webOS not declaring
`DOVIWithHDR10Plus`, forcing pointless SDR transcodes).

**Fix:** extend `hdrRanges` to include the DOVI variants (excluding
`Unknown`/`DOVIInvalid`). Low-risk on its own — but per finding #2, whatever
gets direct-played still renders through the same 8-bit sw pipeline, so this
should land together with (or after) resolving #2, not as a standalone "now
it looks great" fix.

---

### 4. Audio channel layout unconfigured — may be silently downmixing surround to stereo

**Severity: MEDIUM — likely current correctness bug, easy fix**

mpv's default, `--audio-channels=auto-safe`:

> Use the system's preferred channel layout. **If there is none... force
> stereo.** ... This is the default.

And its own HDMI warning: "Using `auto` can cause issues... You are
recommended to set an explicit whitelist of the layouts you want... e.g.
`--audio-channels=7.1,5.1,stereo`."

`engine.rs` never sets `audio-channels` — Photon runs on mpv's default,
which forces stereo unless macOS specifically reports a system-preferred
multichannel layout for the current output device (not guaranteed even when
routed to an AVR/soundbar over HDMI). This means genuine 5.1/7.1/Atmos-bed
sources may be getting silently downmixed to stereo today, with no way for
the user to tell mpv otherwise (no exposed setting).

Separately: mpv's own docs recommend *against* `--audio-spdif` (compressed
bitstream passthrough) — "not much reason to use this, HDMI supports
uncompressed multichannel PCM, and mpv supports lossless DTS-HD decoding."
Decoding TrueHD/DTS-HD:MA to full-channel PCM (rather than bitstreaming it)
is mpv's own recommended path and needs no special config beyond correct
channel layout — so this is *not* a gap worth chasing (some AVRs only light
up their "Dolby Atmos" logo on a bitstream, which is a cosmetic want, not a
playback-quality one).

**Fix:** set `audio-channels` to an explicit whitelist (e.g.
`7.1,5.1,stereo`) instead of leaving mpv's stereo-biased default active.
Pair with `audio-normalize-downmix=yes` (off by default; prevents clipping
on whatever downmix path still occurs, e.g. a stereo-only output device).

---

## What's already solid

- Direct-play-always + broad ffmpeg-backed codec list (ADR-0008) — no
  needless client-manufactured transcodes for codec/track-selection reasons.
- Embedded-font loading for ASS/SSA subtitles: mpv's `--embeddedfonts`
  defaults to `yes` — no action needed.
- Subtitle appearance defaults (outline, no box, legible size) are sane and
  already tuned (issue #9).
- Deinterlacing left off by default matches mpv's own recommendation (`auto`
  has false positives on non-interlaced files flagged as interlaced) — not a
  gap, leave as-is.
- Compressed audio passthrough (`--audio-spdif`) is correctly *not*
  implemented — mpv's own docs recommend against it; PCM decode is the
  better path and Photon already gets that path for free once #4 is fixed.

---

## Recommended next steps, in order

1. `hwdec = "auto-copy"` — safe, one line, do it now.
2. `audio-channels = "7.1,5.1,stereo"` + `audio-normalize-downmix = "yes"` —
   safe, one line, do it now.
3. Extend `DeviceProfile`'s HDR range declaration to the DOVI* variants —
   safe, do it now, but manage expectations (see #2).
4. HDR tone-mapping — get a real HDR test file, compare against `mpv` CLI
   directly, decide whether a CPU-side tone-map filter closes the gap or this
   needs a new ADR revisiting GPU render API options.
