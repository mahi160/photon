import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { useSession } from './stores/session'
import { useSettings } from './stores/settings'

function applyTheme(theme: 'dark' | 'light' | 'system'): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

applyTheme(useSettings.getState().theme)
document.documentElement.dataset.scheme = useSettings.getState().colorScheme
useSettings.subscribe((s) => {
  applyTheme(s.theme)
  document.documentElement.dataset.scheme = s.colorScheme
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false }
  }
})

// restore session before the router mounts so auth guards see the real state
useSession
  .getState()
  .restore()
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StrictMode>
    )
  })
