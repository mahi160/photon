import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

const nav = [
  { to: '/', label: 'Home' },
  { to: '/movies', label: 'Movies' },
  { to: '/shows', label: 'TV Shows' },
  { to: '/search', label: 'Search' },
  { to: '/settings', label: 'Settings' }
] as const

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
    <div className="flex h-full">
      <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-white/5 p-3 pt-6">
        <div className="mb-4 px-3 text-lg font-semibold tracking-tight">Famto</div>
        {nav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:bg-surface-2 hover:text-neutral-100 [&.active]:bg-surface-2 [&.active]:text-neutral-100"
            activeOptions={{ exact: n.to === '/' }}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
