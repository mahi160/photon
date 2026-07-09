import { useEffect, useState } from 'react'
import { useSettings } from '../stores/settings'
import { ToggleSwitch } from '../components/ToggleSwitch'
import { SettingsSection, SettingsRow } from './SettingsSection'
import styles from './Settings.module.css'

const bitrates = [
  { value: 0, label: 'Auto' },
  { value: 20_000_000, label: '20 Mbps' },
  { value: 10_000_000, label: '10 Mbps' },
  { value: 4_000_000, label: '4 Mbps' }
]

const playerModes = [
  { value: 'web', label: 'Built-in' },
  { value: 'auto', label: 'Built-in · mpv when transcoding' },
  { value: 'mpv', label: 'Always mpv' }
] as const

export function PlaybackSettings(): React.JSX.Element {
  const maxBitrate = useSettings((s) => s.maxBitrate)
  const playerMode = useSettings((s) => s.playerMode)
  const autoplayNext = useSettings((s) => s.autoplayNext)
  const rememberSpeed = useSettings((s) => s.rememberSpeed)
  const set = useSettings((s) => s.set)
  const [hwAccel, setHwAccel] = useState(true)

  useEffect(() => {
    void window.api.getHwAccel().then(setHwAccel)
  }, [])

  return (
    <SettingsSection title="Playback">
      <SettingsRow label="Preferred quality" hint="Maximum streaming bitrate">
        <select
          className={styles.select}
          value={maxBitrate}
          onChange={(e) => set({ maxBitrate: Number(e.target.value) })}
          aria-label="Preferred quality"
        >
          {bitrates.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow label="Hardware acceleration" hint="Takes effect after restart">
        <ToggleSwitch
          label="Hardware acceleration"
          checked={hwAccel}
          onChange={(v) => {
            setHwAccel(v)
            void window.api.setHwAccel(v)
          }}
        />
      </SettingsRow>
      <SettingsRow
        label="Player"
        hint="mpv plays in its own window, avoids transcoding (requires mpv). Picture-in-Picture always switches to the built-in player."
      >
        <select
          className={styles.select}
          value={playerMode}
          onChange={(e) =>
            set({ playerMode: e.target.value as (typeof playerModes)[number]['value'] })
          }
          aria-label="Player"
        >
          {playerModes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow label="Autoplay next episode">
        <ToggleSwitch
          label="Autoplay next episode"
          checked={autoplayNext}
          onChange={(v) => set({ autoplayNext: v })}
        />
      </SettingsRow>
      <SettingsRow label="Remember playback speed">
        <ToggleSwitch
          label="Remember playback speed"
          checked={rememberSpeed}
          onChange={(v) => set({ rememberSpeed: v })}
        />
      </SettingsRow>
    </SettingsSection>
  )
}
