import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsState {
  // playback
  maxBitrate: number // bits/sec, 0 = auto (very high)
  autoplayNext: boolean
  autoSkipSegments: boolean // auto-skip intros/recaps/previews (never credits)
  surpriseUnwatchedOnly: boolean // "Surprise me" picks from unwatched movies
  rememberSpeed: boolean
  lastSpeed: number
  lastVolume: number // 0..1, restored on next playback
  lastMuted: boolean
  // subtitles
  preferredSubtitleLanguage: string // ISO 639-2, '' = off unless default
  subtitlesEnabled: boolean
  preferredAudioLanguage: string // ISO 639-2, '' = server default. Kept in sync with the player.
  lastSubtitleDelay: number // seconds, restored on next playback
  // minimal subtitle-appearance GUI (issue #9 follow-up) -- a few common
  // knobs, not a full styling page (ADR-0007 still holds: no per-property
  // GUI). Applied as mpv options at launch, before the raw passthrough
  // below so a matching raw key still wins. See mpvConfig.ts's
  // guiSubtitleConfig.
  subtitleFontSize: number // scaled px at 720p window height, matches --sub-font-size
  subtitleColor: string // #RRGGBB, matches --sub-color
  subtitleBackgroundBox: boolean // opaque box behind subtitle text vs. none
  // mpv (issue #9): raw `key=value` lines, applied as extra mpv options at
  // launch on top of Photon's default subtitle appearance. See mpvConfig.ts.
  mpvConfig: string
  // general
  theme: 'dark' | 'light' | 'system'
  set: (partial: Partial<Omit<SettingsState, 'set'>>) => void
  reset: () => void
}

const defaults: Omit<SettingsState, 'set' | 'reset'> = {
  maxBitrate: 0,
  autoplayNext: true,
  autoSkipSegments: false,
  surpriseUnwatchedOnly: true,
  rememberSpeed: false,
  lastSpeed: 1,
  lastVolume: 1,
  lastMuted: false,
  preferredSubtitleLanguage: '',
  subtitlesEnabled: true,
  preferredAudioLanguage: '',
  lastSubtitleDelay: 0,
  subtitleFontSize: 48,
  subtitleColor: '#FFFFFF',
  subtitleBackgroundBox: false,
  mpvConfig: '',
  theme: 'dark'
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      set: (partial) => set(partial),
      reset: () => set(defaults)
    }),
    { name: 'photon.settings' }
  )
)
