import { useMemo, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchIndexQuery, episodeSearchQuery } from '../lib/queries'
import { Card } from '../components/Card'
import type { BaseItem } from '../lib/jellyfin'

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

// local fuzzy filter: prefix matches rank above substring matches
function filterLocal(items: BaseItem[], term: string): BaseItem[] {
  const q = term.toLowerCase()
  const starts: BaseItem[] = []
  const contains: BaseItem[] = []
  for (const item of items) {
    const name = item.Name.toLowerCase()
    if (name.startsWith(q)) starts.push(item)
    else if (name.includes(q)) contains.push(item)
  }
  return [...starts, ...contains].slice(0, 48)
}

function Group({ title, items }: { title: string; items: BaseItem[] }): React.JSX.Element | null {
  if (!items.length) return null
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-medium text-neutral-300">{title}</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-4 gap-y-6">
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
    <div className="px-8 py-8">
      <input
        autoFocus
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search movies, shows, episodes…"
        className="mb-8 w-full max-w-xl rounded-xl bg-surface-2 px-4 py-3 text-base outline-none ring-accent/60 placeholder:text-neutral-500 focus:ring-2"
        aria-label="Search"
      />
      <Group title="Movies" items={movies} />
      <Group title="TV Shows" items={shows} />
      <Group title="Episodes" items={episodes.data ?? []} />
      {term.trim().length >= 2 &&
        !movies.length &&
        !shows.length &&
        !episodes.data?.length &&
        !episodes.isFetching && <div className="text-neutral-500">No results.</div>}
    </div>
  )
}
