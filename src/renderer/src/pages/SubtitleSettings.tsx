import { useCallback } from 'react'
import { useSettings } from '../stores/settings'
import { ToggleSwitch } from '../components/ToggleSwitch'
import { Stepper, type StepperClasses } from '../components/Stepper'
import { SettingsSection, SettingsRow } from './SettingsSection'
import styles from './Settings.module.css'

const stepperClasses: StepperClasses = {
  group: styles.stepperGroup,
  btn: styles.stepBtn,
  input: styles.stepInput
}

function subtitleSwatches(): { label: string; value: string }[] {
  const root = getComputedStyle(document.documentElement)
  const accent = (name: string): string => root.getPropertyValue(name).trim()
  return [
    { label: 'White', value: '#ffffff' },
    { label: 'Yellow', value: '#f6e05e' },
    { label: 'Accent', value: accent('--accent') },
    { label: 'Accent 2', value: accent('--accent-2') },
    { label: 'Accent 3', value: accent('--accent-3') },
    { label: 'Accent 4', value: accent('--accent-4') }
  ]
}

function SubtitleColorSwatches({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  // subscribe so swatches re-resolve when the theme (dark/light) changes
  useSettings((s) => s.theme)
  const swatches = subtitleSwatches()
  return (
    <div className={styles.swatchRow}>
      {swatches.map((sw) => (
        <button
          key={sw.label}
          aria-label={sw.label}
          title={sw.label}
          className={`${styles.swatch} ${value.toLowerCase() === sw.value.toLowerCase() ? styles.swatchActive : ''}`}
          style={{ background: sw.value }}
          onClick={() => onChange(sw.value)}
        />
      ))}
    </div>
  )
}

export function SubtitleSettings(): React.JSX.Element {
  const settings = useSettings()
  const s = settings.subtitleStyle

  return (
    <SettingsSection title="Subtitles">
      <SettingsRow label="Enabled by default">
        <ToggleSwitch
          label="Subtitles enabled by default"
          checked={settings.subtitlesEnabled}
          onChange={(v) => settings.set({ subtitlesEnabled: v })}
        />
      </SettingsRow>
      <SettingsRow label="Preferred language" hint="ISO code, e.g. eng">
        <input
          className={`${styles.select} ${styles.textInput}`}
          value={settings.preferredSubtitleLanguage}
          onChange={(e) => settings.set({ preferredSubtitleLanguage: e.target.value })}
          aria-label="Preferred subtitle language"
        />
      </SettingsRow>
      <SettingsRow label="Size" hint="% of the base subtitle size">
        <Stepper
          min={50}
          max={200}
          step={10}
          value={s.fontSize}
          onChange={(v) => settings.set({ subtitleStyle: { ...s, fontSize: v } })}
          label="subtitle size"
          classes={stepperClasses}
        />
      </SettingsRow>
      <SettingsRow label="Color">
        <SubtitleColorSwatches
          value={s.color}
          onChange={useCallback(
            (color) => settings.set({ subtitleStyle: { ...s, color } }),
            [s, settings]
          )}
        />
      </SettingsRow>
      <SettingsRow label="Background">
        <select
          className={styles.select}
          value={s.background}
          onChange={(e) => settings.set({ subtitleStyle: { ...s, background: e.target.value } })}
          aria-label="Subtitle background"
        >
          <option value="transparent">None</option>
          <option value="rgba(0,0,0,0.5)">Half</option>
          <option value="rgba(0,0,0,0.9)">Solid</option>
        </select>
      </SettingsRow>
      <SettingsRow label="Outline">
        <ToggleSwitch
          label="Subtitle outline"
          checked={s.outline}
          onChange={(v) => settings.set({ subtitleStyle: { ...s, outline: v } })}
        />
      </SettingsRow>
      <SettingsRow label="Vertical position">
        <Stepper
          min={0}
          max={30}
          step={2}
          value={s.verticalPosition}
          onChange={(v) => settings.set({ subtitleStyle: { ...s, verticalPosition: v } })}
          label="subtitle vertical position"
          classes={stepperClasses}
        />
      </SettingsRow>
      <SettingsRow label="Opacity">
        <Stepper
          min={0.2}
          max={1}
          step={0.1}
          value={s.opacity}
          onChange={(v) => settings.set({ subtitleStyle: { ...s, opacity: v } })}
          format={{ style: 'percent', maximumFractionDigits: 0 }}
          label="subtitle opacity"
          classes={stepperClasses}
        />
      </SettingsRow>
    </SettingsSection>
  )
}
