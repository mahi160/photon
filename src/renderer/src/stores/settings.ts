import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// web = built-in player (server transcodes when needed)
// auto = built-in for direct play, mpv when transcoding would be needed
// mpv = always play in the external mpv window
export type PlayerMode = 'web' | 'auto' | 'mpv'

export interface SubtitleStyle {
  fontSize: number // percent, 100 = default
  color: string
  background: string // css color incl. alpha
  outline: boolean
  verticalPosition: number // percent from bottom, 0..30
  opacity: number // 0..1
}

interface SettingsState {
  // playback
  maxBitrate: number // bits/sec, 0 = auto (very high)
  playerMode: PlayerMode
  autoplayNext: boolean
  autoSkipSegments: boolean // auto-skip intros/recaps/previews (never credits)
  surpriseUnwatchedOnly: boolean // "Surprise me" picks from unwatched movies
  rememberSpeed: boolean
  lastSpeed: number
  lastVolume: number // 0..1, restored on next playback
  lastMuted: boolean
  // subtitles
  subtitleStyle: SubtitleStyle
  preferredSubtitleLanguage: string // ISO 639-2, '' = off unless default
  subtitlesEnabled: boolean
  preferredAudioLanguage: string // ISO 639-2, '' = server default. Kept in sync with the player.
  lastSubtitleDelay: number // seconds, restored on next playback
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
  playerMode: 'web',
  autoplayNext: true,
  autoSkipSegments: false,
  surpriseUnwatchedOnly: true,
  rememberSpeed: false,
  lastSpeed: 1,
  lastVolume: 1,
  lastMuted: false,
  subtitleStyle: {
    fontSize: 100,
    color: '#ffffff',
    background: 'rgba(0,0,0,0.5)',
    outline: false,
    verticalPosition: 4,
    opacity: 1
  },
  preferredSubtitleLanguage: '',
  subtitlesEnabled: true,
  preferredAudioLanguage: '',
  lastSubtitleDelay: 0,
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
