import { useEffect } from 'react'

// Screen Wake Lock API (WKWebView/Safari 16.4+, so covered on Photon's own
// shipping target) instead of any native/Rust power-management code --
// exactly what it's for, no reason to duplicate it. Re-acquires on
// visibility change: the API itself force-releases the lock whenever the
// document goes hidden (window minimized/Spaces-switched), which a desktop
// player hits far more than a browser tab ever would.
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
          // e.g. low battery / policy denial -- just play without the lock
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
