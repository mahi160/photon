import { useState } from 'react'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { GearIcon, MagnifyingGlassIcon, MoonIcon, SunIcon } from '@phosphor-icons/react'
import { useHotkeys } from '../lib/useHotkeys'
import { useSettings } from '../stores/settings'
import { resolvedDark } from '../lib/theme'
import { ShortcutsOverlay } from './Shortcuts'
import { Tip } from '../components/Tip'
import styles from './AppLayout.module.css'

function ThemeToggle(): React.JSX.Element {
  const theme = useSettings((s) => s.theme)
  const set = useSettings((s) => s.set)
  const dark = resolvedDark(theme)

  return (
    <Tip label={dark ? 'Light theme' : 'Dark theme'}>
      <button
        className={styles.iconBtn}
        aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
        onClick={() => set({ theme: dark ? 'light' : 'dark' })}
      >
        {dark ? (
          <SunIcon className={styles.themeIcon} />
        ) : (
          <MoonIcon className={styles.themeIcon} />
        )}
      </button>
    </Tip>
  )
}

type NavItem = {
  to: '/' | '/movies' | '/shows'
  label: string
  exact?: boolean
}

const navItems: NavItem[] = [
  { to: '/', label: 'Home', exact: true },
  { to: '/movies', label: 'Movies' },
  { to: '/shows', label: 'Shows' }
]

export function AppLayout(): React.JSX.Element {
  const navigate = useNavigate()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useHotkeys(
    {
      'mod+f': () => navigate({ to: '/search' }),
      '/': () => navigate({ to: '/search' }),
      '?': () => setShortcutsOpen((v) => !v),
      'shift+?': () => setShortcutsOpen((v) => !v)
    },
    [navigate]
  )

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          ph<span className={styles.brandO}>o</span>ton
        </Link>
        <nav className={styles.nav}>
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={item.exact ? { exact: true } : undefined}
              className={styles.navLink}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.spacer} />
        <Link to="/search" className={styles.searchPill} aria-label="Search">
          <MagnifyingGlassIcon weight="bold" className={styles.searchPillIcon} />
          <span className={styles.searchPillLabel}>Search</span>
          <kbd className={styles.searchKbd}>/</kbd>
        </Link>
        <ThemeToggle />
        <Tip label="Settings">
          <Link to="/settings" aria-label="Settings" className={styles.iconBtn}>
            <GearIcon className={styles.icon} />
          </Link>
        </Tip>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  )
}
