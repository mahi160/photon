import { Tooltip } from '@base-ui/react/tooltip'
import styles from './Tip.module.css'

// one tooltip for every icon-only control, wraps any element via render prop -- no extra DOM nodes.
// Delay lives on <Tooltip.Provider> in main.tsx, not per-trigger -- sweeping across the dock's 8
// icon buttons used to wait the full delay at each one; a shared provider makes adjacent tooltips
// within the group's `timeout` instant after the first (#21).
export function Tip({
  label,
  kbd,
  children
}: {
  label: string
  kbd?: string // shortcut hint, e.g. 'F'
  children: React.ReactElement<Record<string, unknown>>
}): React.JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={8} className={styles.positioner}>
          <Tooltip.Popup className={styles.tip}>
            {label}
            {kbd && <kbd className={styles.kbd}>{kbd}</kbd>}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
