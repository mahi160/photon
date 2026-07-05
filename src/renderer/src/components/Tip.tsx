import { Tooltip } from '@base-ui/react/tooltip'
import styles from './Tip.module.css'

const DELAY_MS = 1000

// One tooltip for every icon-only control. Wraps any element (plain button or
// a base-ui trigger) via the render prop, so no extra DOM nodes appear.
export function Tip({
  label,
  kbd,
  children
}: {
  label: string
  kbd?: string // keyboard shortcut hint, e.g. 'F'
  children: React.ReactElement<Record<string, unknown>>
}): React.JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger delay={DELAY_MS} render={children} />
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
