import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export type UpdaterStatus =
  | { state: 'idle' | 'checking' | 'not-available' | 'error' }
  | { state: 'available' | 'downloaded'; version: string }

const api = {
  sessionGet: (): Promise<string | null> => ipcRenderer.invoke('session:get'),
  sessionSet: (value: string): Promise<boolean> => ipcRenderer.invoke('session:set', value),
  sessionClear: (): Promise<void> => ipcRenderer.invoke('session:clear'),
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('app:minimize'),
  restoreWindow: (): Promise<void> => ipcRenderer.invoke('app:restore'),
  setLoginItem: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('app:setLoginItem', enabled),
  getLoginItem: (): Promise<boolean> => ipcRenderer.invoke('app:getLoginItem'),
  setHwAccel: (enabled: boolean): Promise<void> => ipcRenderer.invoke('app:setHwAccel', enabled),
  getHwAccel: (): Promise<boolean> => ipcRenderer.invoke('app:getHwAccel'),
  setAutoUpdate: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('app:setAutoUpdate', enabled),
  getAutoUpdate: (): Promise<boolean> => ipcRenderer.invoke('app:getAutoUpdate'),
  mpvPlay: (opts: { url: string; start: number; title: string }): Promise<boolean> =>
    ipcRenderer.invoke('mpv:play', opts),
  mpvStatus: (): Promise<{ running: boolean; timePos: number; paused: boolean }> =>
    ipcRenderer.invoke('mpv:status'),
  mpvStop: (): Promise<void> => ipcRenderer.invoke('mpv:stop'),
  mpvSet: (
    prop: 'ontop' | 'window-scale' | 'fullscreen' | 'pause',
    value: boolean | number
  ): Promise<boolean> => ipcRenderer.invoke('mpv:set', prop, value),
  mpvCheck: (): Promise<boolean> => ipcRenderer.invoke('mpv:check'),
  fetchSubtitle: (url: string): Promise<string> => ipcRenderer.invoke('subtitle:fetch', url),
  getUpdaterStatus: (): Promise<UpdaterStatus> => ipcRenderer.invoke('updater:status'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('updater:install'),
  onUpdaterStatus: (cb: (status: UpdaterStatus) => void): (() => void) => {
    const listener = (_e: unknown, status: UpdaterStatus): void => cb(status)
    ipcRenderer.on('updater:status', listener)
    return () => ipcRenderer.removeListener('updater:status', listener)
  }
}

export type PreloadApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
