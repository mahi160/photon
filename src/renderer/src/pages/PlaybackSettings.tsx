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

const subtitleSizes = [
  { value: 36, label: 'Small' },
  { value: 48, label: 'Medium' },
  { value: 64, label: 'Large' },
  { value: 80, label: 'Extra large' }
]

const subtitleColors = [
  { value: '#FFFFFF', label: 'White' },
  { value: '#FFFF00', label: 'Yellow' },
  { value: '#00FFFF', label: 'Cyan' }
]

export function PlaybackSettings(): React.JSX.Element {
  const maxBitrate = useSettings((s) => s.maxBitrate)
  const autoplayNext = useSettings((s) => s.autoplayNext)
  const autoSkipSegments = useSettings((s) => s.autoSkipSegments)
  const surpriseUnwatchedOnly = useSettings((s) => s.surpriseUnwatchedOnly)
  const rememberSpeed = useSettings((s) => s.rememberSpeed)
  const subtitleFontSize = useSettings((s) => s.subtitleFontSize)
  const subtitleColor = useSettings((s) => s.subtitleColor)
  const subtitleBackgroundBox = useSettings((s) => s.subtitleBackgroundBox)
  const mpvConfig = useSettings((s) => s.mpvConfig)
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
      <SettingsRow label="Autoplay next episode">
        <ToggleSwitch
          label="Autoplay next episode"
          checked={autoplayNext}
          onChange={(v) => set({ autoplayNext: v })}
        />
      </SettingsRow>
      <SettingsRow
        label="Skip intros automatically"
        hint="Also recaps and previews, when the server has detected them. Credits always show."
      >
        <ToggleSwitch
          label="Skip intros automatically"
          checked={autoSkipSegments}
          onChange={(v) => set({ autoSkipSegments: v })}
        />
      </SettingsRow>
      <SettingsRow
        label="“Surprise me” picks unwatched only"
        hint="Off: the random pick can include movies you’ve already seen"
      >
        <ToggleSwitch
          label="Surprise me picks unwatched only"
          checked={surpriseUnwatchedOnly}
          onChange={(v) => set({ surpriseUnwatchedOnly: v })}
        />
      </SettingsRow>
      <SettingsRow label="Remember playback speed">
        <ToggleSwitch
          label="Remember playback speed"
          checked={rememberSpeed}
          onChange={(v) => set({ rememberSpeed: v })}
        />
      </SettingsRow>
      <SettingsRow label="Subtitle size" hint="Takes effect on next playback">
        <select
          className={styles.select}
          value={subtitleFontSize}
          onChange={(e) => set({ subtitleFontSize: Number(e.target.value) })}
          aria-label="Subtitle size"
        >
          {subtitleSizes.map((sz) => (
            <option key={sz.value} value={sz.value}>
              {sz.label}
            </option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow label="Subtitle color" hint="Takes effect on next playback">
        <select
          className={styles.select}
          value={subtitleColor}
          onChange={(e) => set({ subtitleColor: e.target.value })}
          aria-label="Subtitle color"
        >
          {subtitleColors.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow label="Subtitle background box" hint="Takes effect on next playback">
        <ToggleSwitch
          label="Subtitle background box"
          checked={subtitleBackgroundBox}
          onChange={(v) => set({ subtitleBackgroundBox: v })}
        />
      </SettingsRow>
      <SettingsRow
        label="mpv config"
        hint="Advanced: raw key=value mpv options, applied on top of everything above. Takes effect on next playback."
      >
        <textarea
          className={`${styles.select} ${styles.mpvConfigInput}`}
          value={mpvConfig}
          onChange={(e) => set({ mpvConfig: e.target.value })}
          placeholder={'sub-font-size=64\nsub-color=#00FF00'}
          spellCheck={false}
          aria-label="mpv config"
        />
      </SettingsRow>
    </SettingsSection>
  )
}
