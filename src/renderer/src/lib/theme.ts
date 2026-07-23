export type Theme = 'gruvbox' | 'obsidian' | 'midnight' | 'forest' | 'rosepine'

// order here is the picker order and the header toggle's cycle order.
// gruvbox is first/default -- see stores/settings.ts.
export const themes: { key: Theme; label: string; dark: boolean }[] = [
  { key: 'gruvbox', label: 'Gruvbox Material', dark: true },
  { key: 'obsidian', label: 'Obsidian', dark: true },
  { key: 'midnight', label: 'Midnight', dark: true },
  { key: 'forest', label: 'Forest', dark: true },
  { key: 'rosepine', label: 'Rosé Pine', dark: false }
]

export function themeLabel(theme: Theme): string {
  return themes.find((t) => t.key === theme)?.label ?? theme
}

export function isDark(theme: Theme): boolean {
  return themes.find((t) => t.key === theme)?.dark ?? true
}

export function nextTheme(theme: Theme): Theme {
  const i = themes.findIndex((t) => t.key === theme)
  return themes[(i + 1) % themes.length].key
}

// the tokens a theme is actually built from (tokens.css) -- everything
// else (surfaces, borders, shadows) is derived from these via color-mix,
// so overriding just these 7 restyles the whole app.
export const colorTokens: { key: string; label: string }[] = [
  { key: '--bg', label: 'Background' },
  { key: '--fg', label: 'Text' },
  { key: '--fg-muted', label: 'Muted text' },
  { key: '--accent', label: 'Accent' },
  { key: '--accent-2', label: 'Accent (secondary)' },
  { key: '--accent-3', label: 'Direct play' },
  { key: '--accent-4', label: 'Transcode' }
]

// applies saved per-token overrides on top of the active theme's own CSS --
// inline style always wins over the [data-theme] rule regardless of source
// order, so anything left out of `colors` just falls back to the theme's
// stock value.
export function applyCustomColors(colors: Record<string, string>): void {
  for (const t of colorTokens) {
    if (colors[t.key]) document.documentElement.style.setProperty(t.key, colors[t.key])
    else document.documentElement.style.removeProperty(t.key)
  }
}
