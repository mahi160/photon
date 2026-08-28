export type Theme =
  'graphite' | 'gruvbox' | 'obsidian' | 'midnight' | 'rosepine' | 'everforest' | 'auto'

// order = picker order + header toggle cycle order. gruvbox first/default, see stores/settings.ts.
export const themes: { key: Theme; label: string; dark: boolean }[] = [
  { key: 'gruvbox', label: 'Gruvbox Material', dark: true },
  { key: 'graphite', label: 'Graphite', dark: true },
  { key: 'obsidian', label: 'Obsidian', dark: true },
  { key: 'midnight', label: 'Midnight', dark: true },
  { key: 'rosepine', label: 'Rosé Pine', dark: false },
  { key: 'everforest', label: 'Everforest', dark: false }
]

// 'auto' follows the OS -- one dark + one light pick to resolve to (#18). Cycle/picker order above
// intentionally excludes it: cycling through 6 stock palettes is the point, 'auto' is opted into
// from Appearance settings, not landed on mid-cycle.
const AUTO_DARK: Exclude<Theme, 'auto'> = 'gruvbox'
const AUTO_LIGHT: Exclude<Theme, 'auto'> = 'rosepine'

// resolves 'auto' against the OS's current light/dark preference -- every other value passes through
export function resolveTheme(theme: Theme): Exclude<Theme, 'auto'> {
  if (theme !== 'auto') return theme
  return matchMedia('(prefers-color-scheme: dark)').matches ? AUTO_DARK : AUTO_LIGHT
}

export function themeLabel(theme: Theme): string {
  if (theme === 'auto') return 'Auto'
  return themes.find((t) => t.key === theme)?.label ?? theme
}

export function isDark(theme: Theme): boolean {
  return themes.find((t) => t.key === resolveTheme(theme))?.dark ?? true
}

export function nextTheme(theme: Theme): Theme {
  const i = themes.findIndex((t) => t.key === theme)
  return themes[(i + 1) % themes.length].key
}

// tokens a theme is built from (tokens.css) -- rest (surfaces, borders, shadows) derives from these via color-mix, so overriding these 7 restyles whole app.
export const colorTokens: { key: string; label: string }[] = [
  { key: '--bg', label: 'Background' },
  { key: '--fg', label: 'Text' },
  { key: '--fg-muted', label: 'Muted text' },
  { key: '--accent', label: 'Accent' },
  { key: '--info', label: 'Accent (secondary)' },
  { key: '--success', label: 'Direct play' },
  { key: '--warning', label: 'Transcode' }
]

// applies saved per-token overrides on active theme -- inline style always wins over [data-theme] rule, so omitted keys fall back to theme's stock value.
export function applyCustomColors(colors: Record<string, string>): void {
  for (const t of colorTokens) {
    if (colors[t.key]) document.documentElement.style.setProperty(t.key, colors[t.key])
    else document.documentElement.style.removeProperty(t.key)
  }
}
