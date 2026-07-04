import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  sessionGet: (): Promise<string | null> => ipcRenderer.invoke('session:get'),
  sessionSet: (value: string): Promise<boolean> => ipcRenderer.invoke('session:set', value),
  sessionClear: (): Promise<void> => ipcRenderer.invoke('session:clear'),
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  setLoginItem: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('app:setLoginItem', enabled),
  getLoginItem: (): Promise<boolean> => ipcRenderer.invoke('app:getLoginItem'),
  setHwAccel: (enabled: boolean): Promise<void> => ipcRenderer.invoke('app:setHwAccel', enabled),
  getHwAccel: (): Promise<boolean> => ipcRenderer.invoke('app:getHwAccel'),
  mpvPlay: (opts: { url: string; start: number; title: string }): Promise<boolean> =>
    ipcRenderer.invoke('mpv:play', opts),
  mpvStatus: (): Promise<{ running: boolean; timePos: number; paused: boolean }> =>
    ipcRenderer.invoke('mpv:status'),
  mpvStop: (): Promise<void> => ipcRenderer.invoke('mpv:stop'),
  mpvCheck: (): Promise<boolean> => ipcRenderer.invoke('mpv:check'),
  fetchSubtitle: (url: string): Promise<string> => ipcRenderer.invoke('subtitle:fetch', url)
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
