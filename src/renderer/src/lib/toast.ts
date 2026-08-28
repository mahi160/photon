import { Toast } from '@base-ui/react/toast'

// module-level manager (createToastManager works outside React) -- lets any
// callback call showToast() directly instead of threading a hook return
// value through every player callback (see ToastHost.tsx for the renderer).
// Toast.createToastManager, not a named import -- the package only re-exports
// the value from its namespace object, types (not the function) from the bare index.
export const toastManager = Toast.createToastManager()

export function showToast(title: string, timeout = 1200): void {
  toastManager.add({ title, timeout })
}
