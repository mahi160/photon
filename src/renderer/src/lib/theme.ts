export type Theme = 'gruvbox' | 'rosepine' | 'jellyfin' | 'aurora'

// order here is the picker order and the header toggle's cycle order.
export const themes: { key: Theme; label: string; dark: boolean }[] = [
  { key: 'gruvbox', label: 'Gruvbox', dark: true },
  { key: 'jellyfin', label: 'Jellyfin', dark: true },
  { key: 'aurora', label: 'Aurora', dark: true },
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
