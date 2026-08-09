import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { MpvEngine } from './mpv'
import type { LoadRequest, PlaybackEngine, PlaybackStats } from './engine'

// getStats()'s fallback before the engine exists (e.g. panel opened in the sliver before mpv_attach resolves) -- all-zero/empty reads as "nothing to report yet", not an error
const emptyStats: PlaybackStats = {
  hwdecCurrent: '',
  decoderDroppedFrames: 0,
  displayDroppedFrames: 0,
  demuxerCacheDuration: 0,
  cacheSpeed: 0,
  avSync: 0
}

// Mirrors engine state into React, funnels every engine write through one place so component code never holds a second copy of playback state.

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
  // true once mpv has emitted at least one tick for the current load -- session going
  // truthy only means Jellyfin's PlaybackInfo resolved, not that mpv has decoded/painted
  // a frame yet (usePlayback.ts sets session before awaiting engineLoad); Player.tsx
  // keeps its black loading backdrop up until this flips, covering that gap too.
  videoReady: boolean
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
  renderBackend: () => 'gpu' | 'cpu' | null
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
  runCommand: (args: string[]) => void
  getStats: () => Promise<PlaybackStats>
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
  const initialRef = useRef(initial) // applied once at engine creation

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
  const [videoReady, setVideoReady] = useState(false)

  // system mpv is genuinely optional (unlike in-process playback) -- PiP just hides itself when there's nothing to spawn
  useEffect(() => {
    void invoke<boolean>('pip_available').then(setPipAvailable)
  }, [])
  const rateRef = useRef(initial.rate)
  // mirrors let adjustVolume/toggleMute keep stable identities and report the value they just set
  const volumeRef = useRef(initial.volume)
  const mutedRef = useRef(initial.muted)

  const ensureEngine = useCallback((): PlaybackEngine | null => {
    if (!engineRef.current && videoRef.current) {
      const e = new MpvEngine(videoRef.current)
      e.on('time', (t) => {
        setTime(t)
        setDuration(e.duration())
        setBufferedEnd(e.buffered())
        setVideoReady(true)
      })
      e.on('state', setState)
      e.on('error', setError)
      e.on('pip', setPip)
      // volumechange is the single source of truth — covers slider, hotkeys, and anything outside our UI (media keys, PiP window)
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
      setVideoReady(false) // new item -- covered again until its own first tick
      await e.load(req)
      e.setRate(rateRef.current) // rate survives reloads (audio switch, burn-in)
    },
    [ensureEngine]
  )

  const currentTime = useCallback(() => engineRef.current?.currentTime() ?? 0, [])
  const renderBackend = useCallback(() => engineRef.current?.renderBackend() ?? null, [])

  // decide off engine's freshest pause mirror (last tick), not React `state` — during 'buffering' state can't tell playing-but-stalled from paused, would make pause unreachable mid-buffer
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
      e?.setMuted(false) // raising volume implies "want sound"
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

  const runCommand = useCallback((args: string[]) => {
    engineRef.current?.runCommand(args)
  }, [])

  // Playback Info panel's dynamic fields (ADR-0011) -- no local state, panel polls this itself while open
  const getStats = useCallback((): Promise<PlaybackStats> => {
    return engineRef.current?.getStats() ?? Promise.resolve(emptyStats)
  }, [])

  return {
    state,
    videoReady,
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
    renderBackend,
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
    togglePiP,
    runCommand,
    getStats
  }
}
