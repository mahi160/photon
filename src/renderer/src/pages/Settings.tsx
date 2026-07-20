import { useEffect, useState } from 'react'
import type { UpdaterStatus } from '../lib/api'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '../stores/session'
import { useSettings } from '../stores/settings'
import { ToggleSwitch } from '../components/ToggleSwitch'
import { AppearanceSettings } from './AppearanceSettings'
import { PlaybackSettings } from './PlaybackSettings'
import { StatsSettings } from './StatsSettings'
import { SettingsSection, SettingsRow } from './SettingsSection'
import styles from './Settings.module.css'

export function Settings(): React.JSX.Element {
  const reset = useSettings((s) => s.reset)
  const session = useSession((s) => s.session)
  const logout = useSession((s) => s.logout)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [tab, setTab] = useState<'preferences' | 'stats'>('preferences')
  const [version, setVersion] = useState('')
  const [loginItem, setLoginItem] = useState(false)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [updater, setUpdater] = useState<UpdaterStatus>({ state: 'idle' })

  useEffect(() => {
    void window.api.appVersion().then(setVersion)
    void window.api.getLoginItem().then(setLoginItem)
    void window.api.getAutoUpdate().then(setAutoUpdate)
    void window.api.getUpdaterStatus().then(setUpdater)
    return window.api.onUpdaterStatus(setUpdater)
  }, [])

  const updateHint =
    updater.state === 'checking'
      ? 'Checking for updates…'
      : updater.state === 'available'
        ? `Downloading ${updater.version}…`
        : updater.state === 'downloaded'
          ? `Version ${updater.version} ready`
          : updater.state === 'not-available'
            ? 'Up to date'
            : updater.state === 'error'
              ? `Update check failed: ${updater.message}`
              : null

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>Settings</h1>
        <div className={styles.tabs} role="group" aria-label="Settings section">
          {(['preferences', 'stats'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`${styles.tabBtn} ${tab === t ? styles.tabBtnActive : ''}`}
              aria-pressed={tab === t}
            >
              {t === 'preferences' ? 'Preferences' : 'Stats'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'stats' ? (
        <SettingsSection title="Watch stats">
          <StatsSettings />
        </SettingsSection>
      ) : (
        <>
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
            <SettingsRow label="Auto update" hint="Check for new versions on launch">
              <ToggleSwitch
                label="Auto update"
                checked={autoUpdate}
                onChange={(v) => {
                  setAutoUpdate(v)
                  void window.api.setAutoUpdate(v)
                }}
              />
            </SettingsRow>
          </SettingsSection>

          <PlaybackSettings />

          <SettingsSection title="Server">
            <SettingsRow
              label={session?.server ?? ''}
              hint={`Signed in as ${session?.userName ?? ''}`}
            >
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
                    reset()
                  }
                }}
              >
                Reset
              </button>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="About">
            <SettingsRow label={`Photon ${version}`} hint={updateHint ?? 'MIT License'}>
              {updater.state === 'downloaded' ? (
                <button className={styles.ghostBtn} onClick={() => window.api.installUpdate()}>
                  Restart to update
                </button>
              ) : (
                <a
                  className={styles.link}
                  href="https://github.com/mahi160/photon"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub
                </a>
              )}
            </SettingsRow>
            <SettingsRow
              label="Acknowledgements"
              hint="Tauri, React, TanStack, Zustand, mpv, and the Jellyfin project"
            />
          </SettingsSection>
        </>
      )}

      <p className={styles.footnote}>
        Press <kbd className={styles.kbd}>?</kbd> anywhere for keyboard shortcuts.
      </p>
    </div>
  )
}
