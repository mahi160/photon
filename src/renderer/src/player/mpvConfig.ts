// Minimal subtitle-appearance GUI (Settings > Playback): the few knobs
// people actually reach for (size/color/background box), not a full
// per-property styling page -- ADR-0007 still holds. Returned pairs are
// meant to be spread *before* parseMpvConfig's raw passthrough below, so a
// matching raw `sub-*` line still wins (same "defaults, then user" order
// engine.rs already applies its own hardcoded defaults in).
export function guiSubtitleConfig(settings: {
  subtitleFontSize: number
  subtitleColor: string
  subtitleBackgroundBox: boolean
}): [string, string][] {
  return [
    ['sub-font-size', String(settings.subtitleFontSize)],
    ['sub-color', settings.subtitleColor],
    ['sub-back-color', settings.subtitleBackgroundBox ? '#CC000000' : '#00000000']
  ]
}

// Raw mpv-config passthrough (Settings > Playback, issue #9): replaces the
// old per-property subtitle-styling GUI's role without rebuilding one.
// Photon ships a sane default subtitle appearance (applied in engine.rs);
// this is the escape hatch for anyone who wants more, or any other mpv
// behavior — plain `key=value` lines, applied as extra mpv options at
// launch (after Photon's defaults, so the user's values win).
//
// Invalid/unrecognized lines are silently dropped, never surfaced as an
// error — a typo in this power-user field must never break playback.
export function parseMpvConfig(raw: string): [string, string][] {
  const pairs: [string, string][] = []
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const withoutDashes = line.replace(/^--/, '')
    const eq = withoutDashes.indexOf('=')
    if (eq <= 0) continue // no '=', or an empty key — bare flag lines aren't supported
    const key = withoutDashes.slice(0, eq).trim()
    const value = withoutDashes.slice(eq + 1).trim()
    if (!key) continue
    pairs.push([key, value])
  }
  return pairs
}
