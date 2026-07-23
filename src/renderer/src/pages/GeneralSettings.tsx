import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ToggleSwitch } from '../components/ToggleSwitch'
import { SettingsRow } from './SettingsSection'
import styles from './Settings.module.css'

export function GeneralSettings(): React.JSX.Element {
  const [loginItem, setLoginItem] = useState(false)
  const [autoUpdate, setAutoUpdate] = useState(true)

  useEffect(() => {
    void invoke<boolean>('app_get_login_item').then(setLoginItem)
    void invoke<boolean>('app_get_auto_update').then(setAutoUpdate)
  }, [])

  return (
    <>
      <h1 className={styles.pageTitle}>General</h1>
      <div className={styles.rows}>
        <SettingsRow label="Launch at startup">
          <ToggleSwitch
            label="Launch at startup"
            checked={loginItem}
            onChange={(v) => {
              setLoginItem(v)
              void invoke('app_set_login_item', { enabled: v })
            }}
          />
        </SettingsRow>
        <SettingsRow label="Automatically download updates">
          <ToggleSwitch
            label="Automatically download updates"
            checked={autoUpdate}
            onChange={(v) => {
              setAutoUpdate(v)
              void invoke('app_set_auto_update', { enabled: v })
            }}
          />
        </SettingsRow>
      </div>
    </>
  )
}
