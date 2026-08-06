status: accepted

# GTK-composited video surface for mpv on Linux (GtkGLArea under the webview)

ADR-0009 gave each desktop platform a `RenderSurface`. Linux's first two
implementations both embedded a **native surface directly**: `x11.rs` created a
child X11 window under the webview, `wayland.rs` a `wl_subsurface`. Both are the
wrong model, and both failed in the field:

- **X11 child window** — WebKitGTK is a *windowless* GTK widget: it paints the
  whole web UI into the top-level window itself (confirmed by dumping the X11
  tree — the Photon top-level has no content child window, only a 1×1 input
  stub). An X11 child window always paints *above* its parent's own drawing, and
  `XLowerWindow` only reorders relative to *sibling* windows, of which there are
  none. So the opaque video window buries the playback controls.
- **Wayland subsurface** — `get_subsurface(child, parent)` requires child and
  parent to belong to the **same `wl_client`**. `wayland.rs` opened a *second*
  `wl_display` connection (`from_foreign_display`) and tried to parent onto
  GTK's surface from that separate client — a protocol violation. The video
  escaped into its own top-level window.

The primary sources are unambiguous that direct native-surface embedding is a
dead end:

- WebKitGTK maintainer (Igalia, 2023): accelerated compositing was
  *deliberately* rewritten away from "hand the widget's X window to the web
  process" precisely because it "broke the GTK rendering model so it was not
  possible to use a web view inside a `GtkOverlay`". Modern WebKitGTK (2.41+,
  DMABUF renderer) hands the rendered buffer to the UI process as a **GTK
  texture / Cairo surface painted into the widget** — i.e. it composites through
  GTK like any other widget, and *is* `GtkOverlay`-friendly.
- GStreamer maintainer (2024, on this exact Tauri question): embedding an
  arbitrary native surface "completely steps around the toolkit and by that
  introduces a lot of problems." The supported path is to **render the video
  into a GTK widget** the toolkit composites (`gtksink`/`gtkglsink`). GTK4
  removed all API to embed foreign Wayland surfaces for the same reason.

## Decision

Render mpv into a **`GtkGLArea` placed *under* the transparent WebKitWebView**,
and let GTK do the compositing. One code path serves X11, Wayland, and XWayland
— GTK abstracts the display server, so no `GDK_BACKEND` pinning. This mirrors
mac (mpv's IOSurface composited under the `WKWebView`) and Windows (mpv child
HWND is a real sibling of the WebView2 child HWND).

mpv's render API already supports this: `mpv_render_context_render()` renders
into **any** OpenGL FBO, not just the default framebuffer (`render_gl.h`).
`GtkGLArea` owns an FBO; in its `render` signal that FBO is bound, and we point
mpv at it.

Widget tree after setup:

```
gtk::Window (Tauri top-level, transparent)
└─ vbox (Tauri's default container)
   └─ gtk::Overlay
      ├─ main child (bottom): gtk::Fixed
      │     └─ gtk::GLArea   ← mpv renders into its FBO; moved/resized to the video rect
      └─ overlay child (top): WebKitWebView (transparent) ← controls composite above video
```

Where the page is transparent, the GLArea shows through; opaque controls paint
on top. `set_rect` moves/resizes the GLArea within the `Fixed`.

## Consequences

- **Deleted:** `mpv/linux/x11.rs`, `mpv/linux/wayland.rs`, and the
  `GDK_BACKEND=x11` startup pin. `mpv/gl_surface.rs` becomes Windows-only.
- **Threading changes.** GTK is main-thread-only. mpv can no longer render on
  the background render-loop thread on Linux; it renders inside the GLArea
  `render` signal on the GTK main thread, the same way `gtkglsink` works. The
  existing `RenderWaker`/`spawn_render_loop` is reused: the loop's
  `surface.render()` call, on Linux, just *posts* a repaint request to the main
  thread (`gl_area.queue_render()`), it does not touch GL itself.
- **hwdec is direct on Linux too** (amended — the original text here claimed
  otherwise and was wrong). `MPV_RENDER_PARAM_X11_DISPLAY`/`WL_DISPLAY` are
  exactly what mpv needs for zero-copy interop (`render_gl.h`: "Intel/Linux: EGL
  is required, and also the native display resource needs to be provided"), and
  they are reachable: Tauri already hands us a `RawDisplayHandle` carrying the
  `wl_display`/`Display*`, and Celluloid passes the same two params from GDK. So
  the render context gets the native display and hwdec is set post-init to an
  explicit `vaapi,nvdec,vaapi-copy,nvdec-copy,no` list. Not `auto`/`auto-safe`:
  on libmpv 2.5 both probe vulkan and cuda on every load, which on a plain Mesa
  box logs `VK_KHR_video_decode_queue` failures, `Cannot load libcuda.so.1` and
  decode errors while falling back. Staying on `auto-copy` cost a full
  GPU→RAM→GPU round trip per frame (~300 MB/s of VRAM readback for 4K HEVC
  10-bit) on exactly the iGPU hardware that can least afford it.

- **Rendering must not block the GTK main thread.**
  `mpv_render_context_render()` blocks until the frame's target display time by
  default (up to `video-timing-offset`, 50 ms). That is fine on mac/Windows,
  where it runs on a dedicated render thread, but here it would stall the
  webview's compositing and input handling. So: `BLOCK_FOR_TARGET_TIME = 0` per
  render, plus `video-timing-offset=0` on Linux so mpv doesn't render ahead in
  the first place (`render.h` names that as the way to keep A/V sync without
  blocking).

- **Frames are reported back.** `mpv_render_context_report_swap()` on the frame
  clock's `after-paint`, gated on "we actually drew this cycle" (`render.h`:
  reporting inconsistently is worse than not reporting). `ADVANCED_CONTROL` is
  deliberately *not* enabled: it promises libmpv the render thread never waits
  for the core, and on Linux that thread is the GTK main thread, which runs
  arbitrary app/webview work — breaking that promise turns non-fatal timeouts
  into a permanent core freeze.

- **When GTK isn't painting, frames are drained.** A hidden/minimised/occluded
  GLArea never emits `render`, and mpv then degrades
  ("mpv_render_context_render() not being called or stuck"). If no paint has
  happened for 250 ms, one frame is consumed with `SKIP_RENDERING` instead. Any
  mpv GL call made outside the `render` signal needs `make_current()` *and*
  `attach_buffers()` — without the latter mpv operates on an incomplete
  framebuffer and logs `OpenGL error INVALID_FRAMEBUFFER_OPERATION` (observed).

- **GL entry points come from the display server's resolver**
  (`eglGetProcAddress` on Wayland, `glXGetProcAddressARB` on X11), dlopen'd at
  runtime, with a plain-`dlsym` fallback. Not libepoxy: its `epoxy_gl*` dispatch
  pointers are never NULL (verified — even `epoxy_glDrawMeshTasksNV` on a
  non-NVIDIA GPU), and libmpv relies on NULL to detect a missing function, while
  calling into an unsupported one hits epoxy's resolver-failure handler, which
  `abort()`s the process. `build.rs` no longer probes/links epoxy (nothing
  referenced an epoxy symbol at link time anyway, so `--as-needed` had already
  dropped it from the binary).
- **New Linux-only deps:** `gtk` 0.18, `gdk` 0.18, `glib` 0.18 (versions matched
  to what Tauri already pulls) and `dbus` 0.9 (screensaver inhibit, see
  `src/idle.rs` — WebKitGTK has no Screen Wake Lock API, so the renderer's hook
  can't keep Linux screens awake). `webkit2gtk` type comes from Tauri's
  `with_webview`.

- **Geometry is translated, not assumed.** The renderer sends the video rect in
  CSS px (origin = web content top-left); a GTK allocation is in the toplevel
  *widget's* space, which on a client-side-decorated window starts inside the
  shadow/headerbar — measured on GTK 3.24: a 1280×753 client area sits at
  (26, 70) in the toplevel window. The rect is therefore translated through the
  container's own allocation (`PHOTON_DEBUG_RECT=1` prints both), and kept in CSS
  space so it's re-translated on every relayout.

- **The GLArea is positioned by `size_allocate`, never `set_size_request`.** A
  size request is a *minimum* in GTK3 and propagates Fixed → Overlay → Window →
  geometry hints: requesting the video's size made the toplevel un-shrinkable
  during playback (measured: a 1600×900 rect pushed the window minimum to
  1652×989, i.e. larger than the window). The request stays 1×1 forever and the
  allocation is re-applied from the `Fixed`'s own `size-allocate`, since GTK
  re-allocates children to their request on every relayout.
- **GTK4 risk.** Tauri uses GTK3/webkit2gtk today. If it migrates to GTK4, the
  overlay approach still holds (GtkGLArea exists in GTK4), but the reparent and
  transparency plumbing would need revisiting.
- **The reparent is the make-or-break step.** Pulling the live WebKitWebView out
  of Tauri's vbox and into our `GtkOverlay` must not disturb its accelerated
  compositing. Verified by smoke test on real hardware.

## Implementation guide (step by step)

Everything below is Linux-only (`#[cfg(target_os = "linux")]`).

1. **`Cargo.toml`** — add a `[target.'cfg(target_os = "linux")'.dependencies]`
   block: `gtk = "0.18"`, `gdk = "0.18"`, `glib = "0.18"`.

2. **`build.rs`** — for Linux, emit `cargo:rustc-link-lib=epoxy` (probe with
   `pkg_config::probe_library("epoxy")`).

3. **`mpv/linux/mod.rs`** — replace entirely. It now holds:
   - A process-global `static SENDER: OnceLock<Mutex<Option<glib::Sender<Msg>>>>`
     — the only thing that crosses threads. `Msg` is an enum, all variants
     `Send`: `SetMpv { mpv: usize, waker: Arc<RenderWaker> }`, `Render`,
     `Rect { x, y, w, h: f64 }`, `Teardown { reply: std::sync::mpsc::Sender<()> }`.
   - `pub fn setup(webview: &webkit2gtk::WebView)` — runs on the GTK main
     thread. Builds Overlay/Fixed/GLArea, reparents the webview, connects the
     `render` signal (creates the mpv render context lazily on first paint, then
     renders into the bound FBO), and attaches the `Msg` receiver on the default
     main context. Stores the `Sender` in `SENDER`.
   - `pub(crate) fn attach(mpv, _handle, _display, waker)` — the `RenderSurface`
     seam kept identical to mac/windows. Reads `SENDER`, sends
     `SetMpv { mpv, waker }`, returns `(Box::new(GtkSurface{..}), Backend::Gpu)`.
   - `struct GtkSurface { tx: glib::Sender<Msg>, size: Mutex<(i32,i32)> }`
     implementing `RenderSurface`: `render` → `tx.send(Render)`; `set_rect` →
     `tx.send(Rect{..})`; `teardown` → `tx.send(Teardown{reply})` then block on
     the reply (frees the render context on the main thread before
     `mpv_terminate_destroy`).

4. **`mpv/mod.rs`** — `gl_surface` becomes `#[cfg(target_os = "windows")]`; drop
   `linux` from that cfg.

5. **`lib.rs`** — delete the `GDK_BACKEND` block. In `setup`, after the window
   exists, call `window.with_webview(|w| linux::setup(w.inner()))` on Linux
   (the closure runs on the GTK main thread; the `Sender` is created
   synchronously first so messages buffer until the receiver attaches).

6. **`engine.rs`** — gate the post-init `hwdec=auto` override to
   `cfg!(target_os = "windows")` instead of `!cfg!(target_os = "macos")`.

## Linux smoke-test checklist

`cargo build` proves nothing about this file. Before trusting a Linux release,
on a real session (repeat on Wayland *and* `GDK_BACKEND=x11`):

1. App starts, UI renders after the reparent, no `mpv:` lines on stderr.
2. Video appears, aligned with the UI (`PHOTON_DEBUG_RECT=1` if not), controls
   and menus composite *above* it.
3. `mpv: hwdec-current=` shows `vaapi`/`nvdec` (not `no`, not `*-copy`) on
   hardware that has it; 4K HEVC plays without dropped frames.
4. Resize the window *smaller* during playback (the min-size regression), then
   maximise, fullscreen, un-fullscreen.
5. Minimise during playback, wait 10s, restore: audio keeps time, video resumes,
   no "render not being called or stuck" in the log.
6. Leave the player page and come back; quit while playing (no hang on exit).
7. Screen doesn't blank during a long unattended play (screensaver inhibit).
8. `dpkg -i` the built `.deb` on a machine *without* `libmpv-dev`: it must pull
   `libmpv2` and start.
