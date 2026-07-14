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

export function useHotkeys(map: HotkeyMap): void {
  // listener subscribes once; the ref keeps handlers fresh without
  // resubscribing on every render (the player re-renders on playback ticks)
  const mapRef = useRef(map)
  useEffect(() => {
    mapRef.current = map
  })
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null
      // A deliberately focused control keeps its native keys: Tab-focus and
      // text-editing surfaces match :focus-visible in Chromium. Mouse-clicked
      // buttons/sliders don't, so shortcuts keep working right after clicking
      // a player control — preventDefault below also cancels the focused
      // button's own Space activation (the double-toggle bug).
      if (target?.matches(':focus-visible')) return
      // safety net: text entry always wins even when the heuristic doesn't apply
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
  }, [])
}
