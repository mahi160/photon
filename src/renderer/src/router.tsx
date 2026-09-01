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
import { Search } from './pages/Search'
// heavy pages lazy-load; shell stays in entry chunk, defaultPreload:'intent' prefetches on hover. Player pulls whole player/ dir.
// Movies/Shows lazy too (not just "heavy"): they read useSearch({from:...}) for the URL-persisted
// sort (#33), which needs the Register type from `router` below -- eagerly importing a component
// that reads its own route's types back out of the router being defined is a circular type
// dependency; lazyRouteComponent's wrapper type breaks the cycle the same way it already does for
// MovieDetails/EpisodeDetails/ShowDetails.
const Movies = lazyRouteComponent(() => import('./pages/Movies'), 'Movies')
const Shows = lazyRouteComponent(() => import('./pages/Shows'), 'Shows')
const MovieDetails = lazyRouteComponent(() => import('./pages/MovieDetails'), 'MovieDetails')
const ShowDetails = lazyRouteComponent(() => import('./pages/ShowDetails'), 'ShowDetails')
const EpisodeDetails = lazyRouteComponent(() => import('./pages/EpisodeDetails'), 'EpisodeDetails')
const Player = lazyRouteComponent(() => import('./pages/Player'), 'Player')
const Settings = lazyRouteComponent(() => import('./pages/Settings'), 'Settings')
const SettingsSectionPanel = lazyRouteComponent(
  () => import('./pages/Settings'),
  'SettingsSectionPanel'
)

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

// below requires a session
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: () => {
    if (useSession.getState().status !== 'signedIn') throw redirect({ to: '/login' })
  },
  component: Outlet
})

// browsing screens share sidebar layout
const shellRoute = createRoute({
  getParentRoute: () => appRoute,
  id: 'shell',
  component: AppLayout
})

const homeRoute = createRoute({ getParentRoute: () => shellRoute, path: '/', component: Home })
// sort persisted in the URL, not a store -- free deep link/back-forward instead of it silently
// resetting to 'added' on every navigation away and back (#33)
const moviesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/movies',
  component: Movies,
  validateSearch: (search: Record<string, unknown>): { sort?: 'added' | 'name' | 'release' } =>
    search.sort === 'name' || search.sort === 'release' ? { sort: search.sort } : {}
})
const showsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/shows',
  component: Shows,
  validateSearch: (search: Record<string, unknown>): { sort?: 'added' | 'name' | 'release' } =>
    search.sort === 'name' || search.sort === 'release' ? { sort: search.sort } : {}
})
const searchRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/search',
  component: Search
})
// Settings sidebar is a shell (component: Settings, renders <Outlet/>) -- each section is its
// own child route now, not a store-persisted string swapped client-side (#9): deep links work,
// Back from a panel returns to the previous section instead of exiting Settings entirely.
const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings',
  component: Settings
})
const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/settings/$section', params: { section: 'general' } })
  }
})
const settingsSectionRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '$section',
  component: SettingsSectionPanel
})
const movieDetailsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/movies/$itemId',
  component: MovieDetails,
  // surprise=1: arrived via "Surprise me" — details page runs cancellable auto-play countdown
  validateSearch: (search: Record<string, unknown>): { surprise?: boolean } =>
    search.surprise ? { surprise: true } : {}
})
const showDetailsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/shows/$seriesId',
  component: ShowDetails
})
const episodeDetailsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/episode/$itemId',
  component: EpisodeDetails
})

// player is chrome-free, outside shell
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
      settingsRoute.addChildren([settingsIndexRoute, settingsSectionRoute]),
      movieDetailsRoute,
      showDetailsRoute,
      episodeDetailsRoute
    ]),
    playerRoute
  ])
])

// hash history: packaged app loads index.html via file://, pathname is disk path not '/' — browser history 404s on it, hash history ignores it.
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: RouteNotFound,
  history: createHashHistory(),
  // native View Transitions crossfade routes -- no-ops on webviews without document.startViewTransition (older WebKitGTK)
  defaultViewTransition: true,
  // AppLayout's .main is the real scrolling ancestor, not the window (data-scroll-root) --
  // router restores per-element scroll offset there via its own data-scroll-restoration-id
  // registration (see useElementScrollRestoration in AppLayout.tsx). Without this, Back from
  // a details page always dumped you at row 1 of the library (#4).
  scrollRestoration: true
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
