import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  sessionGet: (): Promise<string | null> => ipcRenderer.invoke('session:get'),
  sessionSet: (value: string): Promise<boolean> => ipcRenderer.invoke('session:set', value),
  sessionClear: (): Promise<void> => ipcRenderer.invoke('session:clear')
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
