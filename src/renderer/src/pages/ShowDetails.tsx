import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { episodesQuery, itemQuery, nextUpQuery, seasonsQuery } from '../lib/queries'
import { imageUrl, ticksToSeconds, type BaseItem } from '../lib/jellyfin'

function EpisodeRow({ ep, onPlay }: { ep: BaseItem; onPlay: () => void }): React.JSX.Element {
  const pct = ep.UserData?.PlayedPercentage
  return (
    <button
      onClick={onPlay}
      className="group flex w-full items-center gap-4 rounded-xl p-2 text-left hover:bg-surface-1"
    >
      <div className="relative w-40 shrink-0 overflow-hidden rounded-lg bg-surface-2">
        <div className="aspect-video">
          {imageUrl(ep, 320) && (
            <img src={imageUrl(ep, 320)!} alt="" loading="lazy" className="h-full w-full object-cover" />
          )}
        </div>
        {pct !== undefined && pct > 0 && pct < 100 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
        )}
        {ep.UserData?.Played && (
          <div className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-accent">
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-3">
              <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
            </svg>
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-sm text-neutral-200">
          {ep.IndexNumber !== undefined ? `${ep.IndexNumber}. ` : ''}
          {ep.Name}
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-500">{ep.Overview}</p>
      </div>
    </button>
  )
}

export function ShowDetails(): React.JSX.Element {
  const { seriesId } = useParams({ from: '/app/shell/shows/$seriesId' })
  const navigate = useNavigate()
  const series = useQuery(itemQuery(seriesId))
  const seasons = useQuery(seasonsQuery(seriesId))
  const nextUp = useQuery(nextUpQuery(seriesId))
  const [seasonId, setSeasonId] = useState<string | null>(null)

  const activeSeason = seasonId ?? seasons.data?.[0]?.Id ?? null
  const episodes = useQuery({
    ...episodesQuery(seriesId, activeSeason ?? ''),
    enabled: !!activeSeason
  })

  if (series.isPending) return <div className="p-8 text-neutral-500">Loading…</div>
  if (series.isError || !series.data)
    return (
      <div className="p-8 text-neutral-400">
        Cannot reach server.{' '}
        <button onClick={() => series.refetch()} className="text-accent hover:underline">
          Retry
        </button>
      </div>
    )

  const item = series.data
  const poster = imageUrl(item, 480)
  const next = nextUp.data
  const nextResumable = next && ticksToSeconds(next.UserData?.PlaybackPositionTicks) > 60

  function play(ep: BaseItem, start?: number): void {
    navigate({
      to: '/player/$itemId',
      params: { itemId: ep.Id },
      ...(start !== undefined ? { search: { start } } : {})
    })
  }

  return (
    <div className="flex gap-10 p-10">
      <div className="w-64 shrink-0">
        {poster ? (
          <img src={poster} alt="" className="w-full rounded-2xl" />
        ) : (
          <div className="aspect-[2/3] w-full rounded-2xl bg-surface-2" />
        )}
      </div>
      <div className="min-w-0 max-w-3xl flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{item.Name}</h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-neutral-300">{item.Overview}</p>

        {next && (
          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={() => play(next)}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              {nextResumable ? 'Resume' : 'Play Next Episode'}
            </button>
            <span className="text-sm text-neutral-500">
              S{next.ParentIndexNumber}E{next.IndexNumber} · {next.Name}
            </span>
          </div>
        )}

        {(seasons.data?.length ?? 0) > 0 && (
          <div className="mt-8 flex flex-wrap gap-2">
            {seasons.data!.map((s) => (
              <button
                key={s.Id}
                onClick={() => setSeasonId(s.Id)}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  s.Id === activeSeason
                    ? 'bg-surface-3 text-white'
                    : 'bg-surface-1 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {s.Name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 space-y-1">
          {episodes.data?.map((ep) => <EpisodeRow key={ep.Id} ep={ep} onPlay={() => play(ep)} />)}
        </div>
      </div>
    </div>
  )
}
