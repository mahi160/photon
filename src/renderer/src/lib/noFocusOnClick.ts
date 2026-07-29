// Suppresses mousedown's focus so a clicked button doesn't eat useHotkeys.ts's next keydown via :focus-visible.
// Plain first-party buttons only -- base-ui menu/select/popover triggers need their own mousedown focus, blurred on close instead (PlayerControls' onToggleMenu).
export function noFocusOnClick(e: React.MouseEvent): void {
  e.preventDefault()
}
