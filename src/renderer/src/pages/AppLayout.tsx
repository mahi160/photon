import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useHotkeys } from '../lib/useHotkeys'
import { useSettings } from '../stores/settings'
import { resolvedDark } from '../lib/theme'
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

export function AppLayout(): React.JSX.Element {
  const navigate = useNavigate()

  useHotkeys(
    {
      'mod+f': () => navigate({ to: '/search' })
    },
    [navigate]
  )

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          Famto
        </Link>
        <div className={styles.spacer} />
        <ThemeToggle />
        <Link to="/search" aria-label="Search" className={styles.iconBtn}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className={styles.icon}
          >
            <circle cx="10.5" cy="10.5" r="7" />
            <path d="M15.8 15.8 21 21" />
          </svg>
        </Link>
        <Link to="/shortcuts" aria-label="Keyboard shortcuts" className={styles.iconBtn}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className={styles.icon}
          >
            <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
            <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 14h12" strokeLinecap="round" />
          </svg>
        </Link>
        <Link to="/settings" aria-label="Settings" className={styles.iconBtn}>
          <svg viewBox="0 0 24 24" fill="currentColor" className={styles.icon}>
            <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.5 4a8.5 8.5 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a8.6 8.6 0 0 0-2-1.2L15.5 3h-4l-.5 2.6a8.6 8.6 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a8.5 8.5 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a8.6 8.6 0 0 0 2 1.2l.5 2.6h4l.5-2.6a8.6 8.6 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2z" />
          </svg>
        </Link>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
