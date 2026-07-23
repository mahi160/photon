// Stops a plain <button> from retaining keyboard focus after a mouse click.
// mousedown's default action is "focus this element"; suppressing just that
// (click still fires normally right after) keeps useHotkeys.ts's shortcuts
// working immediately after clicking a player control. Without this, a
// clicked button stays focused, and the next keydown's `e.target` is that
// button -- if it matches `:focus-visible`, useHotkeys treats it as "let the
// browser handle it" and our shortcut never runs (see useHotkeys.ts).
//
// Only for plain first-party buttons. base-ui menu/select/popover triggers
// open via their own mousedown handling -- this would risk suppressing that;
// those are blurred on close instead (see PlayerControls' onToggleMenu).
export function noFocusOnClick(e: React.MouseEvent): void {
  e.preventDefault()
}
