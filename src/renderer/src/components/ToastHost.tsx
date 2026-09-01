import { Toast } from '@base-ui/react/toast'
import { toastManager } from '../lib/toast'
import styles from './ToastHost.module.css'

// role=status/aria-live is Toast.Root's own default (Base UI announces toasts) -- issue #12
function ToastList(): React.JSX.Element {
  const { toasts } = Toast.useToastManager()
  return (
    <Toast.Portal>
      <Toast.Viewport className={styles.viewport}>
        {toasts.map((toast) => (
          <Toast.Root key={toast.id} toast={toast} className={styles.toast}>
            <Toast.Title className={styles.title}>{toast.title}</Toast.Title>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  )
}

export function ToastHost(): React.JSX.Element {
  return (
    <Toast.Provider toastManager={toastManager}>
      <ToastList />
    </Toast.Provider>
  )
}
