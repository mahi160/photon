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
