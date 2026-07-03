import { Card } from './Card'
import type { BaseItem } from '../lib/jellyfin'

export function Row({
  title,
  items,
  wide = false
}: {
  title: string
  items: BaseItem[] | undefined
  wide?: boolean
}): React.JSX.Element | null {
  if (!items?.length) return null
  return (
    <section className="mb-8">
      <h2 className="mb-3 px-8 text-base font-medium text-neutral-300">{title}</h2>
      <div className="flex gap-4 overflow-x-auto px-8 pb-2">
        {items.map((item) => (
          <Card key={item.Id} item={item} wide={wide} />
        ))}
      </div>
    </section>
  )
}
