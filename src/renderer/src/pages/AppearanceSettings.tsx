import { useSettings } from '../stores/settings'
import { themes, colorTokens } from '../lib/theme'
import { SettingsRow } from './SettingsSection'
import styles from './Settings.module.css'

export function AppearanceSettings(): React.JSX.Element {
  const theme = useSettings((s) => s.theme)
  const customColors = useSettings((s) => s.customColors)
  const set = useSettings((s) => s.set)

  // saved override, or whatever the active theme currently resolves it to
  // (applyCustomColors keeps that inline value in sync with the store, so
  // this is always accurate without its own effect/state)
  const valueOf = (key: string): string =>
    customColors[key] || getComputedStyle(document.documentElement).getPropertyValue(key).trim()

  return (
    <>
      <h1 className={styles.pageTitle}>Appearance</h1>

      {/* theme + its colors read as one section (not two headers) -- a
          theme is just a starting point for the swatches below it */}
      <div className={styles.section}>
        <div className={styles.rows}>
          <SettingsRow label="Theme">
            <div className={styles.slabRow}>
              {themes.map((t) => (
                <button
                  key={t.key}
                  className={`${styles.slab} ${theme === t.key ? styles.slabActive : ''}`}
                  // picking a theme starts from its stock palette, not
                  // whatever was customized on top of the last one
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
