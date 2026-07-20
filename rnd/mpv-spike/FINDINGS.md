# Spike findings — composited mpv render surface in Tauri (macOS/arm64)

Ticket: #4. Throwaway app in this folder, not part of Photon's real source tree.

## Result: works, with rough edges noted below

- libmpv linked in-process (`libmpv-sys`, pkg-config against Homebrew's
  `mpv` dev headers/libs), driven via the render API (`mpv_render_context`,
  `MPV_RENDER_API_TYPE_OPENGL`) — no spawned mpv process, no `--wid`.
- mpv's OpenGL output renders into an `NSOpenGLView` inserted as the
  bottom-most subview of the window's content view, *below* Tauri's WKWebView
  (`transparent: true` + `macOSPrivateApi: true` + transparent CSS body).
  HTML overlay (a translucent control bar) draws correctly on top with no
  black box and no z-order glitches.
- Local file playback confirmed via automated round-trip: invoking commands
  from the HTML overlay (`mpv_toggle_pause`, `mpv_seek`) changes mpv's real
  `time-pos`/`pause` properties (verified by reading them back after each
  command — see log excerpt below), and play/seek/pause all work.
- Resize and window move both survive without crashing, tearing, or a stale
  frame reappearing (`NSOpenGLView` has `NSViewWidthSizable|HeightSizable`
  autoresize + `openGLContext.update()` on `WindowEvent::Resized`).
- mpv's own OSC/OSD disabled (`osc=no`, `osd-level=0`) — no native mpv UI
  visible; the HTML bar is the only chrome.

```
[mpv-spike] mpv_toggle_pause invoked
[mpv-spike] after toggle_pause: time-pos=29.97 paused=false
[mpv-spike] after seek: time-pos=30.00 paused=true
```

## Rough edges / things ticket #3 should account for

1. **Two real bugs found and fixed, worth flagging as easy footguns for the
   real implementation:**
   - `NSWindowOrderingMode` for `addSubview:positioned:relativeTo:` is a
     *signed* `NSInteger` (`NSWindowBelow = -1`), not an arbitrary `u64` —
     passing the wrong width/sign trips an AppKit assertion and hard-aborts
     the process with no useful message in the app's own log (only visible
     via `~/Library/Logs/DiagnosticReports/*.ips` or `log show`).
   - `MPV_RENDER_API_TYPE_OPENGL` (and friends) from `libmpv-sys` are
     **already NUL-terminated** byte constants — passing them through
     `CString::new()` panics (`NulError`, interior NUL). Use `.as_ptr()`
     directly.
2. **No fullscreen toggle exercised.** The spike's acceptance criteria list
   fullscreen, but scripting real fullscreen transitions without Screen
   Recording permission (see below) wasn't practical here — resize/move were
   exercised instead. Ticket #3 should explicitly re-check the fullscreen
   transition path (`NSView.setFrame` inside `windowWillEnterFullScreen`/
   `didEnterFullScreen`) since fullscreen swaps the content view's superview
   chain on macOS and could detach the GL subview if not re-parented.
3. **This dev machine has no Screen Recording permission available to grant
   non-interactively**, so the actual alpha-blended pixel output was *not*
   visually confirmed by a human/screenshot in this pass — only inferred from
   (a) no AppKit assertion/crash on subview insertion + rendering, and (b) the
   surface occupying the expected bounds with `convertRectToBacking` returning
   sane values every render tick. **A human should eyeball the real window
   once** before treating the compositing technique as fully proven.
4. **Render loop is a fixed 16ms timer polling `run_on_main_thread`**, not
   driven by `mpv_render_context_set_update_callback` + a display link —
   fine for a spike, wasteful/potentially tear-prone at scale. Ticket #3
   should wire the real update-callback + `CVDisplayLink` pairing.
5. **License**: this spike links whatever Homebrew's `mpv` pkg-config
   resolves to (GPL build, dynamically linked, never distributed) — fine for
   a local, non-distributed spike, *not* fine for ticket #3, which must vendor
   the `--enable-lgpl` build per ADR-0004.
6. Keyboard events sent via `System Events` synthetic keystrokes to the
   WKWebView were flaky in automated testing (some arrow-key presses didn't
   reach the JS `keydown` listener), while AX-driven mouse clicks and direct
   `invoke()` round-trips were reliable. Likely an artifact of synthetic
   event injection + WebContent process focus, not an engine bug — but worth
   a manual keyboard check too.

## Not done here (per ticket's own "out of scope")

- Windows/Linux — spike targeted macOS/arm64 only, as specified.
- Fullscreen toggle automation (see rough edge #2).

## Verdict

The core technical risk — compositing libmpv's render-API output under a
transparent region of a Tauri webview, in one window, with no separate mpv
window — **works** on macOS/arm64. Proceed to ticket #5 (Tauri shell scaffold)
with rough edges #2 and #4 carried forward as known work for ticket #3.
