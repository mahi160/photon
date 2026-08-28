import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Theme } from '../lib/theme'

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
  preferredAudioLanguage: string // ISO 639-2, '' = server default, kept in sync with player
  lastSubtitleDelay: number // seconds, restored on next playback
  // minimal subtitle-appearance GUI (issue #9): few knobs not full styling page (ADR-0007), applied at launch before raw passthrough below so matching raw key still wins, see mpvConfig.ts guiSubtitleConfig
  subtitleFontSize: number // scaled px at 720p window height, matches --sub-font-size
  subtitleColor: string // #RRGGBB, matches --sub-color
  subtitleBackgroundBox: boolean // opaque box behind subtitle text vs. none
  // mpv (issue #9): raw `key=value` lines, applied as extra mpv options on top of defaults, see mpvConfig.ts
  mpvConfig: string
  // general
  theme: Theme
  customColors: Record<string, string> // CSS var name -> hex, overrides the active theme (see lib/theme.ts)
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
  theme: 'gruvbox',
  customColors: {}
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
