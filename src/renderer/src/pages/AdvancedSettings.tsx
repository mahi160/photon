import styles from './Settings.module.css'

// ponytail: genuinely empty on purpose -- diagnostics/logging/dev options
// land here as they're built, not stubbed out ahead of time.
export function AdvancedSettings(): React.JSX.Element {
  return (
    <>
      <h1 className={styles.pageTitle}>Advanced</h1>
      <p className={styles.statsEmpty}>
        Nothing here yet — diagnostics, logging, and developer options will land here as Photon
        grows.
      </p>
    </>
  )
}
