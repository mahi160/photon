import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import { libraryQuery, type SortKey } from '../lib/queries'
import { useSettings } from '../stores/settings'
import { Card } from './Card'
import { CardSkeleton } from './CardSkeleton'
import { Status } from './Status'
import styles from './LibraryGrid.module.css'

const SKELETON_COUNT = 14

const sorts: { key: SortKey; label: string }[] = [
  { key: 'added', label: 'Added' },
  { key: 'name', label: 'Name' },
  { key: 'release', label: 'Release' }
]

// mirrors .grid's minmax(10.5rem,1fr)/gap -- virtualizer has no grid mode, row math replicates CSS grid.
// Computed from the root font-size, not hardcoded at a 16px assumption -- OS font-size scaling
// (accessibility setting, not just zoom) changes what 10.5rem/1rem actually render as (#44).
function rootFontPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}
const ESTIMATED_ROW_PX = 280 // initial virtualizer row-height guess, corrected once real rows measure

// columns that fit at current width (mirrors repeat(auto-fill, minmax(...))), recomputed on resize
// state-backed ref not plain useRef: grid div mounts late (behind conditional), plain ref's effect would fire once against null .current
function useColumnCount(): [number, (el: HTMLElement | null) => void] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [columns, setColumns] = useState(1)
  useEffect(() => {
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const rem = rootFontPx()
      const minCardPx = rem * 10.5
      const columnGapPx = rem * 1
      const width = entry.contentRect.width
      setColumns(Math.max(1, Math.floor((width + columnGapPx) / (minCardPx + columnGapPx))))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])
  return [columns, setEl]
}

export function LibraryGrid({
  type,
  title,
  sort,
  onSortChange
}: {
  type: 'Movie' | 'Series'
  title: string
  sort: SortKey
  onSortChange: (sort: SortKey) => void
}): React.JSX.Element {
  const { data, isPending, isError, refetch } = useQuery(libraryQuery(type, sort))
  const navigate = useNavigate()

  const [columns, gridRef] = useColumnCount()
  const rowCount = data ? Math.ceil(data.length / columns) : 0

  const virtualizer = useVirtualizer({
    count: rowCount,
    // scrolling ancestor is .main (AppLayout), not this element or window — see data-scroll-root comment there
    getScrollElement: () => document.querySelector<HTMLElement>('[data-scroll-root]'),
    estimateSize: () => ESTIMATED_ROW_PX,
    overscan: 3
  })

  // picks random unwatched movie -> details page, runs cancellable auto-play countdown (?surprise=1)
  function surpriseMe(): void {
    if (!data?.length) return
    const unwatchedOnly = useSettings.getState().surpriseUnwatchedOnly
    const unwatched = unwatchedOnly ? data.filter((i) => !i.UserData?.Played) : data
    const pool = unwatched.length ? unwatched : data // all watched -> fall back to anything
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
        {/* @base-ui/react/toggle-group: roving tabindex + arrow-key navigation for free (#32) */}
        <ToggleGroup
          value={[sort]}
          onValueChange={(v) => v[0] && onSortChange(v[0])}
          className={styles.sort}
          aria-label="Sort"
        >
          {sorts.map((s) => (
            <Toggle
              key={s.key}
              value={s.key}
              className={`${styles.sortBtn} ${sort === s.key ? styles.sortBtnActive : ''}`}
            >
              {s.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      {isPending && (
        <div className={styles.skeletonGrid}>
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}
      {isError && (
        <Status
          message="Cannot reach server."
          onRetry={() => refetch()}
          className={styles.status}
        />
      )}
      {empty && (
        <div
          className={styles.status}
        >{`Nothing here yet. Add media to your Jellyfin library.`}</div>
      )}
      {data && data.length > 0 && (
        <div ref={gridRef} style={{ position: 'relative', blockSize: virtualizer.getTotalSize() }}>
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
                  // stagger only first row -- animating whole library at once is jank, not polish
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
