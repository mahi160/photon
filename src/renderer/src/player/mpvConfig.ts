// Minimal subtitle-appearance GUI (Settings > Playback): size/color/background box only, not a full styling page (ADR-0007). Spread *before* parseMpvConfig's raw passthrough so a matching raw sub-* line still wins.
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

// Raw mpv-config passthrough (Settings > Playback, issue #9): escape hatch for anyone wanting more than Photon's default subtitle appearance (engine.rs), or other mpv behavior -- plain key=value lines, applied after Photon's defaults so user values win.
// Invalid/unrecognized lines silently dropped, never surfaced as error -- a typo here must never break playback.
export function parseMpvConfig(raw: string): [string, string][] {
  const pairs: [string, string][] = []
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const withoutDashes = line.replace(/^--/, '')
    const eq = withoutDashes.indexOf('=')
    if (eq <= 0) continue // no '=' or empty key — bare flag lines unsupported
    const key = withoutDashes.slice(0, eq).trim()
    const value = withoutDashes.slice(eq + 1).trim()
    if (!key) continue
    pairs.push([key, value])
  }
  return pairs
}
