import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { libraryQuery, type SortKey } from '../lib/queries'
import { useSettings } from '../stores/settings'
import { Card } from './Card'
import styles from './LibraryGrid.module.css'

const sorts: { key: SortKey; label: string }[] = [
  { key: 'added', label: 'Added' },
  { key: 'name', label: 'Name' },
  { key: 'release', label: 'Release' }
]

// must match .grid's `minmax(10.5rem, 1fr)` / `gap: 1.75rem 1rem` — the
// virtualizer chunks items into rows itself (no built-in grid mode), so the
// row math here has to mirror the CSS grid it's replacing
const MIN_CARD_PX = 168 // 10.5rem
const COLUMN_GAP_PX = 16 // 1rem
// Card.module.css's own `contain-intrinsic-size` guess for a card's height
const ESTIMATED_ROW_PX = 280

// how many columns actually fit at the current container width — same
// arithmetic `repeat(auto-fill, minmax(...))` does, recomputed on resize
function useColumnCount(ref: React.RefObject<HTMLElement | null>): number {
  const [columns, setColumns] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      setColumns(Math.max(1, Math.floor((width + COLUMN_GAP_PX) / (MIN_CARD_PX + COLUMN_GAP_PX))))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return columns
}

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

  const gridRef = useRef<HTMLDivElement>(null)
  const columns = useColumnCount(gridRef)
  const rowCount = data ? Math.ceil(data.length / columns) : 0

  const virtualizer = useVirtualizer({
    count: rowCount,
    // the scrolling ancestor is .main (AppLayout), not this component's own
    // element or the window — see the data-scroll-root comment there
    getScrollElement: () => document.querySelector<HTMLElement>('[data-scroll-root]'),
    estimateSize: () => ESTIMATED_ROW_PX,
    overscan: 3
  })

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
      {data && data.length > 0 && (
        <div
          ref={gridRef}
          className={styles.grid}
          style={{ position: 'relative', blockSize: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const start = row.index * columns
            const rowItems = data.slice(start, start + columns)
            return (
              <div
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                className={styles.gridRow}
                style={{
                  position: 'absolute',
                  top: 0,
                  insetInlineStart: 0,
                  insetInlineEnd: 0,
                  transform: `translateY(${row.start}px)`,
                  gridTemplateColumns: `repeat(${columns}, 1fr)`
                }}
              >
                {rowItems.map((item, i) =>
                  // stagger only the very first row — animating a full
                  // library's worth of cards at once is just jank, not polish
                  row.index === 0 ? (
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
            )
          })}
        </div>
      )}
    </div>
  )
}
