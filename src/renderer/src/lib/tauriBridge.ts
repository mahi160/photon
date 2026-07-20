// Installs `window.api` (issue #5) when running under the Tauri shell,
// backed by Tauri commands instead of Electron's preload/ipcRenderer bridge.
// Every existing call site (session store, Settings, Player, ...) keeps
// calling `window.api.*` unchanged — only the transport swaps.
//
// Under Electron, src/preload/index.ts already sets `window.api` before this
// module's guard below ever runs, so this is a no-op there.
//
// mpv:*/updater:* are stubbed here — playback (#6/#10) and the release
// pipeline (#11) aren't ported yet, and pages that call them (Player,
// MpvPlayer, Settings) shouldn't crash in the meantime.
import { invoke } from '@tauri-apps/api/core'
import type { PreloadApi, UpdaterStatus } from '../../../preload/index'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__ && !window.api) {
  const api: PreloadApi = {
    sessionGet: () => invoke('session_get'),
    sessionSet: (value) => invoke('session_set', { value }),
    sessionClear: () => invoke('session_clear'),
    appVersion: () => invoke('app_version'),
    minimizeWindow: () => invoke('app_minimize'),
    restoreWindow: () => invoke('app_restore'),
    setLoginItem: (enabled) => invoke('app_set_login_item', { enabled }),
    getLoginItem: () => invoke('app_get_login_item'),
    setHwAccel: (enabled) => invoke('app_set_hw_accel', { enabled }),
    getHwAccel: () => invoke('app_get_hw_accel'),
    // ponytail: auto-update isn't ported yet (#11) — persisted pref only
    setAutoUpdate: () => Promise.resolve(),
    getAutoUpdate: () => Promise.resolve(false),
    // ponytail: mpv playback isn't ported yet (#6/#10) — report unavailable
    // so the UI's existing "mpv not installed" fallback path applies
    mpvPlay: () => Promise.resolve(false),
    mpvStatus: () => Promise.resolve({ running: false, timePos: 0, paused: false }),
    mpvStop: () => Promise.resolve(),
    mpvSet: () => Promise.resolve(false),
    mpvCheck: () => Promise.resolve(false),
    fetchSubtitle: (url) => invoke('subtitle_fetch', { url }),
    getUpdaterStatus: () => Promise.resolve<UpdaterStatus>({ state: 'idle' }),
    installUpdate: () => Promise.resolve(),
    onUpdaterStatus: () => () => {}
  }
  window.api = api
}
