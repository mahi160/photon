import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { CaretLeft, Clapperboard, Play } from 'reicon-react'
import type { BaseItem, MediaStream } from '../lib/jellyfin'
import { Ratings } from '../components/Ratings'
import { FavoriteButton } from '../components/FavoriteButton'
import { WatchedButton } from '../components/WatchedButton'
import { Select } from '../components/Select'
import { Status } from '../components/Status'
import styles from './Details.module.css'

// Shared shell between MovieDetails/ShowDetails (hero, poster, title/favorite row, meta row, loading/error) -- content below diverges per page, only identical wrapping lives here.

export function DetailsLoading(): React.JSX.Element {
  return (
    <div className={styles.page}>
      <div className={styles.heroSkeleton} />
      <div className={styles.content}>
        <div className={styles.top}>
          <div className={styles.poster}>
            <div className={styles.posterSkeleton} />
          </div>
          <div className={styles.info}>
            <div className={`${styles.line} ${styles.lineTitle}`} />
            <div className={`${styles.line} ${styles.lineShort}`} />
            <div className={styles.line} />
            <div className={styles.line} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function DetailsError({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return <Status message="Cannot reach server." onRetry={onRetry} className={styles.errorState} />
}

export function BackButton(): React.JSX.Element {
  const router = useRouter()
  return (
    <button onClick={() => router.history.back()} className={styles.back}>
      <CaretLeft />
      Back
    </button>
  )
}

export function DetailsHero({
  backdrop
}: {
  backdrop: string | null | undefined
}): React.JSX.Element {
  return (
    <>
      {/* ambient wash: same backdrop, blurred, bleeds past hero's clipped bounds into .content -- needs .page as positioned ancestor not .hero, see .page/.ambient */}
      {backdrop && (
        <div className={styles.ambient} aria-hidden="true">
          <img src={backdrop} alt="" decoding="async" className={styles.ambientImg} />
        </div>
      )}
      <div className={styles.hero}>
        {backdrop ? (
          <img
            src={backdrop}
            alt=""
            fetchPriority="high"
            decoding="async"
            className={styles.heroImg}
          />
        ) : (
          <div className={styles.heroPlaceholder}>
            <Clapperboard className={styles.heroPlaceholderIcon} />
          </div>
        )}
        <div className={styles.heroScrim} />
        <BackButton />
      </div>
    </>
  )
}

export function DetailsPoster({
  poster,
  vt
}: {
  poster: string | null | undefined
  vt?: string // shared-element transition name, matches the clicked Card's poster (#34)
}): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className={styles.poster}>
      {poster ? (
        <img
          src={poster}
          alt=""
          decoding="async"
          style={vt ? ({ viewTransitionName: vt } as React.CSSProperties) : undefined}
          className={`${styles.posterImg} ${loaded ? styles.imageLoaded : ''}`}
          onLoad={() => setLoaded(true)}
        />
      ) : (
        <div className={styles.posterPlaceholder}>
          <Clapperboard className={styles.posterPlaceholderIcon} />
        </div>
      )}
    </div>
  )
}

export function DetailsTitleRow({ item }: { item: BaseItem }): React.JSX.Element {
  return (
    <div className={styles.titleRow}>
      <h1 className={styles.title}>{item.Name}</h1>
      <FavoriteButton
        item={item}
        className={styles.favoriteBtn}
        activeClassName={styles.favoriteBtnActive}
      />
    </div>
  )
}

export function DetailsMeta({
  item,
  meta
}: {
  item: BaseItem
  meta: (string | number | null | undefined)[]
}): React.JSX.Element {
  return (
    <div className={styles.meta}>
      {meta.filter(Boolean).map((m) => (
        <span key={String(m)}>{m}</span>
      ))}
      <Ratings item={item} />
    </div>
  )
}

// Resume/Play/Watched row -- identical across MovieDetails/EpisodeDetails (#30)
export function DetailsActions({
  item,
  position,
  onPlay
}: {
  item: Pick<BaseItem, 'Id' | 'UserData'>
  position: number
  onPlay: (start: number) => void
}): React.JSX.Element {
  return (
    <div className={styles.actions}>
      {position > 60 && (
        <button onClick={() => onPlay(position)} className={styles.playPrimary}>
          <Play weight="Filled" />
          Resume
        </button>
      )}
      <button
        onClick={() => onPlay(0)}
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
  )
}

// audio/subtitle track override pickers -- identical across MovieDetails/EpisodeDetails (#30)
export function DetailsTrackPickers({
  audioStreams,
  subtitleStreams,
  audio,
  sub,
  onAudio,
  onSub
}: {
  audioStreams: MediaStream[]
  subtitleStreams: MediaStream[]
  audio: number | undefined
  sub: number | undefined
  onAudio: (i: number | undefined) => void
  onSub: (i: number | undefined) => void
}): React.JSX.Element | null {
  if (audioStreams.length <= 1 && subtitleStreams.length === 0) return null
  return (
    <div className={styles.tracks}>
      {audioStreams.length > 1 && (
        <Select
          ariaLabel="Audio track"
          value={audio}
          onChange={onAudio}
          options={[
            { value: undefined, label: 'Audio: Default' },
            ...audioStreams.map((s) => ({
              value: s.Index,
              label: s.DisplayTitle ?? `Audio ${s.Index}`
            }))
          ]}
        />
      )}
      {subtitleStreams.length > 0 && (
        <Select
          ariaLabel="Subtitles"
          value={sub}
          onChange={onSub}
          options={[
            { value: undefined, label: 'Subtitles: Default' },
            ...subtitleStreams.map((s) => ({
              value: s.Index,
              label: s.DisplayTitle ?? `Subtitle ${s.Index}`
            }))
          ]}
        />
      )}
    </div>
  )
}
