import { useEffect, useRef } from 'react'
import type { BaseItem } from '../lib/jellyfin'

export interface MediaSessionHandlers {
  togglePlay: () => void
  seekBy: (delta: number) => void
  playItem?: (item: BaseItem) => void
  prevEpisode?: BaseItem | null
  nextEpisode?: BaseItem | null
}

// Single owner of OS media-key surface. Handlers read through a ref so registration happens once (plus prev/next flips) -- depending on handlers object re-ran this every tick, cleanup's `metadata = null` kept wiping overlay title.
export function useMediaSession(handlers: MediaSessionHandlers): void {
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  })

  const hasPrev = !!(handlers.prevEpisode && handlers.playItem)
  const hasNext = !!(handlers.nextEpisode && handlers.playItem)
  useEffect(() => {
    const ms = navigator.mediaSession
    const jump = (dir: 'prevEpisode' | 'nextEpisode') => (): void => {
      const h = ref.current
      const ep = h[dir]
      if (ep && h.playItem) h.playItem(ep)
    }
    ms.setActionHandler('play', () => ref.current.togglePlay())
    ms.setActionHandler('pause', () => ref.current.togglePlay())
    ms.setActionHandler('seekbackward', () => ref.current.seekBy(-10))
    ms.setActionHandler('seekforward', () => ref.current.seekBy(10))
    ms.setActionHandler('previoustrack', hasPrev ? jump('prevEpisode') : null)
    ms.setActionHandler('nexttrack', hasNext ? jump('nextEpisode') : null)
    return () => {
      for (const a of [
        'play',
        'pause',
        'seekbackward',
        'seekforward',
        'previoustrack',
        'nexttrack'
      ] as MediaSessionAction[])
        ms.setActionHandler(a, null)
    }
  }, [hasPrev, hasNext])

  // metadata belongs to playback loads (usePlayback sets per item) -- clear only when player actually leaves, never on re-registration
  useEffect(() => {
    return () => {
      navigator.mediaSession.metadata = null
    }
  }, [])
}
