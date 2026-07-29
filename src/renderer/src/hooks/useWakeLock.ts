import { useEffect } from 'react'

// Screen Wake Lock API (WKWebView/Safari 16.4+, covers Photon's shipping target), no need to duplicate in native/Rust. Re-acquires on visibility change: API force-releases lock whenever document hides (minimize/Spaces-switch), which desktop hits often.
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
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
