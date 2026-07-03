import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  autoplayNext: boolean
  rememberSpeed: boolean
  lastSpeed: number
  // subtitles
  subtitleStyle: SubtitleStyle
  preferredSubtitleLanguage: string // ISO 639-2, '' = off unless default
  subtitlesEnabled: boolean
  // general
  theme: 'dark' | 'light' | 'system'
  set: (partial: Partial<Omit<SettingsState, 'set'>>) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      maxBitrate: 0,
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
      theme: 'dark',
      set: (partial) => set(partial)
    }),
    { name: 'famto.settings' }
  )
)

export const AUTO_BITRATE = 140_000_000
