export type Theme = 'obsidian' | 'midnight' | 'forest' | 'rosepine'

// order here is the picker order and the header toggle's cycle order.
export const themes: { key: Theme; label: string; dark: boolean }[] = [
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
