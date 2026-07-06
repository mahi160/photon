import { useState } from 'react'
import { useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { CaretLeftIcon, PlayIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { itemQuery } from '../lib/queries'
import { backdropUrl, imageUrl, ticksToSeconds } from '../lib/jellyfin'
import styles from './Details.module.css'

function fmtRuntime(ticks?: number): string {
  const min = Math.round(ticksToSeconds(ticks) / 60)
  return min ? `${Math.floor(min / 60)}h ${min % 60}m` : ''
}

function BackButton(): React.JSX.Element {
  const router = useRouter()
  return (
    <button onClick={() => router.history.back()} className={styles.back}>
      <CaretLeftIcon weight="bold" />
      Back
    </button>
  )
}

export function MovieDetails(): React.JSX.Element {
  const { itemId } = useParams({ from: '/app/shell/movies/$itemId' })
  const navigate = useNavigate()
  const { data: item, isPending, isError, refetch } = useQuery(itemQuery(itemId))
  const [audio, setAudio] = useState<number | undefined>()
  const [sub, setSub] = useState<number | undefined>()

  if (isPending) return <div className={styles.loading}>Loading…</div>
  if (isError || !item)
    return (
      <div className={styles.errorState}>
        Cannot reach server.{' '}
        <button onClick={() => refetch()} className={styles.playPrimary}>
          Retry
        </button>
      </div>
    )

  const poster = imageUrl(item, 480)
  const backdrop = backdropUrl(item, 1280)
  const position = ticksToSeconds(item.UserData?.PlaybackPositionTicks)
  const streams = item.MediaSources?.[0]?.MediaStreams ?? []
  const audioStreams = streams.filter((s) => s.Type === 'Audio')
  const subtitleStreams = streams.filter((s) => s.Type === 'Subtitle')

  const meta = [
    item.ProductionYear,
    item.RunTimeTicks ? fmtRuntime(item.RunTimeTicks) : null,
    item.OfficialRating
  ].filter(Boolean)

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

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        {backdrop && <img src={backdrop} alt="" className={styles.heroImg} />}
        <div className={styles.heroScrim} />
        <BackButton />
      </div>
      <div className={styles.content}>
        <div className={styles.top}>
          <div className={styles.poster}>
            {poster ? (
              <img src={poster} alt="" className={styles.posterImg} />
            ) : (
              <div className={styles.posterPlaceholder} />
            )}
          </div>
          <div className={styles.info}>
            <h1 className={styles.title}>{item.Name}</h1>
            <div className={styles.meta}>
              {meta.map((m) => (
                <span key={String(m)}>{m}</span>
              ))}
            </div>
            <p className={styles.overview}>{item.Overview}</p>
            <div className={styles.actions}>
              {position > 60 && (
                <button onClick={() => play(position)} className={styles.playPrimary}>
                  <PlayIcon weight="fill" />
                  Resume
                </button>
              )}
              <button
                onClick={() => play(0)}
                className={position > 60 ? styles.playSecondary : styles.playPrimary}
              >
                {position <= 60 && <PlayIcon weight="fill" />}
                {position > 60 ? 'Play from start' : 'Play'}
              </button>
            </div>
            {(audioStreams.length > 1 || subtitleStreams.length > 0) && (
              <div className={styles.tracks}>
                {audioStreams.length > 1 && (
                  <select
                    className={styles.select}
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
                    className={styles.select}
                    value={sub ?? ''}
                    onChange={(e) =>
                      setSub(e.target.value === '' ? undefined : Number(e.target.value))
                    }
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
      </div>
    </div>
  )
}
