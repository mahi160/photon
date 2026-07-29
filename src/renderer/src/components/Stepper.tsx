import { NumberField } from '@base-ui/react/number-field'

// one accessible number stepper for whole app -- styling stays with caller (settings vs. player glass)
export interface StepperClasses {
  group: string
  btn: string
  input: string
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  step,
  format,
  label,
  disabled,
  decrementLabel,
  incrementLabel,
  classes
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  format?: Intl.NumberFormatOptions
  label: string
  disabled?: boolean
  decrementLabel?: string
  incrementLabel?: string
  classes: StepperClasses
}): React.JSX.Element {
  return (
    <NumberField.Root
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={value}
      onValueChange={(v) => v !== null && onChange(v)}
      format={format}
    >
      <NumberField.Group className={classes.group}>
        <NumberField.Decrement
          className={classes.btn}
          aria-label={decrementLabel ?? `Decrease ${label}`}
        >
          −
        </NumberField.Decrement>
        <NumberField.Input className={classes.input} aria-label={label} />
        <NumberField.Increment
          className={classes.btn}
          aria-label={incrementLabel ?? `Increase ${label}`}
        >
          +
        </NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
  )
}
