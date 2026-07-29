import { useSettings } from '../stores/settings'
import { themes, colorTokens } from '../lib/theme'
import { SettingsRow } from './SettingsSection'
import styles from './Settings.module.css'

export function AppearanceSettings(): React.JSX.Element {
  const theme = useSettings((s) => s.theme)
  const customColors = useSettings((s) => s.customColors)
  const set = useSettings((s) => s.set)

  // saved override or whatever active theme resolves to -- applyCustomColors keeps inline value in sync with store, no own effect/state needed
  const valueOf = (key: string): string =>
    customColors[key] || getComputedStyle(document.documentElement).getPropertyValue(key).trim()

  return (
    <>
      <h1 className={styles.pageTitle}>Appearance</h1>

      {/* theme + colors read as one section (not two headers) -- theme is just starting point for swatches below */}
      <div className={styles.section}>
        <div className={styles.rows}>
          <SettingsRow label="Theme">
            <div className={styles.slabRow}>
              {themes.map((t) => (
                <button
                  key={t.key}
                  className={`${styles.slab} ${theme === t.key ? styles.slabActive : ''}`}
                  // picking theme starts from its stock palette, not last theme's customizations
                  onClick={() => set({ theme: t.key, customColors: {} })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </SettingsRow>
        </div>
      </div>

      <h2 className={styles.sectionTitle}>Theme colors</h2>
      <div className={styles.rows}>
        {colorTokens.map((t) => (
          <SettingsRow key={t.key} label={t.label}>
            <input
              type="color"
              className={styles.colorSwatch}
              value={valueOf(t.key)}
              onChange={(e) => set({ customColors: { ...customColors, [t.key]: e.target.value } })}
            />
          </SettingsRow>
        ))}
        <SettingsRow label="Reset" hint="Back to this theme's own colors">
          <button className={styles.ghostBtn} onClick={() => set({ customColors: {} })}>
            Reset
          </button>
        </SettingsRow>
      </div>
    </>
  )
}
