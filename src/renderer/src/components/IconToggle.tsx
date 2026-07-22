import { Tip } from './Tip'

// Shared shape for every icon-only on/off button in the app (favorite,
// watched, ...): a tooltip/aria-label that flips with state, an active
// style, and an icon the caller already resolved (weight/fill differs per
// icon). Styling stays per-caller (className/activeClassName) since each
// call site's icon sits in a differently-sized/positioned control.
export function IconToggle({
  active,
  labelOn,
  labelOff,
  icon,
  onClick,
  className,
  activeClassName
}: {
  active: boolean
  labelOn: string // shown/announced when `active` (e.g. "Remove from favorites")
  labelOff: string
  icon: React.ReactNode
  onClick: (e: React.MouseEvent) => void
  className: string
  activeClassName: string
}): React.JSX.Element {
  const label = active ? labelOn : labelOff
  return (
    <Tip label={label}>
      <button
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={`${className} ${active ? activeClassName : ''}`}
      >
        {icon}
      </button>
    </Tip>
  )
}
