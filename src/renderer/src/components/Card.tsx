import { useNavigate } from '@tanstack/react-router'
import { imageUrl, type BaseItem } from '../lib/jellyfin'

// Card semantics (CONTEXT.md): click card / hover play button = play,
// click title label = details. Same everywhere.
export function Card({ item, wide = false }: { item: BaseItem; wide?: boolean }): React.JSX.Element {
  const navigate = useNavigate()
  const img = imageUrl(item, wide ? 480 : 360)
  const pct = item.UserData?.PlayedPercentage

  function play(): void {
    navigate({ to: '/player/$itemId', params: { itemId: item.Id } })
  }

  function details(e: React.MouseEvent): void {
    e.stopPropagation()
    if (item.Type === 'Movie') navigate({ to: '/movies/$itemId', params: { itemId: item.Id } })
    else if (item.Type === 'Series')
      navigate({ to: '/shows/$seriesId', params: { seriesId: item.Id } })
    else if (item.SeriesId) navigate({ to: '/shows/$seriesId', params: { seriesId: item.SeriesId } })
  }

  const subtitle =
    item.Type === 'Episode'
      ? `${item.SeriesName ?? ''} · S${item.ParentIndexNumber ?? '?'}E${item.IndexNumber ?? '?'}`
      : (item.ProductionYear ?? '')

  return (
    <div className={wide ? 'w-64 shrink-0' : 'w-40 shrink-0'}>
      <button
        onClick={play}
        aria-label={`Play ${item.Name}`}
        className={`group relative block w-full overflow-hidden rounded-xl bg-surface-2 ${
          wide ? 'aspect-video' : 'aspect-[2/3]'
        }`}
      >
        {img ? (
          <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-neutral-500">
            {item.Name}
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity duration-150 group-hover:bg-black/40 group-hover:opacity-100 group-focus-visible:bg-black/40 group-focus-visible:opacity-100">
          <span className="flex size-11 items-center justify-center rounded-full bg-white/90 text-black">
            <svg viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 size-5">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </div>
        {pct !== undefined && pct > 0 && pct < 100 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
        )}
      </button>
      <button
        onClick={details}
        className="mt-1.5 block w-full truncate text-left text-sm text-neutral-300 hover:text-white hover:underline"
        title={item.Name}
      >
        {item.Name}
      </button>
      <div className="truncate text-xs text-neutral-500">{subtitle}</div>
    </div>
  )
}
