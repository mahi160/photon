import { useState } from 'react'
import { useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { CaretLeft, Check, Heart, Play } from 'reicon-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { itemQuery, setFavorite, setPlayed } from '../lib/queries'
import { queryKeys } from '../lib/queryKeys'
import { backdropUrl, imageUrl, ticksToSeconds } from '../lib/jellyfin'
import { Tip } from '../components/Tip'
import styles from './Details.module.css'

function fmtRuntime(ticks?: number): string {
  const min = Math.round(ticksToSeconds(ticks) / 60)
  return min ? `${Math.floor(min / 60)}h ${min % 60}m` : ''
}

function BackButton(): React.JSX.Element {
  const router = useRouter()
  return (
    <button onClick={() => router.history.back()} className={styles.back}>
      <CaretLeft />
      Back
    </button>
  )
}

export function MovieDetails(): React.JSX.Element {
  const { itemId } = useParams({ from: '/app/shell/movies/$itemId' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: item, isPending, isError, refetch } = useQuery(itemQuery(itemId))
  const [audio, setAudio] = useState<number | undefined>()
  const [sub, setSub] = useState<number | undefined>()

  const toggleWatched = useMutation({
    mutationFn: (next: boolean) => setPlayed(itemId, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.all() })
  })

  const toggleFavorite = useMutation({
    mutationFn: (next: boolean) => setFavorite(itemId, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.all() })
  })

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
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{item.Name}</h1>
              <Tip label={item.UserData?.IsFavorite ? 'Remove from favorites' : 'Add to favorites'}>
                <button
                  onClick={() => toggleFavorite.mutate(!item.UserData?.IsFavorite)}
                  aria-label={
                    item.UserData?.IsFavorite ? 'Remove from favorites' : 'Add to favorites'
                  }
                  aria-pressed={!!item.UserData?.IsFavorite}
                  className={`${styles.favoriteBtn} ${item.UserData?.IsFavorite ? styles.favoriteBtnActive : ''}`}
                >
                  <Heart weight={item.UserData?.IsFavorite ? 'Filled' : 'Outline'} />
                </button>
              </Tip>
            </div>
            <div className={styles.meta}>
              {meta.map((m) => (
                <span key={String(m)}>{m}</span>
              ))}
            </div>
            <p className={styles.overview}>{item.Overview}</p>
            <div className={styles.actions}>
              {position > 60 && (
                <button onClick={() => play(position)} className={styles.playPrimary}>
                  <Play weight="Filled" />
                  Resume
                </button>
              )}
              <button
                onClick={() => play(0)}
                className={position > 60 ? styles.playSecondary : styles.playPrimary}
              >
                {position <= 60 && <Play weight="Filled" />}
                {position > 60 ? 'Play from start' : 'Play'}
              </button>
              <Tip label={item.UserData?.Played ? 'Mark unwatched' : 'Mark watched'}>
                <button
                  onClick={() => toggleWatched.mutate(!item.UserData?.Played)}
                  aria-label={item.UserData?.Played ? 'Mark unwatched' : 'Mark watched'}
                  aria-pressed={!!item.UserData?.Played}
                  className={`${styles.iconToggle} ${item.UserData?.Played ? styles.iconToggleActive : ''}`}
                >
                  <Check />
                </button>
              </Tip>
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
