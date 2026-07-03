import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { libraryQuery, type SortKey } from '../lib/queries'
import { Card } from './Card'

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
    <div className="px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <div className="flex items-center gap-3">
          {/* header owns search; only sort lives here */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm outline-none"
            aria-label="Sort"
          >
            {sorts.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {isPending && <div className="text-neutral-500">Loading…</div>}
      {isError && (
        <div className="text-neutral-400">
          Cannot reach server.{' '}
          <button onClick={() => refetch()} className="text-accent hover:underline">
            Retry
          </button>
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-4 gap-y-6">
        {data?.map((item) => (
          <Card key={item.Id} item={item} />
        ))}
      </div>
    </div>
  )
}
