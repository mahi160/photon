import styles from './CardSkeleton.module.css'

// shimmering stand-in for Card, sized the same way — used wherever a
// Row/LibraryGrid is waiting on its query instead of a bare "Loading…" line
export function CardSkeleton({ wide = false }: { wide?: boolean }): React.JSX.Element {
  return (
    <div className={styles.card}>
      <div className={`${styles.poster} ${wide ? styles.wide : ''}`} />
      <div className={styles.line} />
      <div className={`${styles.line} ${styles.lineShort}`} />
    </div>
  )
}
