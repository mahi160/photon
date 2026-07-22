import { useCallback, useEffect, useRef, useState } from 'react'
import { MpvEngine } from './mpv'
import type { LoadRequest, PlaybackEngine } from './engine'

// Mirrors engine state into React and funnels every engine write through one
// place, so component code never holds a second copy of playback state.

export interface EngineHandlers {
  onEnded?: (positionSeconds: number) => void
  onBeforeDestroy?: (positionSeconds: number) => void
}

export interface EngineInitial {
  rate: number
  volume: number
  muted: boolean
}

export interface PlayerEngineApi {
  state: 'playing' | 'paused' | 'buffering'
  time: number
  duration: number
  bufferedEnd: number
  volume: number
  muted: boolean
  rate: number
  pip: boolean
  pipAvailable: boolean
  error: string | null
  clearError: () => void
  currentTime: () => number
  load: (req: LoadRequest) => Promise<void>
  togglePlay: () => void
  seek: (seconds: number) => void
  seekBy: (seconds: number) => void
  changeVolume: (volume: number) => number // returns the clamped volume
  adjustVolume: (delta: number) => number // returns the clamped volume
  toggleMute: () => boolean // returns the new muted state
  changeRate: (rate: number) => void
  setTextTrack: (index: number | null) => void
  setSubtitleDelay: (seconds: number) => void
  selectAudioTrack: (index: number) => void
  selectEmbeddedSubtitleTrack: (index: number | null) => void
  togglePiP: () => void
}

export function usePlayerEngine(
  videoRef: React.RefObject<HTMLDivElement | null>,
  initial: EngineInitial,
  handlers: EngineHandlers
): PlayerEngineApi {
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })
  const initialRef = useRef(initial) // applied once, at engine creation

  const engineRef = useRef<PlaybackEngine | null>(null)
  const [state, setState] = useState<'playing' | 'paused' | 'buffering'>('buffering')
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [bufferedEnd, setBufferedEnd] = useState(0)
  const [volume, setVolume] = useState(initial.volume)
  const [muted, setMuted] = useState(initial.muted)
  const [rate, setRate] = useState(initial.rate)
  const [pip, setPip] = useState(false)
  const [pipAvailable, setPipAvailable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // system mpv is genuinely optional (unlike in-process playback) -- PiP
  // just hides itself when there's nothing to spawn
  useEffect(() => {
    void window.api.pipAvailable().then(setPipAvailable)
  }, [])
  const rateRef = useRef(initial.rate)
  // mirrors so adjustVolume/toggleMute keep stable identities (they feed
  // memoized controls) and can report the value they just set
  const volumeRef = useRef(initial.volume)
  const mutedRef = useRef(initial.muted)

  const ensureEngine = useCallback((): PlaybackEngine | null => {
    if (!engineRef.current && videoRef.current) {
      const e = new MpvEngine(videoRef.current)
      e.on('time', (t) => {
        setTime(t)
        setDuration(e.duration())
        setBufferedEnd(e.buffered())
      })
      e.on('state', setState)
      e.on('error', setError)
      e.on('pip', setPip)
      // volumechange is the single source of truth — covers slider, hotkeys,
      // and anything outside our UI (media keys, PiP window)
      e.on('volume', (v, m) => {
        volumeRef.current = v
        mutedRef.current = m
        setVolume(v)
        setMuted(m)
      })
      e.on('ended', () => handlersRef.current.onEnded?.(e.currentTime()))
      e.applyInitialVolume(initialRef.current.volume, initialRef.current.muted)
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

  // decide off the engine's freshest pause mirror (last tick), not the React
  // `state` value — during 'buffering' `state` can't tell playing-but-stalled
  // from paused, so toggling off it would make pause unreachable mid-buffer
  const togglePlay = useCallback(() => {
    const e = engineRef.current
    if (!e) return
    if (e.paused()) e.play()
    else e.pause()
  }, [])

  const seek = useCallback((seconds: number) => engineRef.current?.seek(seconds), [])
  const seekBy = useCallback((delta: number) => {
    const e = engineRef.current
    e?.seek(e.currentTime() + delta)
  }, [])

  const changeVolume = useCallback((v: number): number => {
    const e = engineRef.current
    const clamped = Math.max(0, Math.min(1, v))
    volumeRef.current = clamped
    e?.setVolume(clamped)
    setVolume(clamped)
    if (clamped > 0) {
      e?.setMuted(false) // raising volume implies "I want sound"
      mutedRef.current = false
      setMuted(false)
    }
    return clamped
  }, [])
  const adjustVolume = useCallback(
    (delta: number): number => changeVolume(volumeRef.current + delta),
    [changeVolume]
  )

  const toggleMute = useCallback((): boolean => {
    const e = engineRef.current
    if (!e) return mutedRef.current
    if (mutedRef.current && volumeRef.current === 0) {
      // ponytail: unmuting at zero restores an audible level instead of staying silent
      changeVolume(0.5)
      return false
    }
    const next = !mutedRef.current
    e.setMuted(next)
    mutedRef.current = next
    setMuted(next)
    return next
  }, [changeVolume])

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
  const selectAudioTrack = useCallback((index: number) => {
    engineRef.current?.selectAudioTrack(index)
  }, [])
  const selectEmbeddedSubtitleTrack = useCallback((index: number | null) => {
    engineRef.current?.selectEmbeddedSubtitleTrack(index)
  }, [])

  const togglePiP = useCallback(() => {
    const e = engineRef.current
    if (!e || !pipAvailable) return
    void (pip ? e.exitPiP() : e.enterPiP())
  }, [pip, pipAvailable])

  return {
    state,
    time,
    duration,
    bufferedEnd,
    volume,
    muted,
    rate,
    pip,
    pipAvailable,
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
    selectAudioTrack,
    selectEmbeddedSubtitleTrack,
    togglePiP
  }
}
