import { Link, type ErrorComponentProps } from '@tanstack/react-router'
import { PhotonMark } from './PhotonMark'
import styles from './RouteFallback.module.css'

// wired in as the router's defaultErrorComponent/defaultNotFoundComponent —
// without these, any render throw or bad deep link is a blank white screen
// with no way back except force-quitting the app.

export function RouteError({ error, reset }: ErrorComponentProps): React.JSX.Element {
  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <PhotonMark /> Photon
        </div>
        <p className={styles.title}>Something went wrong.</p>
        <p className={styles.detail}>{error.message || 'An unexpected error occurred.'}</p>
        <div className={styles.actions}>
          <button className={styles.button} onClick={() => window.location.reload()}>
            Reload
          </button>
          <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={reset}>
            Try again
          </button>
        </div>
      </div>
    </div>
  )
}

export function RouteNotFound(): React.JSX.Element {
  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <PhotonMark /> Photon
        </div>
        <p className={styles.title}>Page not found.</p>
        <div className={styles.actions}>
          <Link to="/" className={`${styles.button} ${styles.buttonPrimary}`}>
            Back home
          </Link>
        </div>
      </div>
    </div>
  )
}
