import { useSettings } from '../stores/settings'
import { themes } from '../lib/theme'
import { SettingsSection, SettingsRow } from './SettingsSection'
import styles from './Settings.module.css'

export function AppearanceSettings(): React.JSX.Element {
  const theme = useSettings((s) => s.theme)
  const set = useSettings((s) => s.set)

  return (
    <SettingsSection title="Appearance">
      <SettingsRow label="Theme">
        <div className={styles.slabRow}>
          {themes.map((t) => (
            <button
              key={t.key}
              className={`${styles.slab} ${theme === t.key ? styles.slabActive : ''}`}
              onClick={() => set({ theme: t.key })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </SettingsRow>
    </SettingsSection>
  )
}
