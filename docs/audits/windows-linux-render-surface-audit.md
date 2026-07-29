# Windows/Linux Render Surface — Code Quality Audit

> **Status: all 5 findings addressed** in a follow-up pass. #1/#3/#4/#5 fixed
> in code (`mpv/gl_surface.rs` extracted, `CS_OWNDC` added,
> `XSetErrorHandler` installed, shared `GlRenderSurface` unit tests added);
> #2's stale docs corrected in `mpv/{mod,commands,profile}.rs`. Verified via
> `cargo check`/`cargo test` on the macOS host (all 14 tests pass, including
> 4 new ones) — the Windows/Linux-specific FFI bodies themselves could not
> be compiled or run on this machine (no cross toolchain / Windows or Linux
> box available); reviewed carefully by hand instead, and the shared logic
> they now both depend on (`GlRenderSurface`) is compiled and tested. See
> each finding below for what changed.

Scope: full codebase pass, with a deep focus on Windows and Linux playback per
the request that prompted this ("mac works fine, windows/linux don't"). Full
`mpv/` module reviewed; rest of the codebase (frontend player, PiP, pages,
hooks) skimmed for boundary/duplication issues but not line-by-line.

Files reviewed in depth:

- `src-tauri/src/mpv/windows/mod.rs` (301 lines)
- `src-tauri/src/mpv/linux/mod.rs` (375 lines)
- `src-tauri/src/mpv/mac/{mod,gpu,software}.rs` (for comparison)
- `src-tauri/src/mpv/{mod,surface,engine,commands,profile}.rs`
- `src-tauri/src/pip.rs`, `src/renderer/src/player/mpv.ts`

No file in the repo exceeds 1,000 lines (`engine.rs` is largest at 845, already
well-decomposed into free functions + `PendingState` + observer thread — a
watch item, not a blocker).

---

## Verdict

The Windows and Linux backends are **not stubs** — both are real WGL/GLX
render surfaces (PR #37), correctly handling the one genuinely hard bug in
this class of code (a GL context can only be current on one thread at a
time, and the code must release it after every use or the *other* thread's
next `wglMakeCurrent`/`glXMakeCurrent` silently fails). That part is right.

The real problem is structural, not functional: **these two backends are the
same ~150-line implementation, copy-pasted and re-skinned**, plus one
Windows-specific correctness gap that plausibly explains real-world "Windows
playback misbehaves" reports, plus a load-bearing module comment that flatly
lies about both backends' existence. Fix the duplication once and the
Windows-only bug becomes a one-line fix instead of a "hope someone remembers
to also check Linux" fix.

Priority order: #2 (stale doc actively misdirects debugging) is the cheapest,
highest-value fix. #1 (duplication) is the structural finding worth doing
before either backend gets touched again. #3 (`CS_OWNDC`) is the one with a
plausible direct line to real Windows bug reports.

---

## Findings

### 1. `windows/mod.rs` and `linux/mod.rs` are one implementation, copy-pasted twice

**Severity: HIGH — structural / missed code-judo restructuring**

Line up the two files and the only real difference is the windowing/GL API
(Win32+WGL vs Xlib+GLX). Everything else — including multi-paragraph doc
comments — is duplicated near-verbatim:

- Struct shape: `{ window-handle, gl-context-handle, render_ctx, size: Mutex<(i32,i32)> }`.
- `set_rect`: hide-if-zero-size, else reposition the child window, update
  `size`, call `render()`. Identical control flow, only the Win32
  (`SetWindowPos`/`ShowWindow`) vs X11 (`XMoveResizeWindow`/`XUnmapWindow`)
  calls differ.
- `render`: make-current → build `mpv_render_param` array with
  `MPV_RENDER_PARAM_OPENGL_FBO` (`fbo: 0`) + `MPV_RENDER_PARAM_FLIP_Y = 1` →
  `mpv_render_context_render` → swap-buffers-if-ok → **release current**
  (unconditionally, even on the "no frame ready" path). Same six steps, same
  comment explaining why release-after-use matters, word for word in spirit:

  > *"A WGL context can only ever be current on one thread at a time... the
  > next `wglMakeCurrent` from the other thread fails outright... reliably a
  > hard crash on Windows"* (windows/mod.rs)

  > *"A GLX context can only ever be current on one thread at a time (same
  > rule WGL has)... Releasing after use is what lets the next thread pick
  > it up cleanly instead of silently rendering into no current context —
  > confirmed on Windows as a hard crash for the identical bug"* (linux/mod.rs)

  This bug was clearly found once, on Windows, and had to be independently
  re-derived/re-applied on Linux. That is exactly the failure mode duplicated
  logic invites: the fix lives in two places, and nothing enforces that a
  third backend (or a future change to either) keeps both in sync.
- `teardown`: unregister callback → free render context → release current →
  destroy GL context → destroy window. Same order, same rationale, in both.
- Even the FLIP_Y rationale comment (mpv's `render.h`: needed for `fbo=0`,
  i.e. the default framebuffer) is duplicated verbatim across both files.

**This is the single clearest code-judo opportunity in the whole module.**
Pull the shared 90% into one generic implementation, e.g. in
`mpv/surface.rs` (or a new `mpv/gl_surface.rs`):

```rust
/// Everything a "render OpenGL straight onto a default-framebuffer desktop
/// window" backend needs from its platform: create/destroy, make one GL
/// context current on *this* thread / release it, and present a frame.
/// WGL (Windows) and GLX (Linux) both implement this; both get the shared
/// render()/set_rect()/teardown() logic (the FLIP_Y/fbo=0 render_param
/// setup and the release-after-every-use dance) for free and identically.
trait DesktopGl: Send {
    fn make_current(&self) -> bool;
    fn release_current(&self);
    fn swap_buffers(&self);
    fn reposition_or_hide(&self, x: f64, y: f64, w: f64, h: f64) -> (i32, i32);
    fn destroy(&mut self);
}

struct GlRenderSurface<P: DesktopGl> {
    platform: P,
    render_ctx: *mut mpv_render_context,
    size: Mutex<(i32, i32)>,
}
// one RenderSurface impl, used by both windows::attach and linux::attach
```

Each platform module then shrinks to: window/GL-context creation,
`get_proc_address`, and the five `DesktopGl` methods — roughly 100-120 lines
each instead of 300-375, and the release-after-use / FLIP_Y logic exists
exactly once. A future bug fix (or a third GL-based backend, e.g. EGL for
the Wayland follow-up already tracked in issue #27) inherits it automatically
instead of needing a third copy-paste.

---

### 2. `mpv/mod.rs`'s module doc actively lies about Windows/Linux

**Severity: HIGH — stale documentation actively misdirects debugging**

```rust
// ... Only `mac` has a real GPU/CPU render surface today; `windows`/`linux`
// are stubs that compile and link but always return a "not implemented"
// error from `attach()` -- see their own module docs.
#[cfg(target_os = "macos")]
pub(crate) mod mac;
```

This has been false since PR #37 (`feat(mpv): real GLX (Linux/X11) and WGL
(Windows) render surfaces`). A later commit (`3c22a05`, "docs: mpv/windows and
mpv/linux are real render surfaces, not stubs") fixed the *same claim* in
`AGENTS.md` but never touched this comment — the one place `engine.rs`'s own
module doc points a reader to for backend context. Anyone debugging a
Windows/Linux playback report by reading the code (rather than running it)
starts from "these are stubs that don't work at all," which is exactly
backwards from the real, more specific bugs below. One-paragraph fix:

```rust
// `backend` aliases whichever platform module is compiled in -- `engine.rs`
// only ever calls `backend::attach`, never `mac`/`windows`/`linux` directly.
// All three are real GPU (GL) render surfaces: `mac` is OpenGL->IOSurface->
// Metal (CPU software fallback if GPU setup fails), `windows`/`linux` are
// WGL/GLX onto a plain child window (no CPU fallback -- see their own docs).
```

Related, lower-severity drift in the same vein:

- `commands.rs`'s `spawn_render_loop` doc is written entirely in
  AppKit/`CALayer` terms ("this is the standard technique real custom
  video-compositing code uses"), even though this exact function also drives
  the Windows/WGL and Linux/GLX render loops, where the real off-main-thread
  constraint is the GL-context-affinity rule documented separately in each
  backend, not CATransaction flushing.
- `profile.rs`'s doc calls itself "backend-agnostic on purpose: wraps the one
  call site both the GPU and software (`mac/software.rs`) surfaces go
  through" — also mac-only phrasing for a profiler that equally wraps the
  Windows/Linux `render()` calls today.

Neither is wrong, both are incomplete in a way that reinforces "this code
only really thinks about mac."

---

### 3. Windows: cached `HDC` from a window class without `CS_OWNDC`

**Severity: MEDIUM — plausible real bug, Windows-only**

`WglSurface::new` registers the render window's class with:

```rust
let class = WNDCLASSEXW { style: CS_HREDRAW | CS_VREDRAW, ... };
```

No `CS_OWNDC`. It then calls `GetDC(hwnd)` **once** in `new()` and holds that
`HDC` in `self.hdc` for the object's entire lifetime (used every `render()`
tick), only releasing it in `teardown()`.

Per Win32's own device-context model, a window class without `CS_OWNDC` gets
a **common** DC — pulled from a small per-thread cache (5 handles) that is
expected to be requested and released quickly, and whose non-default
attributes (crucially, the pixel format set once via `SetPixelFormat`) are
not guaranteed to survive being recycled for another window on the same
thread in between. This is exactly why essentially every WGL/OpenGL Win32
sample registers `CS_OWNDC` when it intends to cache a DC across calls the
way this code does. A WebView2-hosted app thread making its own unrelated
`GetDC`/`ReleaseDC` calls elsewhere is a realistic way to exhaust or recycle
that shared cache.

This is a plausible, intermittent explanation for exactly the class of report
that prompted this audit ("windows playback has issues," no clean repro).
It's also a one-flag fix with zero structural cost:

```rust
style: CS_HREDRAW | CS_VREDRAW | CS_OWNDC,
```

Worth doing regardless of finding #1's refactor, and trivial to fold into it
(the shared `GlRenderSurface`'s Windows-side `DesktopGl` impl is exactly where
this class registration would live).

---

### 4. Linux: no `XSetErrorHandler`, so any X protocol error kills the whole process

**Severity: LOW-MEDIUM — robustness gap, undocumented (looks like an oversight, not a decision)**

Xlib's *default* error handler calls `exit()` on any unhandled X protocol
error (`BadWindow`, `BadDrawable`, etc.) on the calling thread. `linux/mod.rs`
never installs its own handler. Every other sharp edge in this file — the
context-affinity bug, the z-order default, the FLIP_Y requirement — has a
paragraph explaining why it's safe or a deliberate tradeoff; this one has no
comment either way, which (given how thorough this file otherwise is) reads
like it was missed rather than accepted.

Given this connection is used purely for a single embedded video window
(not a general toolkit surface), a non-fatal handler — log and return 0,
same pattern real native X11 video-embedding code uses — removes "one
X protocol hiccup during resize/teardown takes down all of Photon" as a
failure mode. If this was in fact already considered and accepted as
out-of-scope, it should get the same explicit `ponytail:`-style note the rest
of this file uses for deliberate tradeoffs, so it doesn't read as an
oversight to the next person here.

---

### 5. Asymmetric test coverage between the "twin" backends

**Severity: LOW — falls out of finding #1**

`linux/mod.rs` has a genuinely good `#[ignore]`d real-X11/GLX smoke test
(renders mpv's `lavfi` test pattern into a real window, reads pixels back,
confirms a non-uniform frame). `windows/mod.rs` has none. If findings #1 is
done, one shared test against `GlRenderSurface<P>` (parameterized or run
twice against each platform's `DesktopGl` impl) covers both instead of only
the one someone happened to write first.

---

## What's solid

- The one genuinely hard bug in this class of code — GL context can only be
  current on one thread at a time, both `set_rect` (main thread) and the
  render loop (background thread) touch it, so it must be released after
  every use — is correctly identified and correctly fixed on **both**
  platforms. This is real, non-obvious systems knowledge, present and
  applied twice.
- `RenderSurface`/`Backend`/`try_or_fallback` (`surface.rs`) is exactly the
  right seam: `engine.rs` never learns which of the three platforms — or
  GPU-vs-CPU on mac — is active. Adding the proposed `GlRenderSurface`
  abstraction slots in *underneath* this seam, not instead of it; nothing
  about `engine.rs`, `commands.rs`, or the frontend needs to change.
- Z-order handling (`HWND_BOTTOM` / `XLowerWindow`, keeping the opaque video
  window under the transparent WebView) is correctly reasoned per-platform
  and clearly documented — this is real platform-specific complexity that
  *should* live in the platform modules, not something to unify away.
- `pip.rs` (System-mpv PiP, cross-platform) is honest about what's untested
  (Windows named-pipe IPC has "no Windows box to test against") rather than
  quietly assuming parity — good practice to keep as Windows/Linux
  playback gets more attention.
- No file in the repo is within striking distance of the 1,000-line
  threshold; `engine.rs` (845 lines, largest in the module) is already
  organized as free functions + a small `PendingState` queue + an observer
  thread, not a monolith.
