import { useRouter } from '@tanstack/react-router'
import { CaretLeft } from 'reicon-react'
import type { BaseItem } from '../lib/jellyfin'
import { Ratings } from '../components/Ratings'
import { FavoriteButton } from '../components/FavoriteButton'
import styles from './Details.module.css'

// Shared shell between MovieDetails and ShowDetails: hero backdrop, poster,
// title/favorite row, meta row, and the loading/error states. Both pages'
// content genuinely diverges below this (badges/track pickers vs.
// season/episode list), so only the identical wrapping is pulled out here.

export function DetailsLoading(): React.JSX.Element {
  return <div className={styles.loading}>Loading…</div>
}

export function DetailsError({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div className={styles.errorState}>
      Cannot reach server.{' '}
      <button onClick={onRetry} className={styles.playPrimary}>
        Retry
      </button>
    </div>
  )
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
    <div className={styles.hero}>
      {backdrop && <img src={backdrop} alt="" fetchPriority="high" className={styles.heroImg} />}
      <div className={styles.heroScrim} />
      <BackButton />
    </div>
  )
}

export function DetailsPoster({
  poster
}: {
  poster: string | null | undefined
}): React.JSX.Element {
  return (
    <div className={styles.poster}>
      {poster ? (
        <img src={poster} alt="" className={styles.posterImg} />
      ) : (
        <div className={styles.posterPlaceholder} />
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
