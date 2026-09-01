import { Switch } from '@base-ui/react/switch'
import styles from '../pages/Settings.module.css'

export interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

// @base-ui/react/switch (#32) -- same aria-checked switch semantics as the hand-rolled
// version, plus keyboard/focus handling for free
export function ToggleSwitch({ checked, onChange, label }: ToggleSwitchProps): React.JSX.Element {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
    >
      <Switch.Thumb className={styles.toggleThumb} />
    </Switch.Root>
  )
}
