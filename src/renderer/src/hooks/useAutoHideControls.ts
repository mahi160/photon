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

  // ponytail: these arm a setTimeout (an external system) in response to
  // mount / a playbackState change — the canonical Effect use case. The
  // setState-in-effect rule flags it anyway; no pure substitute exists for
  // "start a hide timer".
  // initial show
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    poke()
  }, [poke])

  // resume on play
  useEffect(() => {
    if (playbackState === 'playing') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
