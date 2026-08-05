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
- **hwdec stays `auto-copy` on Linux.** Direct (zero-copy) hwdec interop through
  a GtkGLArea context would need `MPV_RENDER_PARAM_X11_DISPLAY`/`WL_DISPLAY`
  passed at render-context creation, which GtkGLArea does not expose cleanly;
  the post-init `hwdec=auto` override (ADR-0009's Windows win) is gated to
  Windows only. `auto-copy` always works.
- **New Linux-only deps:** `gtk` 0.18, `gdk` 0.18, `glib` 0.18 (versions matched
  to what Tauri already pulls), plus a `cargo:rustc-link-lib=epoxy` line — GTK
  ships libepoxy, whose `epoxy_get_proc_address` resolves GL entry points for
  both mpv and our FBO query. `webkit2gtk` type comes from Tauri's
  `with_webview`.
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

7. **Verify:** `cargo build`; run; confirm the app stays up and the UI still
   renders after the reparent; then smoke-test playback (controls visible over
   video, seek/resize/fullscreen) on both a Wayland session and an XWayland
   (`GDK_BACKEND=x11`) session.
