import { invoke } from '@tauri-apps/api/core'
import { useEffect } from 'react'

// Keeps the screen on while playing.
//
// Screen Wake Lock API where it exists (WKWebView/Safari 16.4+, WebView2) -- but WebKitGTK does *not*
// implement it (`'wakeLock' in navigator` is false on 2.52.3), so Linux fell through to nothing and
// screens blanked mid-film. There, `app_set_idle_inhibited` holds org.freedesktop.ScreenSaver.Inhibit
// in Rust (src-tauri/src/idle.rs); it's a no-op on the other platforms, so the fallback only runs when
// the web API is missing.
// Re-acquires on visibility change: the web API force-releases whenever the document hides
// (minimize/Spaces-switch), which desktop hits often.
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return

    if (!('wakeLock' in navigator)) {
      void invoke('app_set_idle_inhibited', { inhibited: true }).catch((e) =>
        console.warn('[playback] could not inhibit the screensaver', e)
      )
      return () => {
        void invoke('app_set_idle_inhibited', { inhibited: false }).catch(() => {})
      }
    }

    let sentinel: WakeLockSentinel | undefined
    let cancelled = false

    const acquire = (): void => {
      void navigator.wakeLock
        .request('screen')
        .then((s) => {
          if (cancelled) {
            void s.release()
            return
          }
          sentinel = s
        })
        .catch(() => {
          // e.g. low battery / policy denial -- play without lock
        })
    }
    acquire()

    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && !sentinel) acquire()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release()
    }
  }, [active])
}
