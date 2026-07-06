import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '../stores/session'
import { useSettings } from '../stores/settings'
import { ToggleSwitch } from '../components/ToggleSwitch'
import { AppearanceSettings } from './AppearanceSettings'
import { PlaybackSettings } from './PlaybackSettings'
import { SubtitleSettings } from './SubtitleSettings'
import { SettingsSection, SettingsRow } from './SettingsSection'
import styles from './Settings.module.css'

export function Settings(): React.JSX.Element {
  const settings = useSettings()
  const session = useSession((s) => s.session)
  const logout = useSession((s) => s.logout)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [version, setVersion] = useState('')
  const [loginItem, setLoginItem] = useState(false)

  useEffect(() => {
    void window.api.appVersion().then(setVersion)
    void window.api.getLoginItem().then(setLoginItem)
  }, [])

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Settings</h1>

      <AppearanceSettings />

      <SettingsSection title="General">
        <SettingsRow label="Launch at startup">
          <ToggleSwitch
            label="Launch at startup"
            checked={loginItem}
            onChange={(v) => {
              setLoginItem(v)
              void window.api.setLoginItem(v)
            }}
          />
        </SettingsRow>
      </SettingsSection>

      <PlaybackSettings />
      <SubtitleSettings />

      <SettingsSection title="Server">
        <SettingsRow label={session?.server ?? ''} hint={`Signed in as ${session?.userName ?? ''}`}>
          <div className={styles.buttons}>
            <button className={styles.ghostBtn} onClick={() => queryClient.invalidateQueries()}>
              Reconnect
            </button>
            <button
              className={styles.dangerBtn}
              onClick={async () => {
                await logout()
                navigate({ to: '/login' })
              }}
            >
              Logout
            </button>
          </div>
        </SettingsRow>
        <SettingsRow label="Reset settings" hint="Restores all preferences above to defaults">
          <button
            className={styles.dangerBtn}
            onClick={() => {
              if (confirm('Reset all settings to defaults? This does not sign you out.')) {
                settings.reset()
              }
            }}
          >
            Reset
          </button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="About">
        <SettingsRow label={`Photon ${version}`} hint="MIT License">
          <a
            className={styles.link}
            href="https://github.com/mahi160/photon"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </SettingsRow>
      </SettingsSection>

      <p className={styles.footnote}>
        Press <kbd className={styles.kbd}>?</kbd> anywhere for keyboard shortcuts.
      </p>
    </div>
  )
}
