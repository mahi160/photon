import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSession } from '../stores/session'
import { JellyfinError } from '../lib/jellyfin'
import { PhotonMark } from '../components/PhotonMark'
import styles from './Login.module.css'

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

  return (
    <div className={styles.page}>
      <form onSubmit={submit} className={styles.form}>
        <h1 className={styles.brand}>
          <PhotonMark /> Photon
        </h1>
        <p className={styles.tagline}>Sign in to your Jellyfin server.</p>
        <label className={styles.label} htmlFor="login-server">
          Server
        </label>
        <input
          id="login-server"
          className={styles.field}
          placeholder="https://jellyfin.example.net"
          spellCheck={false}
          value={server}
          onChange={(e) => setServer(e.target.value)}
          autoFocus
          required
        />
        <label className={styles.label} htmlFor="login-username">
          Username
        </label>
        <input
          id="login-username"
          className={styles.field}
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <label className={styles.label} htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          className={styles.field}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className={styles.submit}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  )
}
