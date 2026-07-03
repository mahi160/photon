import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { libraryQuery, type SortKey } from '../lib/queries'
import { Card } from './Card'
import styles from './LibraryGrid.module.css'

const sorts: { key: SortKey; label: string }[] = [
  { key: 'added', label: 'Recently Added' },
  { key: 'name', label: 'Alphabetical' },
  { key: 'release', label: 'Release Date' }
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

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>{title}</h1>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className={styles.select}
          aria-label="Sort"
        >
          {sorts.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
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
      <div className={styles.grid}>
        {data?.map((item) => (
          <Card key={item.Id} item={item} />
        ))}
      </div>
    </div>
  )
}
