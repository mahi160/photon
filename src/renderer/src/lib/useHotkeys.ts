import { useEffect, useRef } from 'react'

// Hand-rolled keyboard shortcut map (PRD: no keybinding dependency).
// Keys are combos like "mod+f", "space", "arrowleft", "[".
export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>

function comboOf(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('mod')
  if (e.shiftKey) parts.push('shift')
  parts.push(e.key === ' ' ? 'space' : e.key.toLowerCase())
  return parts.join('+')
}

export interface UseHotkeysOptions {
  // Player controls are tabIndex={-1}; base-ui's focus manager can still grab :focus-visible onto a just-opened popup's container. Skipping the guard there stops Space selecting a track instead of pausing. AppLayout's real Tab-reachable shortcuts keep the guard.
  ignoreFocusGuard?: boolean
}

export function useHotkeys(map: HotkeyMap, options: UseHotkeysOptions = {}): void {
  // listener subscribes once; ref keeps handlers fresh without resubscribing every render (player re-renders on playback ticks)
  const mapRef = useRef(map)
  useEffect(() => {
    mapRef.current = map
  })
  const ignoreFocusGuard = options.ignoreFocusGuard ?? false
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null
      // Deliberately focused control keeps native keys: Tab-focus/text-editing match :focus-visible, mouse-clicks don't -- preventDefault below also cancels the focused button's own Space activation (double-toggle bug)
      if (!ignoreFocusGuard && target?.matches(':focus-visible')) return
      // safety net: text entry always wins even when heuristic doesn't apply
      if (target?.closest('input:not([type="range"]), select, textarea, [contenteditable="true"]'))
        return
      const handler = mapRef.current[comboOf(e)]
      if (handler) {
        e.preventDefault()
        handler(e)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ignoreFocusGuard])
}
