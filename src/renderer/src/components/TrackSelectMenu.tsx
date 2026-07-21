import { Menu as BaseMenu } from '@base-ui/react/menu'
import type { MediaStream } from '../lib/jellyfin'
import { Tip } from './Tip'
import styles from './PlayerControls.module.css'

export interface TrackSelectMenuProps {
  label: React.ReactNode
  ariaLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
  value?: number
  tracks: MediaStream[]
  onSelect: (index: number) => void
  defaultLabel?: string
}

export function TrackSelectMenu({
  label,
  ariaLabel,
  open,
  onOpenChange,
  value,
  tracks,
  onSelect,
  defaultLabel
}: TrackSelectMenuProps): React.JSX.Element {
  return (
    <BaseMenu.Root open={open} onOpenChange={onOpenChange}>
      <Tip label={ariaLabel}>
        <BaseMenu.Trigger className={styles.iconBtn} tabIndex={-1} aria-label={ariaLabel}>
          {label}
        </BaseMenu.Trigger>
      </Tip>
      <BaseMenu.Portal>
        <BaseMenu.Positioner side="top" align="end" sideOffset={10}>
          <BaseMenu.Popup className={styles.menu}>
            {tracks.map((t) => (
              <BaseMenu.Item
                key={t.Index}
                onClick={() => {
                  onSelect(t.Index)
                  onOpenChange(false)
                }}
                className={`${styles.menuItem} ${value === t.Index ? styles.menuItemActive : ''}`}
              >
                {t.DisplayTitle ?? `Track ${t.Index}`}
              </BaseMenu.Item>
            ))}
            {!tracks.length && (
              <BaseMenu.Item onClick={() => {}} className={styles.menuItem}>
                {defaultLabel ?? 'Default'}
              </BaseMenu.Item>
            )}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}
