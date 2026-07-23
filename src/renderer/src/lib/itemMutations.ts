/* eslint-disable @typescript-eslint/explicit-function-return-type -- useMutation's inferred return type is the useful one here */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { setFavorite, setPlayed } from './queries'
import { queryKeys } from './queryKeys'
import type { BaseItem, UserData } from './jellyfin'

// Patches the toggled item's UserData in every cached query instead of
// invalidating queryKeys.all() -- that refetches the entire library (and the
// staleTime:Infinity search index) on a single heart/check click. Shared by
// every favorite/watched toggle in the app (Card, MovieDetails, ShowDetails,
// episode rows) so this fix can't go stale in just one of them again.
export function patchUserData(qc: QueryClient, itemId: string, patch: Partial<UserData>): void {
  const patchOne = (it: BaseItem): BaseItem =>
    it.Id === itemId ? { ...it, UserData: { ...it.UserData, ...patch } } : it
  qc.setQueriesData({ queryKey: queryKeys.all() }, (data: unknown) => {
    if (Array.isArray(data)) return data.map(patchOne)
    if (data && typeof data === 'object' && 'Id' in data) return patchOne(data as BaseItem)
    return data
  })
}

export function useToggleFavorite(item: Pick<BaseItem, 'Id'>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (next: boolean) => setFavorite(item.Id, next),
    onSuccess: (_data, next) => patchUserData(qc, item.Id, { IsFavorite: next })
  })
}

export function useToggleWatched(item: Pick<BaseItem, 'Id'>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (next: boolean) => setPlayed(item.Id, next),
    onSuccess: (_data, next) => {
      patchUserData(qc, item.Id, {
        Played: next,
        PlayedPercentage: undefined,
        PlaybackPositionTicks: 0
      })
      // membership of these rows actually changes when watched state flips
      qc.invalidateQueries({ queryKey: queryKeys.resume() })
      qc.invalidateQueries({ queryKey: queryKeys.nextUp.all() })
    }
  })
}
