/* eslint-disable @typescript-eslint/explicit-function-return-type -- queryOptions types are inferred */
import { queryOptions } from '@tanstack/react-query'
import { currentSession, jf, type BaseItem, type ItemsResult } from './jellyfin'

function userId(): string {
  const s = currentSession()
  if (!s) throw new Error('Not signed in')
  return s.userId
}

export const resumeItemsQuery = queryOptions({
  queryKey: ['resume'],
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
  queryKey: ['nextUp', 'all'],
  queryFn: () =>
    jf<ItemsResult>('/Shows/NextUp', {
      query: { userId: userId(), Limit: 12 }
    }).then((r) => r.Items)
})

export const latestMoviesQuery = queryOptions({
  queryKey: ['latest', 'movies'],
  queryFn: () =>
    jf<BaseItem[]>(`/Users/${userId()}/Items/Latest`, {
      query: { IncludeItemTypes: 'Movie', Limit: 20 }
    })
})

export const latestShowsQuery = queryOptions({
  queryKey: ['latest', 'shows'],
  queryFn: () =>
    jf<BaseItem[]>(`/Users/${userId()}/Items/Latest`, {
      query: { IncludeItemTypes: 'Series', Limit: 20 }
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
    queryKey: ['library', type, sort],
    queryFn: () =>
      jf<ItemsResult>(`/Items`, {
        query: {
          userId: userId(),
          IncludeItemTypes: type,
          Recursive: true,
          Fields: 'ProductionYear',
          ...sortParams[sort]
        }
      }).then((r) => r.Items)
  })

// lightweight local search index: all movies + series, once per launch (ADR-0001)
export const searchIndexQuery = queryOptions({
  queryKey: ['searchIndex'],
  staleTime: Infinity,
  queryFn: () =>
    jf<ItemsResult>(`/Items`, {
      query: {
        userId: userId(),
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        SortBy: 'SortName'
      }
    }).then((r) => r.Items)
})

// episodes searched server-side (ADR-0001)
export const episodeSearchQuery = (term: string) =>
  queryOptions({
    queryKey: ['episodeSearch', term],
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
    queryKey: ['item', itemId],
    queryFn: () =>
      jf<BaseItem>(`/Users/${userId()}/Items/${itemId}`, {
        query: { Fields: 'Overview,MediaSources,Chapters' }
      })
  })

export const seasonsQuery = (seriesId: string) =>
  queryOptions({
    queryKey: ['seasons', seriesId],
    queryFn: () =>
      jf<ItemsResult>(`/Shows/${seriesId}/Seasons`, {
        query: { userId: userId() }
      }).then((r) => r.Items)
  })

export const episodesQuery = (seriesId: string, seasonId: string) =>
  queryOptions({
    queryKey: ['episodes', seriesId, seasonId],
    queryFn: () =>
      jf<ItemsResult>(`/Shows/${seriesId}/Episodes`, {
        query: { userId: userId(), seasonId, Fields: 'Overview' }
      }).then((r) => r.Items)
  })

export const nextUpQuery = (seriesId: string) =>
  queryOptions({
    queryKey: ['nextUp', seriesId],
    queryFn: () =>
      jf<ItemsResult>(`/Shows/NextUp`, {
        query: { userId: userId(), seriesId, Limit: 1 }
      }).then((r) => r.Items[0] ?? null)
  })
