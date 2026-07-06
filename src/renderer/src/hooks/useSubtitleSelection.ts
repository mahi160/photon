import { useCallback, useState } from 'react'
import {
  analyzeSubtitleSwitch,
  getSubtitleDelivery,
  isTextTrack as isTextTrackStream,
  type SubtitleOption
} from '../player/subtitleLogic'
import type { BaseItem, MediaStream } from '../lib/jellyfin'
import { useSettings } from '../stores/settings'
import { useTrackMemory } from '../stores/trackMemory'

export interface SubtitleSelectionState {
  index: number | null
  isText: boolean
}

export interface SubtitleSelectionActions {
  select: (newIndex: number | null) => 'reload' | 'setTextTrack' | 'disable'
}

export function useSubtitleSelection(
  session: {
    item: BaseItem
    mediaSource: { Id: string }
    subtitleStreams: MediaStream[]
  } | null
): SubtitleSelectionState & SubtitleSelectionActions {
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null)

  const select = useCallback(
    (newIndex: number | null): 'reload' | 'setTextTrack' | 'disable' => {
      if (!session) return 'disable'

      const settings = useSettings.getState()

      // get current subtitle stream
      const currentStream =
        subtitleIndex !== null
          ? session.subtitleStreams.find((s) => s.Index === subtitleIndex)
          : null
      const currentOption: SubtitleOption | null = currentStream
        ? {
            index: currentStream.Index,
            label: currentStream.DisplayTitle ?? `Subtitle ${currentStream.Index}`,
            language: currentStream.Language,
            delivery: getSubtitleDelivery(currentStream)
          }
        : null

      // get requested subtitle stream
      const nextStream =
        newIndex !== null ? session.subtitleStreams.find((s) => s.Index === newIndex) : null
      const nextOption: SubtitleOption | null = nextStream
        ? {
            index: nextStream.Index,
            label: nextStream.DisplayTitle ?? `Subtitle ${nextStream.Index}`,
            language: nextStream.Language,
            delivery: getSubtitleDelivery(nextStream)
          }
        : null

      // decide action needed
      const switchAction = analyzeSubtitleSwitch(currentOption, nextOption)

      // update state
      setSubtitleIndex(newIndex)

      // update settings
      if (newIndex === null) {
        settings.set({ subtitlesEnabled: false })
        useTrackMemory.getState().remember(session.item.Id, { subtitleStreamIndex: -1 })
      } else {
        const language = nextStream?.Language
        settings.set({
          subtitlesEnabled: true,
          ...(language ? { preferredSubtitleLanguage: language } : {})
        })
        useTrackMemory.getState().remember(session.item.Id, { subtitleStreamIndex: newIndex })
      }

      return switchAction.action
    },
    [session, subtitleIndex]
  )

  return {
    index: subtitleIndex,
    isText: subtitleIndex === null || (session !== null && isSessionTextTrack(session, subtitleIndex)),
    select
  }
}

// check if a subtitle stream in this session is text-based
function isSessionTextTrack(session: { subtitleStreams: MediaStream[] }, index: number): boolean {
  const stream = session.subtitleStreams.find((s) => s.Index === index)
  return stream ? isTextTrackStream(stream) : false
}
