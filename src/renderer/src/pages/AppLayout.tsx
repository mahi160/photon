import { useState } from 'react'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { Gear, Search, Palette } from 'reicon-react'
import { useHotkeys } from '../lib/useHotkeys'
import { useSettings } from '../stores/settings'
import { nextTheme, themeLabel } from '../lib/theme'
import { ShortcutsOverlay } from './Shortcuts'
import { Tip } from '../components/Tip'
import { PhotonMark } from '../components/PhotonMark'
import styles from './AppLayout.module.css'

function ThemeToggle(): React.JSX.Element {
  const theme = useSettings((s) => s.theme)
  const set = useSettings((s) => s.set)
  const next = nextTheme(theme)

  return (
    <Tip label={`Theme: ${themeLabel(theme)} (next: ${themeLabel(next)})`}>
      <button
        className={styles.iconBtn}
        aria-label={`Switch theme, currently ${themeLabel(theme)}`}
        onClick={() => set({ theme: next })}
      >
        <Palette className={styles.themeIcon} />
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

  useHotkeys({
    'mod+f': () => navigate({ to: '/search' }),
    '/': () => navigate({ to: '/search' }),
    '?': () => setShortcutsOpen((v) => !v),
    'shift+?': () => setShortcutsOpen((v) => !v)
  })

  return (
    <div className={styles.shell}>
      {/* overlay title bar (tauri.conf.json): traffic lights float over this
          bar instead of reserving their own strip -- this makes the empty
          space in it (not the nav links/buttons themselves, see drag.js)
          the window's drag handle */}
      <header className={styles.header} data-tauri-drag-region>
        <Link to="/" className={styles.brand}>
          <PhotonMark /> Photon
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
          <Search className={styles.searchPillIcon} />
          <span className={styles.searchPillLabel}>Search</span>
          <kbd className={styles.searchKbd}>/</kbd>
        </Link>
        <ThemeToggle />
        <Tip label="Settings">
          <Link to="/settings" aria-label="Settings" className={styles.iconBtn}>
            <Gear className={styles.icon} />
          </Link>
        </Tip>
      </header>
      {/* data-scroll-root: LibraryGrid's virtualizer needs a handle on the
          actual scrolling ancestor (this, not the window -- .main is the
          overflow-y:auto element, see AppLayout.module.css) */}
      <main className={styles.main} data-scroll-root>
        <Outlet />
      </main>
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  )
}
