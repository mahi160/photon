export type ThemePref = 'dark' | 'light' | 'system'

export function resolveTheme(theme: ThemePref): 'dark' | 'light' {
  if (theme === 'system')
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return theme
}

export function resolvedDark(theme: ThemePref): boolean {
  return resolveTheme(theme) === 'dark'
}
