// Typed updater IPC — the one native surface with enough shape (a status
// type + an event stream) to be worth its own module. Everything else talks
// to Tauri via a plain typed `invoke` at the call site (see #12 in AUDIT.md).
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export type UpdaterStatus =
  | { state: 'idle' | 'checking' | 'not-available' }
  | { state: 'available' | 'downloaded'; version: string }
  | { state: 'error'; message: string }

export const getUpdaterStatus = (): Promise<UpdaterStatus> => invoke('updater_get_status')
export const installUpdate = (): Promise<void> => invoke('updater_install')

export function onUpdaterStatus(cb: (status: UpdaterStatus) => void): () => void {
  const unlisten = listen<UpdaterStatus>('updater://status', ({ payload }) => cb(payload))
  return () => void unlisten.then((un) => un())
}
