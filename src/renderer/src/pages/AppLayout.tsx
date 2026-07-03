import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

const icons = {
  home: <path d="M3 10.5 12 3l9 7.5V21h-6v-6h-6v6H3z" />,
  film: <path d="M4 4h16v16H4zM4 9h16M4 15h16M9 4v16M15 4v16" />,
  tv: <path d="M3 6h18v12H3zM8 21h8" />,
  search: <path d="M10.5 3a7.5 7.5 0 1 0 4.9 13.2L21 21l-1.4 1.4-5.6-4.8" />,
  gear: (
    <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.5 4a8.5 8.5 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a8.6 8.6 0 0 0-2-1.2L15.5 3h-4l-.5 2.6a8.6 8.6 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a8.5 8.5 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a8.6 8.6 0 0 0 2 1.2l.5 2.6h4l.5-2.6a8.6 8.6 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2z" />
  )
} as const

const nav = [
  { to: '/', label: 'Home', icon: icons.home },
  { to: '/movies', label: 'Movies', icon: icons.film },
  { to: '/shows', label: 'TV Shows', icon: icons.tv },
  { to: '/search', label: 'Search', icon: icons.search },
  { to: '/settings', label: 'Settings', icon: icons.gear }
] as const

export function AppLayout(): React.JSX.Element {
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('famto.sidebar') === 'collapsed'
  )

  function toggle(): void {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('famto.sidebar', next ? 'collapsed' : 'open')
  }

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
      <nav
        className={`flex shrink-0 flex-col gap-1 border-r border-white/5 p-3 pt-6 transition-[width] duration-150 ${
          collapsed ? 'w-16' : 'w-44'
        }`}
      >
        <div className="mb-4 flex items-center justify-between px-1.5">
          {!collapsed && <span className="px-1.5 text-lg font-semibold tracking-tight">Famto</span>}
          <button
            onClick={toggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-surface-2 hover:text-neutral-100"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`size-4 transition-transform duration-150 ${collapsed ? 'rotate-180' : ''}`}
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>
        {nav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            title={collapsed ? n.label : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:bg-surface-2 hover:text-neutral-100 [&.active]:bg-surface-2 [&.active]:text-neutral-100 ${
              collapsed ? 'justify-center px-0 py-2' : ''
            }`}
            activeOptions={{ exact: n.to === '/' }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
              className="size-4.5 shrink-0"
            >
              {n.icon}
            </svg>
            {!collapsed && n.label}
          </Link>
        ))}
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
