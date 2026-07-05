import { Link } from '@tanstack/react-router'
import { CaretRightIcon } from '@phosphor-icons/react'
import { Card } from './Card'
import type { BaseItem } from '../lib/jellyfin'
import styles from './Row.module.css'

export function Row({
  title,
  items,
  wide = false,
  to
}: {
  title: string
  items: BaseItem[] | undefined
  wide?: boolean
  to?: string
}): React.JSX.Element | null {
  if (!items?.length) return null
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        {to ? (
          <Link to={to} className={styles.headingLink}>
            {title}
            <CaretRightIcon weight="bold" className={styles.chevron} />
          </Link>
        ) : (
          title
        )}
      </h2>
      <div className={`${styles.track} ${wide ? styles.trackWide : ''}`}>
        {items.map((item) => (
          <Card key={item.Id} item={item} wide={wide} />
        ))}
      </div>
    </section>
  )
}
