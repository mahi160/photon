import { Link } from '@tanstack/react-router'
import { Card } from './Card'
import type { BaseItem } from '../lib/jellyfin'

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
    <section className="mb-8">
      <h2 className="mb-3 px-8 text-base font-medium text-neutral-300">
        {to ? (
          <Link to={to} className="group inline-flex items-center gap-1 hover:text-white">
            {title}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="size-4 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        ) : (
          title
        )}
      </h2>
      <div className="flex gap-4 overflow-x-auto px-8 pb-2">
        {items.map((item) => (
          <Card key={item.Id} item={item} wide={wide} />
        ))}
      </div>
    </section>
  )
}
