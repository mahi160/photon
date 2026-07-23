import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { Play } from 'reicon-react'
import { useQuery } from '@tanstack/react-query'
import { itemQuery } from '../lib/queries'
import { backdropUrl, imageUrl, mediaBadges, ticksToSeconds } from '../lib/jellyfin'
import { WatchedButton } from '../components/WatchedButton'
import {
  DetailsError,
  DetailsHero,
  DetailsLoading,
  DetailsMeta,
  DetailsPoster,
  DetailsTitleRow
} from './DetailsShell'
import styles from './Details.module.css'

function fmtRuntime(ticks?: number): string {
  const min = Math.round(ticksToSeconds(ticks) / 60)
  return min ? `${Math.floor(min / 60)}h ${min % 60}m` : ''
}

export function MovieDetails(): React.JSX.Element {
  const { itemId } = useParams({ from: '/app/shell/movies/$itemId' })
  const { surprise } = useSearch({ from: '/app/shell/movies/$itemId' })
  const navigate = useNavigate()
  const { data: item, isPending, isError, refetch } = useQuery(itemQuery(itemId))
  const [audio, setAudio] = useState<number | undefined>()
  const [sub, setSub] = useState<number | undefined>()

  // "Surprise me" countdown: auto-plays unless cancelled; waits for the item
  const [countdown, setCountdown] = useState<number | null>(surprise ? 5 : null)
  useEffect(() => {
    if (countdown === null || !item) return
    if (countdown <= 0) {
      const pos = ticksToSeconds(item.UserData?.PlaybackPositionTicks)
      navigate({
        to: '/player/$itemId',
        params: { itemId: item.Id },
        search: { start: pos > 60 ? pos : 0 }
      })
      return
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000)
    return () => clearTimeout(t)
  }, [countdown, item, navigate])

  if (isPending) return <DetailsLoading />
  if (isError || !item) return <DetailsError onRetry={() => refetch()} />

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
  const badges = mediaBadges(streams)

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
      <DetailsHero backdrop={backdrop} />
      <div className={styles.content}>
        <div className={styles.top}>
          <DetailsPoster poster={poster} />
          <div className={styles.info}>
            <DetailsTitleRow item={item} />
            <DetailsMeta item={item} meta={meta} />
            {badges.length > 0 && (
              <div className={styles.badges}>
                {badges.map((b) => (
                  <span key={b} className={styles.badge}>
                    {b}
                  </span>
                ))}
              </div>
            )}
            {countdown !== null && (
              <div className={styles.surpriseBar}>
                <span>
                  Playing in {countdown}… <span className={styles.surpriseHint}>surprise pick</span>
                </span>
                <button onClick={() => setCountdown(null)} className={styles.playSecondary}>
                  Cancel
                </button>
              </div>
            )}
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
              <WatchedButton
                item={item}
                className={styles.iconToggle}
                activeClassName={styles.iconToggleActive}
              />
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
