import { useEffect } from 'react'

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

export function useHotkeys(map: HotkeyMap, deps: unknown[]): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, select, textarea, [contenteditable="true"]')) return
      const handler = map[comboOf(e)]
      if (handler) {
        e.preventDefault()
        handler(e)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
