import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { Tooltip } from '@base-ui/react/tooltip'
import { router } from './router'
import { useSession } from './stores/session'
import { useSettings } from './stores/settings'
import { setClientVersion, setDeviceName } from './lib/jellyfin'
import { applyCustomColors, resolveTheme } from './lib/theme'
import { invoke } from '@tauri-apps/api/core'

function applyAppearance(): void {
  const settings = useSettings.getState()
  document.documentElement.dataset.theme = resolveTheme(settings.theme)
  applyCustomColors(settings.customColors)
}

applyAppearance()
// only re-applies when theme/customColors actually change -- a plain subscribe() fired on every
// store write, including lastVolume/lastSpeed/lastSubtitleDelay written on every playback tick,
// each re-running 7 setProperty/removeProperty calls on documentElement for nothing (#25)
let lastAppearanceKey =
  useSettings.getState().theme + JSON.stringify(useSettings.getState().customColors)
useSettings.subscribe((s) => {
  const key = s.theme + JSON.stringify(s.customColors)
  if (key === lastAppearanceKey) return
  lastAppearanceKey = key
  applyAppearance()
})
// 'auto' theme follows the OS live, not just at launch (#18)
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useSettings.getState().theme === 'auto') applyAppearance()
})

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
          {/* shared delay group: sweeping across the dock's icon buttons waits once, not once per
              button (#21) -- highest polish-per-line change in the whole audit */}
          <Tooltip.Provider delay={600} closeDelay={0} timeout={400}>
            <RouterProvider router={router} />
          </Tooltip.Provider>
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
