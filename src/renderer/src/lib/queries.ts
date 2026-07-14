/* eslint-disable @typescript-eslint/explicit-function-return-type -- queryOptions types are inferred */
import { queryOptions } from '@tanstack/react-query'
import { currentSession, jf, type BaseItem, type ItemsResult, type MediaSegment } from './jellyfin'
import { queryKeys } from './queryKeys'

function userId(): string {
  const s = currentSession()
  if (!s) throw new Error('Not signed in')
  return s.userId
}

export function setPlayed(itemId: string, played: boolean): Promise<void> {
  return jf<void>(`/Users/${userId()}/PlayedItems/${itemId}`, {
    method: played ? 'POST' : 'DELETE'
  })
}

export function setFavorite(itemId: string, favorite: boolean): Promise<void> {
  return jf<void>(`/Users/${userId()}/FavoriteItems/${itemId}`, {
    method: favorite ? 'POST' : 'DELETE'
  })
}

export const resumeItemsQuery = queryOptions({
  queryKey: queryKeys.resume(),
  queryFn: () =>
    jf<ItemsResult>(`/Users/${userId()}/Items/Resume`, {
      query: {
        Limit: 20,
        Recursive: true,
        Fields: 'Overview',
        MediaTypes: 'Video'
      }
    }).then((r) => r.Items)
})

// next episodes across all in-progress shows (home row)
export const nextUpItemsQuery = queryOptions({
  queryKey: queryKeys.nextUp.allSeries(),
  queryFn: () =>
    jf<ItemsResult>('/Shows/NextUp', {
      query: { userId: userId(), Limit: 12 }
    }).then((r) => r.Items)
})

export const latestMoviesQuery = queryOptions({
  queryKey: queryKeys.latest.movies(),
  queryFn: () =>
    jf<BaseItem[]>(`/Users/${userId()}/Items/Latest`, {
      query: { IncludeItemTypes: 'Movie', Limit: 20, Fields: 'DateCreated' }
    })
})

export const latestShowsQuery = queryOptions({
  queryKey: queryKeys.latest.shows(),
  queryFn: () =>
    jf<BaseItem[]>(`/Users/${userId()}/Items/Latest`, {
      query: { IncludeItemTypes: 'Series', Limit: 20, Fields: 'DateCreated' }
    })
})

export type SortKey = 'added' | 'name' | 'release'

const sortParams: Record<SortKey, { SortBy: string; SortOrder: string }> = {
  added: { SortBy: 'DateCreated', SortOrder: 'Descending' },
  name: { SortBy: 'SortName', SortOrder: 'Ascending' },
  release: { SortBy: 'PremiereDate', SortOrder: 'Descending' }
}

// merged across all libraries of the type — library boundaries are invisible (see PRD)
export const libraryQuery = (type: 'Movie' | 'Series', sort: SortKey) =>
  queryOptions({
    queryKey: type === 'Movie' ? queryKeys.library.movies(sort) : queryKeys.library.shows(sort),
    queryFn: () =>
      jf<ItemsResult>(`/Items`, {
        query: {
          userId: userId(),
          IncludeItemTypes: type,
          Recursive: true,
          Fields: 'ProductionYear,DateCreated',
          ...sortParams[sort]
        }
      }).then((r) => r.Items)
  })

// lightweight local search index: all movies + series, once per launch (ADR-0001)
export const searchIndexQuery = queryOptions({
  queryKey: queryKeys.search.index(),
  staleTime: Infinity,
  queryFn: () =>
    jf<ItemsResult>(`/Items`, {
      query: {
        userId: userId(),
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        SortBy: 'SortName',
        // results render as Cards (poster + progress), so UserData/ImageTags
        // must stay — but only the Primary image tag is ever used
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary'
      }
    }).then((r) => r.Items)
})

// episodes searched server-side (ADR-0001)
export const episodeSearchQuery = (term: string) =>
  queryOptions({
    queryKey: queryKeys.search.episodes(term),
    enabled: term.length >= 2,
    queryFn: () =>
      jf<ItemsResult>(`/Items`, {
        query: {
          userId: userId(),
          searchTerm: term,
          IncludeItemTypes: 'Episode',
          Recursive: true,
          Limit: 24
        }
      }).then((r) => r.Items)
  })

export const itemQuery = (itemId: string) =>
  queryOptions({
    queryKey: queryKeys.item.detail(itemId),
    queryFn: () =>
      jf<BaseItem>(`/Users/${userId()}/Items/${itemId}`, {
        query: { Fields: 'Overview,MediaSources,Chapters,Trickplay' }
      })
  })

// server-detected intro/outro ranges; retry:false — a 404 here just means
// the server predates 10.9 or hasn't analyzed this item, not a real failure
export const mediaSegmentsQuery = (itemId: string) =>
  queryOptions({
    queryKey: queryKeys.item.segments(itemId),
    retry: false,
    queryFn: () =>
      jf<{ Items: MediaSegment[] }>(`/MediaSegments/${itemId}`)
        .then((r) => r.Items)
        .catch(() => [] as MediaSegment[])
  })

export const seasonsQuery = (seriesId: string) =>
  queryOptions({
    queryKey: queryKeys.seasons.detail(seriesId),
    queryFn: () =>
      jf<ItemsResult>(`/Shows/${seriesId}/Seasons`, {
        query: { userId: userId() }
      }).then((r) => r.Items)
  })

export const episodesQuery = (seriesId: string, seasonId: string) =>
  queryOptions({
    queryKey: queryKeys.episodes.detail(seriesId, seasonId),
    queryFn: () =>
      jf<ItemsResult>(`/Shows/${seriesId}/Episodes`, {
        query: { userId: userId(), seasonId, Fields: 'Overview' }
      }).then((r) => r.Items)
  })

export const nextUpQuery = (seriesId: string) =>
  queryOptions({
    queryKey: queryKeys.nextUp.series(seriesId),
    queryFn: () =>
      jf<ItemsResult>(`/Shows/NextUp`, {
        query: { userId: userId(), seriesId, Limit: 1 }
      }).then((r) => r.Items[0] ?? null)
  })
