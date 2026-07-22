status: accepted

# GPU render surface for mpv on macOS, CPU path kept as an automatic fallback

ADR-0005 chose mpv's in-process render API over `--wid` window embedding, but
implemented it with mpv's **software** render API (plain CPU pixel buffers)
because the first real attempt at GPU rendering — `MPV_RENDER_API_TYPE_OPENGL`
into an `NSOpenGLView` — painted flat gray: that view class isn't layer-backed,
so it composites through a legacy pre-Core-Animation surface that doesn't
blend with a modern layer-backed (Metal) `WKWebView`, and transparent OpenGL
surfaces have been broken on macOS since 10.11 regardless. The CPU path works
but is, by mpv's own docs, "very slow, because everything runs on the CPU" —
real cost on 4K/HDR-tonemapped content.

libmpv's public render API only ever exposes one GPU backend,
`MPV_RENDER_API_TYPE_OPENGL` — there is no Metal (or Vulkan/D3D) render API
type in libmpv itself, on any platform. "GPU render on mac" therefore means:
mpv renders via OpenGL into an off-screen framebuffer we provide, that
framebuffer's backing texture is bound to an `IOSurface`
(`CGLTexImageIOSurface2D`), and that same `IOSurface` is wrapped as a Metal
texture and presented through a real `CAMetalLayer` — zero-copy handoff from
OpenGL to Metal, landing on a genuinely layer-backed, alpha-composited
surface. The simpler alternative (`CAOpenGLLayer`, which would also have
fixed the transparency bug from ADR-0005's first attempt) was rejected in
favor of this: `CAOpenGLLayer` is itself a deprecated presentation path,
and this design pays the IOSurface/Metal plumbing cost once now instead of
building on another API Apple could pull later.

**Consequences:**

- `cocoa`/`objc` 0.2.x (what `mpv/engine.rs` ran on before this) has no
  Metal or IOSurface bindings at all — only the newer `objc2` crate family
  does (`objc2-metal`, `objc2-io-surface`, and `objc2-app-kit`'s
  `NSOpenGLContext`/`NSOpenGLPixelFormat` for the GL context itself). The
  whole `mpv` module migrates from `cocoa`/`objc` to `objc2` as part of this
  — not just the new GPU code — so the module has one Obj-C interop story,
  not two.
- The actual new GL/CGL surface we call directly is small and permanently
  frozen (OpenGL has been deprecated on macOS since 2018; these signatures
  haven't changed in over a decade) — those handful of functions
  (`glGenFramebuffers`, `glFramebufferTexture2D`, `CGLTexImageIOSurface2D`,
  etc.) are hand-declared `extern "C"` FFI rather than pulling in a GL
  bindings crate (`gl`/`glow`) for ~6 calls out of thousands, matching the
  module's existing precedent of hand-declaring the small FFI surface
  pregenerated bindings miss (see the `MPV_RENDER_PARAM_SW_*` consts).
- The CPU/software path is **not deleted** — it's the automatic runtime
  fallback if GPU surface creation fails (context/FBO/IOSurface setup
  returns an error), logged clearly (`eprintln!`) either way. Correctness
  here can't be fully verified without a live GPU session across real
  hardware, so "GPU-only, no fallback" was rejected as too large a
  reliability regression for a case this hard to test blind.
- Both backends live behind one `RenderSurface` trait
  (`set_rect`/`render`/`teardown`) in a new `mpv/mac/` module. A single
  factory, `mac::attach()`, tries the GPU surface and falls back internally
  — the platform-agnostic `MpvEngine` (mpv lifecycle, command dispatch,
  the `PendingState` queue, tick emission — none of which touch a platform
  API today) never learns which backend is active or that a fallback
  happened. A future Windows/Linux backend (v3; out of scope here, along
  with HDR) plugs in the same way: its own module, its own `attach()`, same
  trait, no shared-code changes.
