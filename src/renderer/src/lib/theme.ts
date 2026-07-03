export function resolvedDark(theme: 'dark' | 'light' | 'system'): boolean {
  return (
    theme === 'dark' || (theme === 'system' && document.documentElement.dataset.theme === 'dark')
  )
}
