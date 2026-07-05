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
  rememberSpeed: boolean
  lastSpeed: number
  // subtitles
  subtitleStyle: SubtitleStyle
  preferredSubtitleLanguage: string // ISO 639-2, '' = off unless default
  subtitlesEnabled: boolean
  preferredAudioLanguage: string // ISO 639-2, '' = server default. Kept in sync with the player.
  lastSubtitleDelay: number // seconds, restored on next playback
  // general
  theme: 'dark' | 'light' | 'system'
  colorScheme: 'rose-pine' | 'everforest' | 'gruvbox' | 'kanagawa'
  set: (partial: Partial<Omit<SettingsState, 'set'>>) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      maxBitrate: 0,
      playerMode: 'web',
      autoplayNext: true,
      rememberSpeed: false,
      lastSpeed: 1,
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
      theme: 'dark',
      colorScheme: 'rose-pine',
      set: (partial) => set(partial)
    }),
    { name: 'photon.settings' }
  )
)
