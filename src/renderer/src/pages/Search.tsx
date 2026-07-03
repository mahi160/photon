import { useMemo, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchIndexQuery, episodeSearchQuery } from '../lib/queries'
import { Card } from '../components/Card'
import { filterLocal } from '../lib/search'
import type { BaseItem } from '../lib/jellyfin'
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
      <h2 className={styles.groupTitle}>{title}</h2>
      <div className={styles.grid}>
        {items.map((item) => (
          <Card key={item.Id} item={item} />
        ))}
      </div>
    </section>
  )
}

export function Search(): React.JSX.Element {
  const [term, setTerm] = useState('')
  const debounced = useDebounced(term.trim(), 250)

  // instant: local index of movies + shows (ADR-0001)
  const index = useQuery(searchIndexQuery)
  const local = useMemo(
    () => (term.trim().length >= 2 && index.data ? filterLocal(index.data, term.trim()) : []),
    [index.data, term]
  )
  const movies = local.filter((i) => i.Type === 'Movie')
  const shows = local.filter((i) => i.Type === 'Series')

  // episodes: server-side, debounced (ADR-0001)
  const episodes = useQuery(episodeSearchQuery(debounced))

  return (
    <div className={styles.page}>
      <input
        autoFocus
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search movies, shows, episodes…"
        className={styles.input}
        aria-label="Search"
      />
      <Group title="Movies" items={movies} />
      <Group title="TV Shows" items={shows} />
      <Group title="Episodes" items={episodes.data ?? []} />
      {term.trim().length >= 2 &&
        !movies.length &&
        !shows.length &&
        !episodes.data?.length &&
        !episodes.isFetching && <div className={styles.empty}>No results.</div>}
    </div>
  )
}
