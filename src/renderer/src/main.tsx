import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { useSession } from './stores/session'
import { useSettings } from './stores/settings'
import { resolveTheme } from './lib/theme'
import { setClientVersion } from './lib/jellyfin'
import { invoke } from '@tauri-apps/api/core'

function applyAppearance(): void {
  const s = useSettings.getState()
  document.documentElement.dataset.theme = resolveTheme(s.theme)
}

applyAppearance()
useSettings.subscribe(applyAppearance)
// follow OS theme changes while in 'system' mode
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance)

const queryClient = new QueryClient({
  defaultOptions: {
    // refetchOnWindowFocus: the app window lives for days — coming back to it
    // is the natural "show me what's new on the server" moment (Home's
    // Recently Added otherwise never refreshes without a route change).
    // staleTime still throttles: a quick alt-tab within 30s refetches nothing.
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true }
  }
})

// restore session before the router mounts so auth guards see the real state.
// render must not depend on the (non-essential) app version call — if that
// IPC rejects, the app must still mount.
useSession
  .getState()
  .restore()
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StrictMode>
    )
  })

// fire-and-forget: version string is cosmetic, fetched in parallel
invoke<string>('app_version')
  .then(setClientVersion)
  .catch(() => {})
