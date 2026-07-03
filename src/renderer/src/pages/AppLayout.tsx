import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

const iconBtn =
  'rounded-lg p-2 text-neutral-400 transition-colors hover:bg-surface-2 hover:text-neutral-100 [&.active]:text-neutral-100'

export function AppLayout(): React.JSX.Element {
  const navigate = useNavigate()

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        navigate({ to: '/search' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-6 border-b border-white/5 px-6 py-3">
        <Link to="/" className="text-lg font-semibold tracking-tight">
          Famto
        </Link>
        <div className="flex-1" />
        <Link to="/search" aria-label="Search" className={iconBtn}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="size-5"
          >
            <circle cx="10.5" cy="10.5" r="7" />
            <path d="M15.8 15.8 21 21" />
          </svg>
        </Link>
        <Link to="/settings" aria-label="Settings" className={iconBtn}>
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
            <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.5 4a8.5 8.5 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a8.6 8.6 0 0 0-2-1.2L15.5 3h-4l-.5 2.6a8.6 8.6 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a8.5 8.5 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a8.6 8.6 0 0 0 2 1.2l.5 2.6h4l.5-2.6a8.6 8.6 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2z" />
          </svg>
        </Link>
      </header>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
