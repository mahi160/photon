import { useCallback, useEffect, useRef, useState } from 'react'
import { Html5Engine } from './html5'
import type { LoadRequest, PlaybackEngine } from './engine'

// Mirrors engine state into React and funnels every engine write through one
// place, so component code never holds a second copy of playback state.

export interface EngineHandlers {
  onEnded?: (positionSeconds: number) => void
  onBeforeDestroy?: (positionSeconds: number) => void
}

export interface PlayerEngineApi {
  state: 'playing' | 'paused' | 'buffering'
  time: number
  duration: number
  volume: number
  muted: boolean
  rate: number
  pip: boolean
  error: string | null
  clearError: () => void
  currentTime: () => number
  load: (req: LoadRequest) => Promise<void>
  togglePlay: () => void
  seek: (seconds: number) => void
  seekBy: (seconds: number) => void
  changeVolume: (volume: number) => void
  adjustVolume: (delta: number) => void
  toggleMute: () => void
  changeRate: (rate: number) => void
  setTextTrack: (index: number | null) => void
  setSubtitleDelay: (seconds: number) => void
  togglePiP: () => void
}

export function usePlayerEngine(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  initialRate: number,
  handlers: EngineHandlers
): PlayerEngineApi {
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })

  const engineRef = useRef<PlaybackEngine | null>(null)
  const [state, setState] = useState<'playing' | 'paused' | 'buffering'>('buffering')
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(initialRate)
  const [pip, setPip] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rateRef = useRef(initialRate)
  const volumeRef = useRef(1) // mirror for stable adjustVolume

  const ensureEngine = useCallback((): PlaybackEngine | null => {
    if (!engineRef.current && videoRef.current) {
      const e = new Html5Engine(videoRef.current)
      e.on('time', (t) => {
        setTime(t)
        setDuration(e.duration())
      })
      e.on('state', setState)
      e.on('error', setError)
      e.on('pip', setPip)
      e.on('ended', () => handlersRef.current.onEnded?.(e.currentTime()))
      engineRef.current = e
    }
    return engineRef.current
  }, [videoRef])

  useEffect(() => {
    return () => {
      const e = engineRef.current
      if (e) {
        handlersRef.current.onBeforeDestroy?.(e.currentTime())
        e.destroy()
        engineRef.current = null
      }
    }
  }, [])

  const load = useCallback(
    async (req: LoadRequest): Promise<void> => {
      const e = ensureEngine()
      if (!e) return
      await e.load(req)
      e.setRate(rateRef.current) // rate survives reloads (audio switch, burn-in)
    },
    [ensureEngine]
  )

  const currentTime = useCallback(() => engineRef.current?.currentTime() ?? 0, [])

  const togglePlay = useCallback(() => {
    const e = engineRef.current
    if (!e) return
    if (state === 'playing') e.pause()
    else e.play()
  }, [state])

  const seek = useCallback((seconds: number) => engineRef.current?.seek(seconds), [])
  const seekBy = useCallback((delta: number) => {
    const e = engineRef.current
    e?.seek(e.currentTime() + delta)
  }, [])

  const changeVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    engineRef.current?.setVolume(clamped)
    volumeRef.current = clamped
    setVolume(clamped)
  }, [])
  const adjustVolume = useCallback(
    (delta: number) => changeVolume(volumeRef.current + delta),
    [changeVolume]
  )

  const toggleMute = useCallback(() => {
    engineRef.current?.setMuted(!muted)
    setMuted(!muted)
  }, [muted])

  const changeRate = useCallback((r: number) => {
    engineRef.current?.setRate(r)
    rateRef.current = r
    setRate(r)
  }, [])

  const setTextTrack = useCallback((index: number | null) => {
    engineRef.current?.setTextTrack(index)
  }, [])
  const setSubtitleDelay = useCallback((seconds: number) => {
    engineRef.current?.setSubtitleDelay(seconds)
  }, [])

  const togglePiP = useCallback(() => {
    const e = engineRef.current
    if (!e) return
    void (pip ? e.exitPiP() : e.enterPiP())
  }, [pip])

  return {
    state,
    time,
    duration,
    volume,
    muted,
    rate,
    pip,
    error,
    clearError: useCallback(() => setError(null), []),
    currentTime,
    load,
    togglePlay,
    seek,
    seekBy,
    changeVolume,
    adjustVolume,
    toggleMute,
    changeRate,
    setTextTrack,
    setSubtitleDelay,
    togglePiP
  }
}
