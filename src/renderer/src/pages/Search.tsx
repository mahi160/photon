import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { X } from 'reicon-react'
import { searchIndexQuery, episodeSearchQuery } from '../lib/queries'
import { Card } from '../components/Card'
import { filterLocal } from '../lib/search'
import { imageUrl, type BaseItem } from '../lib/jellyfin'
import { useSearchHistory } from '../stores/searchHistory'
import styles from './Search.module.css'

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function Group({ title, items }: { title: string; items: BaseItem[] }): React.JSX.Element | null {
  if (!items.length) return null
  return (
    <section className={styles.group}>
      <h2 className={styles.groupTitle}>
        {title} <span className={styles.groupCount}>{items.length}</span>
      </h2>
      <div className={styles.grid}>
        {items.map((item) => (
          <Card key={item.Id} item={item} />
        ))}
      </div>
    </section>
  )
}

function EpisodeRow({ ep }: { ep: BaseItem }): React.JSX.Element {
  const navigate = useNavigate()
  const img = imageUrl(ep, 240)
  const sub = `${ep.SeriesName ?? ''} · S${ep.ParentIndexNumber ?? '?'} · E${ep.IndexNumber ?? '?'}`
  return (
    <button
      className={styles.epRow}
      onClick={() => navigate({ to: '/player/$itemId', params: { itemId: ep.Id } })}
    >
      <div className={styles.epThumb}>
        {img && <img src={img} alt="" loading="lazy" decoding="async" />}
      </div>
      <div className={styles.epInfo}>
        <div className={styles.epTitle}>{ep.Name}</div>
        <div className={styles.epSub}>{sub}</div>
      </div>
    </button>
  )
}

export function Search(): React.JSX.Element {
  const [term, setTerm] = useState('')
  const debounced = useDebounced(term.trim(), 250)
  const q = term.trim()
  const hasQuery = q.length >= 2

  const history = useSearchHistory((s) => s.terms)
  const addHistory = useSearchHistory((s) => s.add)
  const removeHistory = useSearchHistory((s) => s.remove)
  const clearHistory = useSearchHistory((s) => s.clear)
  // longer, separate debounce than live search -- save once user actually stopped, not just
  // paused mid-word. Gated on the term actually having a local match -- otherwise every
  // zero-result typo gets saved to history too.
  const settled = useDebounced(q, 1000)

  // instant: local index of movies + shows (ADR-0001) -- filters on the raw term, not the
  // debounced one. filterLocal is a single pass over a few thousand strings, sub-millisecond;
  // the 250ms debounce belonged to the server-side episode path only, not this (#8)
  const index = useQuery(searchIndexQuery)
  const local = useMemo(
    () => (q.length >= 2 && index.data ? filterLocal(index.data, q) : []),
    [index.data, q]
  )
  const movies = local.filter((i) => i.Type === 'Movie')
  const shows = local.filter((i) => i.Type === 'Series')

  useEffect(() => {
    if (settled.length < 2 || !index.data) return
    if (filterLocal(index.data, settled).length > 0) addHistory(settled)
  }, [settled, index.data, addHistory])

  // episodes: server-side, debounced (ADR-0001)
  const episodes = useQuery(episodeSearchQuery(debounced))
  const episodeItems = episodes.data ?? []
  const showEpisodes = hasQuery && (episodeItems.length > 0 || episodes.isFetching)

  const noResults =
    hasQuery && !movies.length && !shows.length && !episodeItems.length && !episodes.isFetching

  const navigate = useNavigate()

  return (
    <div className={styles.page}>
      <input
        type="search"
        autoFocus
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          const first = movies[0] ?? shows[0] ?? episodeItems[0]
          if (first) navigate({ to: '/player/$itemId', params: { itemId: first.Id } })
        }}
        placeholder="Search movies, shows, episodes…"
        spellCheck={false}
        className={styles.input}
        aria-label="Search"
      />

      {!hasQuery && (
        <div className={styles.idle}>
          Type to search. Movies and shows filter instantly; episodes stream in from the server.
        </div>
      )}

      {!hasQuery && history.length > 0 && (
        <div className={styles.history}>
          <div className={styles.epHead}>
            <h2 className={styles.groupTitle}>Recent searches</h2>
            <button className={styles.historyClear} onClick={clearHistory}>
              clear
            </button>
          </div>
          <div className={styles.historyChips}>
            {history.map((h) => (
              <div key={h} className={styles.historyChip}>
                <button onClick={() => setTerm(h)} className={styles.historyChipLabel}>
                  {h}
                </button>
                <button
                  onClick={() => removeHistory(h)}
                  aria-label={`Remove ${h} from recent searches`}
                  className={styles.historyChipRemove}
                >
                  <X />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {noResults && (
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>Nothing found</div>
          <div className={styles.emptyHint}>No title on this server matches “{q}”.</div>
        </div>
      )}

      <Group title="Movies" items={movies} />
      <Group title="Shows" items={shows} />

      {showEpisodes && (
        <section className={styles.group}>
          <div className={styles.epHead}>
            <h2 className={styles.groupTitle}>Episodes</h2>
            {episodes.isFetching && <span className={styles.searching}>searching server…</span>}
          </div>
          <div className={styles.epList}>
            {episodeItems.map((ep) => (
              <EpisodeRow key={ep.Id} ep={ep} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
