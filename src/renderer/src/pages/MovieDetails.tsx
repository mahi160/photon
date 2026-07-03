import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { itemQuery } from '../lib/queries'
import { imageUrl, ticksToSeconds } from '../lib/jellyfin'

function fmtRuntime(ticks?: number): string {
  const min = Math.round(ticksToSeconds(ticks) / 60)
  return min ? `${Math.floor(min / 60)}h ${min % 60}m` : ''
}

export function MovieDetails(): React.JSX.Element {
  const { itemId } = useParams({ from: '/app/shell/movies/$itemId' })
  const navigate = useNavigate()
  const { data: item, isPending, isError, refetch } = useQuery(itemQuery(itemId))
  const [audio, setAudio] = useState<number | undefined>()
  const [sub, setSub] = useState<number | undefined>()

  if (isPending) return <div className="p-8 text-neutral-500">Loading…</div>
  if (isError || !item)
    return (
      <div className="p-8 text-neutral-400">
        Cannot reach server.{' '}
        <button onClick={() => refetch()} className="text-accent hover:underline">
          Retry
        </button>
      </div>
    )

  const poster = imageUrl(item, 480)
  const position = ticksToSeconds(item.UserData?.PlaybackPositionTicks)
  const streams = item.MediaSources?.[0]?.MediaStreams ?? []
  const audioStreams = streams.filter((s) => s.Type === 'Audio')
  const subtitleStreams = streams.filter((s) => s.Type === 'Subtitle')

  function play(start: number): void {
    navigate({
      to: '/player/$itemId',
      params: { itemId: item!.Id },
      search: {
        start,
        ...(audio !== undefined ? { audio } : {}),
        ...(sub !== undefined ? { sub } : {})
      }
    })
  }

  const select = 'rounded-lg bg-surface-2 px-3 py-1.5 text-sm outline-none max-w-64 truncate'

  return (
    <div className="flex gap-10 p-10">
      <div className="w-64 shrink-0">
        {poster ? (
          <img src={poster} alt="" className="w-full rounded-2xl" />
        ) : (
          <div className="aspect-[2/3] w-full rounded-2xl bg-surface-2" />
        )}
      </div>
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">{item.Name}</h1>
        <div className="mt-1 text-sm text-neutral-500">
          {item.ProductionYear}
          {item.RunTimeTicks ? ` · ${fmtRuntime(item.RunTimeTicks)}` : ''}
        </div>
        <p className="mt-4 text-sm leading-relaxed text-neutral-300">{item.Overview}</p>
        <div className="mt-6 flex items-center gap-3">
          {position > 60 && (
            <button
              onClick={() => play(position)}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              Resume
            </button>
          )}
          <button
            onClick={() => play(0)}
            className={
              position > 60
                ? 'rounded-lg bg-surface-2 px-5 py-2.5 text-sm text-neutral-200 hover:bg-surface-3'
                : 'rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:opacity-90'
            }
          >
            {position > 60 ? 'Play from start' : 'Play'}
          </button>
        </div>
        {(audioStreams.length > 1 || subtitleStreams.length > 0) && (
          <div className="mt-6 flex flex-wrap gap-3">
            {audioStreams.length > 1 && (
              <select
                className={select}
                value={audio ?? ''}
                onChange={(e) =>
                  setAudio(e.target.value === '' ? undefined : Number(e.target.value))
                }
                aria-label="Audio track"
              >
                <option value="">Audio: Default</option>
                {audioStreams.map((s) => (
                  <option key={s.Index} value={s.Index}>
                    {s.DisplayTitle ?? `Audio ${s.Index}`}
                  </option>
                ))}
              </select>
            )}
            {subtitleStreams.length > 0 && (
              <select
                className={select}
                value={sub ?? ''}
                onChange={(e) => setSub(e.target.value === '' ? undefined : Number(e.target.value))}
                aria-label="Subtitles"
              >
                <option value="">Subtitles: Default</option>
                {subtitleStreams.map((s) => (
                  <option key={s.Index} value={s.Index}>
                    {s.DisplayTitle ?? `Subtitle ${s.Index}`}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
