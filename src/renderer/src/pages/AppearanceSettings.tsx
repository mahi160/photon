import { useSettings } from '../stores/settings'
import { SettingsSection, SettingsRow } from './SettingsSection'
import styles from './Settings.module.css'

const themeOptions: { key: 'dark' | 'light' | 'system'; label: string }[] = [
  { key: 'dark', label: 'Dark' },
  { key: 'light', label: 'Light' },
  { key: 'system', label: 'System' }
]

export function AppearanceSettings(): React.JSX.Element {
  const theme = useSettings((s) => s.theme)
  const set = useSettings((s) => s.set)

  return (
    <SettingsSection title="Appearance">
      <SettingsRow label="Theme">
        <div className={styles.slabRow}>
          {themeOptions.map((o) => (
            <button
              key={o.key}
              className={`${styles.slab} ${theme === o.key ? styles.slabActive : ''}`}
              onClick={() => set({ theme: o.key })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </SettingsRow>
    </SettingsSection>
  )
}
