// Centralized React Query key factory; ensures consistent key structure across all queries

export const queryKeys = {
  all: () => ['photon'],
  resume: () => [...queryKeys.all(), 'resume'],
  nextUp: {
    all: () => [...queryKeys.all(), 'nextUp'],
    series: (seriesId: string) => [...queryKeys.nextUp.all(), 'series', seriesId],
    allSeries: () => [...queryKeys.nextUp.all(), 'allSeries']
  },
  latest: {
    all: () => [...queryKeys.all(), 'latest'],
    movies: () => [...queryKeys.latest.all(), 'movies'],
    shows: () => [...queryKeys.latest.all(), 'shows']
  },
  library: {
    all: () => [...queryKeys.all(), 'library'],
    movies: (sort: string) => [...queryKeys.library.all(), 'movies', sort],
    shows: (sort: string) => [...queryKeys.library.all(), 'shows', sort]
  },
  search: {
    all: () => [...queryKeys.all(), 'search'],
    index: () => [...queryKeys.search.all(), 'index'],
    episodes: (term: string) => [...queryKeys.search.all(), 'episodes', term]
  },
  item: {
    all: () => [...queryKeys.all(), 'item'],
    detail: (itemId: string) => [...queryKeys.item.all(), 'detail', itemId],
    adjacent: (itemId: string) => [...queryKeys.item.all(), 'adjacent', itemId],
    segments: (itemId: string) => [...queryKeys.item.all(), 'segments', itemId]
  },
  seasons: {
    all: () => [...queryKeys.all(), 'seasons'],
    detail: (seriesId: string) => [...queryKeys.seasons.all(), 'detail', seriesId]
  },
  episodes: {
    all: () => [...queryKeys.all(), 'episodes'],
    detail: (seriesId: string, seasonId: string) => [
      ...queryKeys.episodes.all(),
      'detail',
      seriesId,
      seasonId
    ]
  }
} as const
