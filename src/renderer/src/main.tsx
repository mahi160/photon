import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { useSession } from './stores/session'
import { useSettings } from './stores/settings'
import { setClientVersion, setDeviceName } from './lib/jellyfin'
import { applyCustomColors } from './lib/theme'
import { invoke } from '@tauri-apps/api/core'

function applyAppearance(): void {
  const settings = useSettings.getState()
  document.documentElement.dataset.theme = settings.theme
  applyCustomColors(settings.customColors)
}

applyAppearance()
useSettings.subscribe(applyAppearance)

const queryClient = new QueryClient({
  defaultOptions: {
    // refetchOnWindowFocus: window lives for days, coming back is the "what's new on server" moment (Home's Recently Added otherwise never refreshes); staleTime still throttles quick alt-tabs
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true }
  }
})

// restore session before router mounts so auth guards see real state; render must not depend on non-essential app_version IPC
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

// same deal -- hostname is only used for the auth header's Device= field, not worth blocking first render on
invoke<string>('device_name')
  .then(setDeviceName)
  .catch(() => {})
