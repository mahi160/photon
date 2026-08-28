import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { itemQuery } from '../lib/queries'
import { backdropUrl, imageUrl, mediaBadges, ticksToSeconds } from '../lib/jellyfin'
import { humanDuration } from '../lib/format'
import { pickMediaSource } from '../player/session'
import {
  DetailsActions,
  DetailsError,
  DetailsHero,
  DetailsLoading,
  DetailsMeta,
  DetailsPoster,
  DetailsTitleRow,
  DetailsTrackPickers
} from './DetailsShell'
import styles from './Details.module.css'

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
  // same source the player itself would pick (player/session.ts's pickMediaSource) -- keeps badges/track
  // pickers here consistent with whichever version of a multi-version item actually plays
  const streams = pickMediaSource(item.MediaSources ?? [])?.MediaStreams ?? []
  const audioStreams = streams.filter((s) => s.Type === 'Audio')
  const subtitleStreams = streams.filter((s) => s.Type === 'Subtitle')

  const meta = [
    item.ProductionYear,
    item.RunTimeTicks ? humanDuration(ticksToSeconds(item.RunTimeTicks)) : null,
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
          <DetailsPoster poster={poster} vt={`poster-${item.Id}`} />
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
            <DetailsActions item={item} position={position} onPlay={play} />
            <DetailsTrackPickers
              audioStreams={audioStreams}
              subtitleStreams={subtitleStreams}
              audio={audio}
              sub={sub}
              onAudio={setAudio}
              onSub={setSub}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
