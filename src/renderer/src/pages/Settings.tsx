import { useSettings } from '../stores/settings'
import { settingsSections, type SettingsSectionKey } from '../lib/settingsSections'
import { GeneralSettings } from './GeneralSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { PlaybackSettings } from './PlaybackSettings'
import { StatsSettings } from './StatsSettings'
import { ServerSettings } from './ServerSettings'
import { AdvancedSettings } from './AdvancedSettings'
import { AboutSettings } from './AboutSettings'
import styles from './Settings.module.css'

const panels: Record<SettingsSectionKey, () => React.JSX.Element> = {
  general: GeneralSettings,
  appearance: AppearanceSettings,
  playback: PlaybackSettings,
  stats: StatsSettings,
  server: ServerSettings,
  advanced: AdvancedSettings,
  about: AboutSettings
}

export function Settings(): React.JSX.Element {
  const section = useSettings((s) => s.settingsSection)
  const set = useSettings((s) => s.set)
  const Panel = panels[section]

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar} aria-label="Settings sections">
        <div className={styles.navList}>
          {settingsSections.map((s) => (
            <button
              key={s.key}
              className={`${styles.navItem} ${section === s.key ? styles.navItemActive : ''}`}
              aria-current={section === s.key ? 'page' : undefined}
              onClick={() => set({ settingsSection: s.key })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </nav>
      {/* the sidebar is the fixed part of "desktop settings app" scrolling
          -- only this panel scrolls, not the whole page (see .content) */}
      <div className={styles.content}>
        <div className={styles.contentInner}>
          <Panel />
        </div>
      </div>
    </div>
  )
}
