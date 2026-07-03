import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSession } from '../stores/session'
import { JellyfinError } from '../lib/jellyfin'

export function Login(): React.JSX.Element {
  const login = useSession((s) => s.login)
  const navigate = useNavigate()
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(server, username, password)
      navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof JellyfinError ? err.message : 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  const field =
    'w-full rounded-lg bg-surface-2 px-3.5 py-2.5 text-sm outline-none ring-accent/60 placeholder:text-neutral-500 focus:ring-2'

  return (
    <div className="flex h-full items-center justify-center">
      <form onSubmit={submit} className="w-80 space-y-3">
        <h1 className="mb-6 text-center text-2xl font-semibold tracking-tight">Famto</h1>
        <input
          className={field}
          placeholder="Server URL"
          value={server}
          onChange={(e) => setServer(e.target.value)}
          autoFocus
          required
        />
        <input
          className={field}
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          className={field}
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  )
}
