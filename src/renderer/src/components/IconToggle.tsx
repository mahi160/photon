import { Tip } from './Tip'

// shared shape for icon-only on/off buttons (favorite, watched, ...): tooltip/aria-label flips with state, styling stays per-caller
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
  labelOn: string // announced when active, e.g. "Remove from favorites"
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
