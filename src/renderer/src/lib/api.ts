// Installs `window.api`, backed by Tauri commands. Every call site (session
// store, Settings, Player, ...) calls `window.api.*` — this is the one place
// that talks to the native side.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export type UpdaterStatus =
  | { state: 'idle' | 'checking' | 'not-available' }
  | { state: 'available' | 'downloaded'; version: string }
  | { state: 'error'; message: string }

export interface Api {
  sessionGet: () => Promise<string | null>
  sessionSet: (value: string) => Promise<boolean>
  sessionClear: () => Promise<void>
  appVersion: () => Promise<string>
  minimizeWindow: () => Promise<void>
  restoreWindow: () => Promise<void>
  setFullscreen: (fullscreen: boolean) => Promise<void>
  pipAvailable: () => Promise<boolean>
  setLoginItem: (enabled: boolean) => Promise<void>
  getLoginItem: () => Promise<boolean>
  setHwAccel: (enabled: boolean) => Promise<void>
  getHwAccel: () => Promise<boolean>
  setAutoUpdate: (enabled: boolean) => Promise<void>
  getAutoUpdate: () => Promise<boolean>
  getUpdaterStatus: () => Promise<UpdaterStatus>
  installUpdate: () => Promise<void>
  onUpdaterStatus: (cb: (status: UpdaterStatus) => void) => () => void
}

declare global {
  interface Window {
    api: Api
  }
}

window.api = {
  sessionGet: () => invoke('session_get'),
  sessionSet: (value) => invoke('session_set', { value }),
  sessionClear: () => invoke('session_clear'),
  appVersion: () => invoke('app_version'),
  minimizeWindow: () => invoke('app_minimize'),
  restoreWindow: () => invoke('app_restore'),
  setFullscreen: (fullscreen) => invoke('app_set_fullscreen', { fullscreen }),
  pipAvailable: () => invoke('pip_available'),
  setLoginItem: (enabled) => invoke('app_set_login_item', { enabled }),
  getLoginItem: () => invoke('app_get_login_item'),
  setHwAccel: (enabled) => invoke('app_set_hw_accel', { enabled }),
  getHwAccel: () => invoke('app_get_hw_accel'),
  setAutoUpdate: (enabled) => invoke('app_set_auto_update', { enabled }),
  getAutoUpdate: () => invoke('app_get_auto_update'),
  getUpdaterStatus: () => invoke('updater_get_status'),
  installUpdate: () => invoke('updater_install'),
  onUpdaterStatus: (cb) => {
    const unlisten = listen<UpdaterStatus>('updater://status', ({ payload }) => cb(payload))
    return () => void unlisten.then((un) => un())
  }
}
