import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { libraryQuery, type SortKey } from '../lib/queries'
import { Card } from './Card'
import styles from './LibraryGrid.module.css'

const sorts: { key: SortKey; label: string }[] = [
  { key: 'added', label: 'Added' },
  { key: 'name', label: 'Name' },
  { key: 'release', label: 'Release' }
]

export function LibraryGrid({
  type,
  title
}: {
  type: 'Movie' | 'Series'
  title: string
}): React.JSX.Element {
  const [sort, setSort] = useState<SortKey>('added')
  const { data, isPending, isError, refetch } = useQuery(libraryQuery(type, sort))

  const noun = type === 'Movie' ? 'movies' : 'shows'
  const empty = !isPending && !isError && data?.length === 0

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>{title}</h1>
        {data && <span className={styles.count}>{`${data.length} ${noun}`}</span>}
        <div className={styles.spacer} />
        <div className={styles.sort} role="group" aria-label="Sort">
          {sorts.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`${styles.sortBtn} ${sort === s.key ? styles.sortBtnActive : ''}`}
              aria-pressed={sort === s.key}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {isPending && <div className={styles.status}>Loading…</div>}
      {isError && (
        <div className={styles.status}>
          Cannot reach server.{' '}
          <button onClick={() => refetch()} className={styles.retry}>
            Retry
          </button>
        </div>
      )}
      {empty && (
        <div className={styles.status}>{`No ${noun} yet. Add media to your Jellyfin library.`}</div>
      )}
      <div className={styles.grid}>
        {data?.map((item, i) =>
          // stagger only the first screenful — animating a full library's
          // worth of cards at once is just jank, not polish
          i < 12 ? (
            <div
              key={item.Id}
              className={styles.gridItem}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <Card item={item} />
            </div>
          ) : (
            <Card key={item.Id} item={item} />
          )
        )}
      </div>
    </div>
  )
}
