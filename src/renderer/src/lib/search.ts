import type { BaseItem } from './jellyfin'

// local filter: prefix + substring matching, prefix matches rank above substring matches (ADR-0001)
export function filterLocal(items: BaseItem[], term: string, limit = 48): BaseItem[] {
  const q = term.toLowerCase()
  const starts: BaseItem[] = []
  const contains: BaseItem[] = []
  for (const item of items) {
    const name = item.Name.toLowerCase()
    if (name.startsWith(q)) starts.push(item)
    else if (name.includes(q)) contains.push(item)
  }
  return [...starts, ...contains].slice(0, limit)
}
