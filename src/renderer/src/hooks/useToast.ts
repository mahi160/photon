import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseToastApi {
  message: string | null
  show: (msg: string) => void
  dismiss: () => void
}

export function useToast(duration = 1200): UseToastApi {
  const [message, setMessage] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const dismiss = useCallback(() => {
    setMessage(null)
    clearTimeout(timerRef.current)
  }, [])

  // cleanup timer on unmount
  useEffect(() => {
    return () => clearTimeout(timerRef.current)
  }, [])

  const show = useCallback(
    (msg: string) => {
      setMessage(msg)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(dismiss, duration)
    },
    [duration, dismiss]
  )

  return { message, show, dismiss }
}
