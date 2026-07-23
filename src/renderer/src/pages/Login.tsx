import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSession } from '../stores/session'
import {
  authenticateWithQuickConnect,
  JellyfinError,
  normalizeServer,
  quickConnectAuthenticated,
  quickConnectInitiate
} from '../lib/jellyfin'
import { PhotonMark } from '../components/PhotonMark'
import styles from './Login.module.css'

export function Login(): React.JSX.Element {
  const login = useSession((s) => s.login)
  const loginWith = useSession((s) => s.loginWith)
  const navigate = useNavigate()
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Quick Connect: show a code, poll until it's approved from another
  // signed-in Jellyfin session, then sign in with the secret
  const [qc, setQc] = useState<{ code: string; secret: string; server: string } | null>(null)

  async function startQuickConnect(): Promise<void> {
    setError(null)
    try {
      const base = normalizeServer(server)
      const { code, secret } = await quickConnectInitiate(base)
      setQc({ code, secret, server: base })
    } catch (err) {
      setError(err instanceof JellyfinError ? err.message : 'Quick Connect failed.')
    }
  }

  useEffect(() => {
    if (!qc) return
    const id = setInterval(async () => {
      try {
        if (!(await quickConnectAuthenticated(qc.server, qc.secret))) return
        clearInterval(id)
        await loginWith(await authenticateWithQuickConnect(qc.server, qc.secret))
        navigate({ to: '/' })
      } catch (err) {
        clearInterval(id)
        setQc(null)
        setError(err instanceof JellyfinError ? err.message : 'Quick Connect failed.')
      }
    }, 2000)
    return () => clearInterval(id)
  }, [qc, loginWith, navigate])

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
    // overlay title bar (tauri.conf.json): this screen has no header of its
    // own, so it's the only thing standing in for a drag region here (the
    // form/inputs/buttons are excluded automatically, see drag.js)
    <div className={styles.page} data-tauri-drag-region>
      <form onSubmit={submit} className={styles.form}>
        <h1 className={styles.brand}>
          <PhotonMark /> Photon
        </h1>
        <p className={styles.tagline}>Sign in to your Jellyfin server.</p>
        <div className={styles.panel}>
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
            placeholder="Username"
            spellCheck={false}
            autoComplete="username"
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
            placeholder="Password"
            autoComplete="current-password"
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
          <div className={styles.divider}>or</div>
          {qc ? (
            <div className={styles.qcBox}>
              <span className={styles.qcCode}>{qc.code}</span>
              <p className={styles.qcHint}>
                Enter this code in any signed-in Jellyfin app (Settings → Quick Connect). Waiting
                for approval…
              </p>
              <button type="button" className={styles.qcCancel} onClick={() => setQc(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy || !server.trim()}
              className={styles.qcBtn}
              onClick={startQuickConnect}
            >
              Use Quick Connect
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
