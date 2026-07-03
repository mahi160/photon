import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect
} from '@tanstack/react-router'
import { useSession } from './stores/session'
import { AppLayout } from './pages/AppLayout'
import { Login } from './pages/Login'
import { Home } from './pages/Home'
import { Movies } from './pages/Movies'
import { Shows } from './pages/Shows'
import { Search } from './pages/Search'
import { MovieDetails } from './pages/MovieDetails'
import { ShowDetails } from './pages/ShowDetails'
import { Player } from './pages/Player'
import { Settings } from './pages/Settings'
import { Shortcuts } from './pages/Shortcuts'

const rootRoute = createRootRoute({
  component: Outlet
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
  beforeLoad: () => {
    if (useSession.getState().status === 'signedIn') throw redirect({ to: '/' })
  }
})

// everything below requires a session
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: () => {
    if (useSession.getState().status !== 'signedIn') throw redirect({ to: '/login' })
  },
  component: Outlet
})

// browsing screens share the sidebar layout
const shellRoute = createRoute({
  getParentRoute: () => appRoute,
  id: 'shell',
  component: AppLayout
})

const homeRoute = createRoute({ getParentRoute: () => shellRoute, path: '/', component: Home })
const moviesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/movies',
  component: Movies
})
const showsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/shows',
  component: Shows
})
const searchRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/search',
  component: Search
})
const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings',
  component: Settings
})
const shortcutsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/shortcuts',
  component: Shortcuts
})
const movieDetailsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/movies/$itemId',
  component: MovieDetails
})
const showDetailsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/shows/$seriesId',
  component: ShowDetails
})

// player is chrome-free, outside the shell
const playerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/player/$itemId',
  component: Player,
  validateSearch: (
    search: Record<string, unknown>
  ): { start?: number; audio?: number; sub?: number } => {
    const out: { start?: number; audio?: number; sub?: number } = {}
    if (typeof search.start === 'number') out.start = search.start
    if (typeof search.audio === 'number') out.audio = search.audio
    if (typeof search.sub === 'number') out.sub = search.sub
    return out
  }
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    shellRoute.addChildren([
      homeRoute,
      moviesRoute,
      showsRoute,
      searchRoute,
      settingsRoute,
      shortcutsRoute,
      movieDetailsRoute,
      showDetailsRoute
    ]),
    playerRoute
  ])
])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
