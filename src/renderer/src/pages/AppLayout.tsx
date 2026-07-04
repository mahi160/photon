import { useState } from 'react'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useHotkeys } from '../lib/useHotkeys'
import { useSettings } from '../stores/settings'
import { resolvedDark } from '../lib/theme'
import { ShortcutsOverlay } from './Shortcuts'
import styles from './AppLayout.module.css'

function ThemeToggle(): React.JSX.Element {
  const theme = useSettings((s) => s.theme)
  const set = useSettings((s) => s.set)
  const dark = resolvedDark(theme)

  return (
    <button
      className={styles.iconBtn}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => set({ theme: dark ? 'light' : 'dark' })}
    >
      {dark ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className={styles.themeIcon}
        >
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="currentColor" className={styles.themeIcon}>
          <path d="M20.7 14.9A8.6 8.6 0 0 1 9.1 3.3a.8.8 0 0 0-1-1A9.9 9.9 0 1 0 21.7 15.9a.8.8 0 0 0-1-1z" />
        </svg>
      )}
    </button>
  )
}

type NavItem = {
  to: '/' | '/movies' | '/shows'
  label: string
  exact?: boolean
  icon: React.JSX.Element
}

const navItems: NavItem[] = [
  {
    to: '/',
    label: 'Home',
    exact: true,
    icon: <path d="M3.5 9.5 10 3.5l6.5 6v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
  },
  {
    to: '/movies',
    label: 'Movies',
    icon: (
      <>
        <rect x="3" y="4" width="14" height="12" rx="2" />
        <line x1="3" y1="8" x2="17" y2="8" />
        <line x1="7" y1="4" x2="7" y2="8" />
        <line x1="13" y1="4" x2="13" y2="8" />
      </>
    )
  },
  {
    to: '/shows',
    label: 'Shows',
    icon: (
      <>
        <rect x="3" y="5" width="14" height="10" rx="2" />
        <line x1="7" y1="18" x2="13" y2="18" />
      </>
    )
  }
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
          Famto
        </Link>
        <nav className={styles.nav}>
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={item.exact ? { exact: true } : undefined}
              className={styles.navLink}
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={styles.navIcon}
              >
                {item.icon}
              </svg>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.spacer} />
        <Link to="/search" className={styles.searchPill} aria-label="Search">
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={styles.searchPillIcon}
          >
            <circle cx="9" cy="9" r="6" />
            <line x1="13.5" y1="13.5" x2="18" y2="18" />
          </svg>
          <span className={styles.searchPillLabel}>Search</span>
          <kbd className={styles.searchKbd}>/</kbd>
        </Link>
        <ThemeToggle />
        <Link to="/settings" aria-label="Settings" className={styles.iconBtn}>
          <svg viewBox="0 0 24 24" fill="currentColor" className={styles.icon}>
            <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.5 4a8.5 8.5 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a8.6 8.6 0 0 0-2-1.2L15.5 3h-4l-.5 2.6a8.6 8.6 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a8.5 8.5 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a8.6 8.6 0 0 0 2 1.2l.5 2.6h4l.5-2.6a8.6 8.6 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2z" />
          </svg>
        </Link>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  )
}
