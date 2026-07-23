import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { authenticateByName, configure, type Session } from '../lib/jellyfin'

interface SessionState {
  status: 'restoring' | 'signedOut' | 'signedIn'
  session: Session | null
  restore: () => Promise<void>
  login: (server: string, username: string, password: string) => Promise<void>
  loginWith: (session: Session) => Promise<void> // pre-authenticated (Quick Connect)
  logout: () => Promise<void>
}

export const useSession = create<SessionState>((set) => ({
  status: 'restoring',
  session: null,

  restore: async () => {
    try {
      const raw = await invoke<string | null>('session_get')
      if (raw) {
        const session = JSON.parse(raw) as Session
        configure(session)
        set({ status: 'signedIn', session })
        return
      }
    } catch {
      /* fall through to signed out */
    }
    set({ status: 'signedOut', session: null })
  },

  login: async (server, username, password) => {
    const session = await authenticateByName(server, username, password)
    configure(session)
    await invoke('session_set', { value: JSON.stringify(session) })
    set({ status: 'signedIn', session })
  },

  loginWith: async (session) => {
    configure(session)
    await invoke('session_set', { value: JSON.stringify(session) })
    set({ status: 'signedIn', session })
  },

  logout: async () => {
    configure(null)
    await invoke('session_clear')
    set({ status: 'signedOut', session: null })
  }
}))
