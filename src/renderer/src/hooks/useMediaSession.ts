import { useEffect } from 'react'
import type { BaseItem } from '../lib/jellyfin'

export interface MediaSessionHandlers {
  togglePlay: () => void
  seekBy: (delta: number) => void
  playItem?: (item: BaseItem) => void
  prevEpisode?: BaseItem | null
  nextEpisode?: BaseItem | null
}

export function useMediaSession(handlers: MediaSessionHandlers): void {
  useEffect(() => {
    const ms = navigator.mediaSession

    ms.setActionHandler('play', () => handlers.togglePlay())
    ms.setActionHandler('pause', () => handlers.togglePlay())
    ms.setActionHandler('seekbackward', () => handlers.seekBy(-10))
    ms.setActionHandler('seekforward', () => handlers.seekBy(10))
    ms.setActionHandler(
      'previoustrack',
      handlers.prevEpisode && handlers.playItem ? () => handlers.playItem!(handlers.prevEpisode!) : null
    )
    ms.setActionHandler(
      'nexttrack',
      handlers.nextEpisode && handlers.playItem ? () => handlers.playItem!(handlers.nextEpisode!) : null
    )

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
      ms.metadata = null
    }
  }, [handlers])
}
