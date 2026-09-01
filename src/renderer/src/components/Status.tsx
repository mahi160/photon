import styles from './Status.module.css'

// One shared empty/error state -- was three copies of the same retry markup with drifting
// copy ("Cannot reach server.", "No movies yet...", "Nothing here yet...") across Home.tsx,
// LibraryGrid.tsx, DetailsShell.tsx (#44).
export function Status({
  message,
  onRetry,
  className
}: {
  message: string
  onRetry?: () => void
  className?: string
}): React.JSX.Element {
  return (
    <div className={`${styles.status} ${className ?? ''}`}>
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className={styles.retry}>
          Retry
        </button>
      )}
    </div>
  )
}
