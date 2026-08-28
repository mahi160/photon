import { Select as BaseSelect } from '@base-ui/react/select'
import { ChevronDown } from 'reicon-react'
import styles from './Select.module.css'

export interface SelectOption<T> {
  value: T
  label: string
}

// One shared themed select (@base-ui/react/select, already in the bundle) --
// replaces every native <select> in Details/Settings pages, which rendered
// in unthemed OS chrome (#13).
export function Select<T extends string | number | null | undefined>({
  value,
  onChange,
  options,
  ariaLabel,
  className
}: {
  value: T
  onChange: (v: T) => void
  options: SelectOption<T>[]
  ariaLabel: string
  className?: string
}): React.JSX.Element {
  // Base UI's Select.Root treats an explicitly-passed `value={undefined}` as "uncontrolled"
  // (React drops undefined props), so our "Default"/"Off" sentinel (always `undefined`, never
  // `null`, across every option list) silently fell back to Base UI's own internal `null`
  // selection -- which matched none of our options and rendered a blank trigger. `null` is the
  // one value that's always an explicit, controlled prop, so it's the sentinel Base UI itself
  // gets; option items mirror that, and lookups both ways go through the same normalization.
  return (
    <BaseSelect.Root
      value={value ?? null}
      onValueChange={(v) => {
        const found = options.find((o) => (o.value ?? null) === v)
        if (found) onChange(found.value)
      }}
    >
      <BaseSelect.Trigger className={`${styles.trigger} ${className ?? ''}`} aria-label={ariaLabel}>
        <BaseSelect.Value className={styles.value}>
          {(v: T | null) => options.find((o) => (o.value ?? null) === v)?.label ?? ''}
        </BaseSelect.Value>
        <ChevronDown className={styles.caret} />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        {/* alignItemWithTrigger (default) re-measures to line the selected item up under the
            trigger after mount -- reads as a visible jump right as the popup opens. false pins it
            like a normal anchored dropdown from the first frame. */}
        <BaseSelect.Positioner sideOffset={6} alignItemWithTrigger={false}>
          <BaseSelect.Popup className={styles.popup}>
            {options.map((o) => (
              <BaseSelect.Item
                key={String(o.value)}
                value={o.value ?? null}
                className={styles.item}
              >
                <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
