import { Link } from '@tanstack/react-router'
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
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={styles.chevron}
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        ) : (
          title
        )}
      </h2>
      <div className={styles.track}>
        {items.map((item) => (
          <Card key={item.Id} item={item} wide={wide} />
        ))}
      </div>
    </section>
  )
}
