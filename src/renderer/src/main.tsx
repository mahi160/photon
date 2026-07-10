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
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false }
  }
})

// restore session before the router mounts so auth guards see the real state;
// runs alongside the real app version so the very first API call already
// carries it instead of the "1.0.0" placeholder
Promise.all([useSession.getState().restore(), window.api.appVersion().then(setClientVersion)]).then(
  () => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StrictMode>
    )
  }
)
