import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { libraryQuery, type SortKey } from '../lib/queries'
import { useSettings } from '../stores/settings'
import { Card } from './Card'
import styles from './LibraryGrid.module.css'

const sorts: { key: SortKey; label: string }[] = [
  { key: 'added', label: 'Added' },
  { key: 'name', label: 'Name' },
  { key: 'release', label: 'Release' }
]

// merged libraries can hold thousands of items (AGENTS.md) — render this many
// cards up front, then grow by the same amount each time the sentinel below
// the grid scrolls into view. Caps DOM nodes without a virtualization dep.
const PAGE_SIZE = 60

export function LibraryGrid({
  type,
  title
}: {
  type: 'Movie' | 'Series'
  title: string
}): React.JSX.Element {
  const [sort, setSort] = useState<SortKey>('added')
  const { data, isPending, isError, refetch } = useQuery(libraryQuery(type, sort))
  const navigate = useNavigate()
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // reset the window when the underlying list changes (sort/library refetch)
  // -- render-time adjustment, not an effect (react docs: "adjusting state
  // when a prop changes"), so it takes effect before the stale slice paints
  const [prevData, setPrevData] = useState(data)
  if (data !== prevData) {
    setPrevData(data)
    setVisibleCount(PAGE_SIZE)
  }

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisibleCount((n) => n + PAGE_SIZE)
      },
      { rootMargin: '600px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // decision-paralysis killer: random unwatched movie → details page, which
  // runs a cancellable auto-play countdown (?surprise=1)
  function surpriseMe(): void {
    if (!data?.length) return
    const unwatchedOnly = useSettings.getState().surpriseUnwatchedOnly
    const unwatched = unwatchedOnly ? data.filter((i) => !i.UserData?.Played) : data
    const pool = unwatched.length ? unwatched : data // everything watched → anything goes
    const pick = pool[Math.floor(Math.random() * pool.length)]
    navigate({ to: '/movies/$itemId', params: { itemId: pick.Id }, search: { surprise: true } })
  }

  const noun = type === 'Movie' ? 'movies' : 'shows'
  const empty = !isPending && !isError && data?.length === 0

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>{title}</h1>
        {data && <span className={styles.count}>{`${data.length} ${noun}`}</span>}
        <div className={styles.spacer} />
        {type === 'Movie' && !!data?.length && (
          <button className={styles.surpriseBtn} onClick={surpriseMe}>
            Surprise me
          </button>
        )}
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
        {data?.slice(0, visibleCount).map((item, i) =>
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
      {data && visibleCount < data.length && <div ref={sentinelRef} aria-hidden />}
    </div>
  )
}
