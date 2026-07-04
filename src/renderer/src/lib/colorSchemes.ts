// Scheme identities only — the actual colors live solely in styles/tokens.css.
// Settings renders scheme previews by putting data-scheme/data-theme on the
// preview element itself and letting the CSS cascade supply the variables.
export type ColorScheme = 'rose-pine' | 'everforest' | 'gruvbox' | 'kanagawa'

export const colorSchemes: { key: ColorScheme; label: string }[] = [
  { key: 'rose-pine', label: 'Rosé Pine' },
  { key: 'everforest', label: 'Everforest' },
  { key: 'gruvbox', label: 'Gruvbox' },
  { key: 'kanagawa', label: 'Kanagawa' }
]
