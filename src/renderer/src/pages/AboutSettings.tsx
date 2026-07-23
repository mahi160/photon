import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  getUpdaterStatus,
  installUpdate,
  onUpdaterStatus,
  type UpdaterStatus
} from '../lib/updater'
import { useUi } from '../stores/ui'
import { SettingsRow } from './SettingsSection'
import styles from './Settings.module.css'

export function AboutSettings(): React.JSX.Element {
  const [version, setVersion] = useState('')
  const [updater, setUpdater] = useState<UpdaterStatus>({ state: 'idle' })
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen)

  useEffect(() => {
    void invoke<string>('app_version').then(setVersion)
    void getUpdaterStatus().then(setUpdater)
    return onUpdaterStatus(setUpdater)
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
    <>
      <h1 className={styles.pageTitle}>About</h1>
      <div className={styles.rows}>
        <SettingsRow label={`Photon ${version}`} hint={updateHint ?? 'MIT License'}>
          {updater.state === 'downloaded' ? (
            <button className={styles.ghostBtn} onClick={() => installUpdate()}>
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
        <SettingsRow label="Keyboard shortcuts" hint="Every hotkey, at a glance">
          <button className={styles.ghostBtn} onClick={() => setShortcutsOpen(true)}>
            View
          </button>
        </SettingsRow>
      </div>
    </>
  )
}
