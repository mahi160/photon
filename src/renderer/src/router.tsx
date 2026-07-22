import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect
} from '@tanstack/react-router'
import { useSession } from './stores/session'
import { RouteError, RouteNotFound } from './components/RouteFallback'
import { AppLayout } from './pages/AppLayout'
import { Login } from './pages/Login'
import { Home } from './pages/Home'
import { Movies } from './pages/Movies'
import { Shows } from './pages/Shows'
import { Search } from './pages/Search'
// heavy pages load lazily — the shell (login/home/library/search) stays in the
// entry chunk; defaultPreload:'intent' prefetches these on link hover anyway.
// Player especially: it pulls the whole player/ dir.
const MovieDetails = lazyRouteComponent(() => import('./pages/MovieDetails'), 'MovieDetails')
const ShowDetails = lazyRouteComponent(() => import('./pages/ShowDetails'), 'ShowDetails')
const Player = lazyRouteComponent(() => import('./pages/Player'), 'Player')
const Settings = lazyRouteComponent(() => import('./pages/Settings'), 'Settings')

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
const movieDetailsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/movies/$itemId',
  component: MovieDetails,
  // surprise=1: arrived via "Surprise me" — details page runs a cancellable
  // auto-play countdown
  validateSearch: (search: Record<string, unknown>): { surprise?: boolean } =>
    search.surprise ? { surprise: true } : {}
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
      movieDetailsRoute,
      showDetailsRoute
    ]),
    playerRoute
  ])
])

// hash history: the packaged app loads index.html via file://, where
// window.location.pathname is the absolute disk path, not '/' — browser
// history (the default) tries to match that as a route and fails with a
// blank "Not Found" screen. Hash history ignores the file:// path entirely.
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: RouteNotFound,
  history: createHashHistory()
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
