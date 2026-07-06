import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseAutoHideApi {
  visible: boolean
  pinned: boolean
  setPinned: (pinned: boolean) => void
  poke: () => void
}

export function useAutoHideControls(
  playbackState: 'playing' | 'paused' | 'buffering',
  hideDelay = 3000
): UseAutoHideApi {
  const [visible, setVisible] = useState(true)
  const [pinned, setPinned] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const poke = useCallback(() => {
    setVisible(true)
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setVisible(false), hideDelay)
  }, [hideDelay])

  // cleanup timer on unmount
  useEffect(() => {
    return () => clearTimeout(hideTimerRef.current)
  }, [])

  // initial show
  useEffect(() => {
    poke()
  }, [poke])

  // resume on play
  useEffect(() => {
    if (playbackState === 'playing') {
      poke()
    }
  }, [playbackState, poke])

  return {
    visible: visible || pinned || playbackState === 'paused',
    pinned,
    setPinned,
    poke
  }
}
