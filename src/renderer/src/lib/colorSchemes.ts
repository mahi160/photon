// Mirrors the per-scheme primitives in styles/tokens.css — kept as data here
// so Settings can render swatches without reading computed DOM styles.
export type ColorScheme = 'rose-pine' | 'everforest' | 'gruvbox' | 'kanagawa'

interface Primitives {
  bg: string
  fg: string
  accent: string
  accent2: string
  accent3: string
  accent4: string
}

export const colorSchemes: { key: ColorScheme; label: string }[] = [
  { key: 'rose-pine', label: 'Rosé Pine' },
  { key: 'everforest', label: 'Everforest' },
  { key: 'gruvbox', label: 'Gruvbox' },
  { key: 'kanagawa', label: 'Kanagawa' }
]

export const schemePrimitives: Record<ColorScheme, Record<'dark' | 'light', Primitives>> = {
  'rose-pine': {
    dark: {
      bg: '#191724',
      fg: '#e0def4',
      accent: '#eb6f92',
      accent2: '#c4a7e7',
      accent3: '#9ccfd8',
      accent4: '#f6c177'
    },
    light: {
      bg: '#faf4ed',
      fg: '#575279',
      accent: '#b4637a',
      accent2: '#907aa9',
      accent3: '#56949f',
      accent4: '#ea9d34'
    }
  },
  everforest: {
    dark: {
      bg: '#2d353b',
      fg: '#d3c6aa',
      accent: '#a7c080',
      accent2: '#dbbc7f',
      accent3: '#83c092',
      accent4: '#e69875'
    },
    light: {
      bg: '#fdf6e3',
      fg: '#5c6a72',
      accent: '#8da101',
      accent2: '#dfa000',
      accent3: '#35a77c',
      accent4: '#f57d26'
    }
  },
  gruvbox: {
    dark: {
      bg: '#282828',
      fg: '#ebdbb2',
      accent: '#fe8019',
      accent2: '#d3869b',
      accent3: '#8ec07c',
      accent4: '#fabd2f'
    },
    light: {
      bg: '#fbf1c7',
      fg: '#3c3836',
      accent: '#af3a03',
      accent2: '#8f3f71',
      accent3: '#427b58',
      accent4: '#b57614'
    }
  },
  kanagawa: {
    dark: {
      bg: '#1f1f28',
      fg: '#dcd7ba',
      accent: '#d27e99',
      accent2: '#957fb8',
      accent3: '#7aa89f',
      accent4: '#e6c384'
    },
    light: {
      bg: '#f2ecbc',
      fg: '#545464',
      accent: '#b35b79',
      accent2: '#766b90',
      accent3: '#597b75',
      accent4: '#de9800'
    }
  }
}
