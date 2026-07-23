import { Link } from '@tanstack/react-router'
import { CaretRight } from 'reicon-react'
import { Card } from './Card'
import { CardSkeleton } from './CardSkeleton'
import type { BaseItem } from '../lib/jellyfin'
import styles from './Row.module.css'

const SKELETON_COUNT = 6

export function Row({
  title,
  items,
  wide = false,
  to,
  loading = false
}: {
  title: string
  items: BaseItem[] | undefined
  wide?: boolean
  to?: string
  loading?: boolean
}): React.JSX.Element | null {
  if (!loading && !items?.length) return null
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        {to ? (
          <Link to={to} className={styles.headingLink}>
            {title}
            <CaretRight className={styles.chevron} />
          </Link>
        ) : (
          title
        )}
      </h2>
      <div className={`${styles.track} ${wide ? styles.trackWide : ''}`}>
        {loading
          ? Array.from({ length: SKELETON_COUNT }, (_, i) => <CardSkeleton key={i} wide={wide} />)
          : items!.map((item) => <Card key={item.Id} item={item} wide={wide} />)}
      </div>
    </section>
  )
}
