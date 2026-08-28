import { Link, Outlet, useParams } from '@tanstack/react-router'
import { settingsSections, type SettingsSectionKey } from '../lib/settingsSections'
import { GeneralSettings } from './GeneralSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { PlaybackSettings } from './PlaybackSettings'
import { StatsSettings } from './StatsSettings'
import { ServerSettings } from './ServerSettings'
import { AdvancedSettings } from './AdvancedSettings'
import { AboutSettings } from './AboutSettings'
import styles from './Settings.module.css'

// Settings shell: sidebar + <Outlet/> for the active section's route (#9) -- sections used
// to be a store-persisted string swapped client-side, so there was no deep link to e.g.
// /settings/playback, and Back from a panel exited Settings entirely instead of returning
// to the previous section.
export function Settings(): React.JSX.Element {
  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar} aria-label="Settings sections">
        <div className={styles.navList}>
          {settingsSections.map((s) => (
            <Link
              key={s.key}
              to="/settings/$section"
              params={{ section: s.key }}
              className={styles.navItem}
              activeProps={{ 'aria-current': 'page' }}
            >
              {s.label}
            </Link>
          ))}
        </div>
      </nav>
      {/* sidebar is fixed part of "desktop settings app" scrolling -- only this panel scrolls, not whole page (see .content) */}
      <div className={styles.content}>
        <div className={styles.contentInner}>
          <Outlet />
        </div>
      </div>
    </div>
  )
}

const panels: Record<SettingsSectionKey, () => React.JSX.Element> = {
  general: GeneralSettings,
  appearance: AppearanceSettings,
  playback: PlaybackSettings,
  stats: StatsSettings,
  server: ServerSettings,
  advanced: AdvancedSettings,
  about: AboutSettings
}

export function SettingsSectionPanel(): React.JSX.Element {
  const { section } = useParams({ from: '/app/shell/settings/$section' })
  const Panel = panels[section as SettingsSectionKey] ?? panels.general
  return <Panel />
}
