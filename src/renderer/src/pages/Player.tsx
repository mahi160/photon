import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { itemQuery } from '../lib/queries'
import { jf, ticksToSeconds, type BaseItem, type ItemsResult } from '../lib/jellyfin'
import { Html5Engine } from '../player/html5'
import type { PlaybackEngine } from '../player/engine'
import {
  reportProgress,
  reportStart,
  reportStopped,
  startPlayback,
  type PlaybackSession
} from '../player/session'
import { useSettings } from '../stores/settings'
import { PlayerControls } from '../components/PlayerControls'
import { SubtitleStyleTag } from '../components/SubtitleStyleTag'

async function resolvePlayable(item: BaseItem): Promise<BaseItem> {
  if (item.Type !== 'Series') return item
  // series card was clicked: play next-up, falling back to the first episode
  const s = await jf<ItemsResult>('/Shows/NextUp', {
    query: { seriesId: item.Id, Limit: 1 }
  })
  if (s.Items[0]) return s.Items[0]
  const eps = await jf<ItemsResult>(`/Shows/${item.Id}/Episodes`, { query: { Limit: 1 } })
  if (eps.Items[0]) return eps.Items[0]
  throw new Error('Nothing to play.')
}

export function Player(): React.JSX.Element {
  const { itemId } = useParams({ from: '/app/player/$itemId' })
  const search = useSearch({ strict: false }) as {
    start?: number
    audio?: number
    sub?: number
  }
  const navigate = useNavigate()
  const settings = useSettings()

  const videoRef = useRef<HTMLVideoElement>(null)
  const engineRef = useRef<PlaybackEngine | null>(null)
  const sessionRef = useRef<PlaybackSession | null>(null)

  const item = useQuery(itemQuery(itemId))

  const [session, setSession] = useState<PlaybackSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<'playing' | 'paused' | 'buffering'>('buffering')
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(settings.rememberSpeed ? settings.lastSpeed : 1)
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null)
  const [audioIndex, setAudioIndex] = useState<number | undefined>(undefined)
  const [subtitleDelay, setSubtitleDelay] = useState(0)
  const [pip, setPip] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1200)
  }, [])

  const load = useCallback(
    async (
      playable: BaseItem,
      opts: { startSeconds?: number; audioStreamIndex?: number; subtitleStreamIndex?: number }
    ) => {
      const video = videoRef.current
      if (!video) return
      if (!engineRef.current) engineRef.current = new Html5Engine(video)
      const engine = engineRef.current
      try {
        const sess = await startPlayback(playable, {
          ...opts,
          maxBitrate: settings.maxBitrate || undefined
        })
        sessionRef.current = sess
        setSession(sess)
        await engine.load({
          url: sess.url,
          hls: sess.hls,
          startSeconds: sess.startSeconds,
          textTracks: sess.textTracks
        })
        engine.setRate(rate)
        reportStart(sess, sess.startSeconds)

        // default subtitle: preferred language, else server default, if enabled
        if (settings.subtitlesEnabled && opts.subtitleStreamIndex === undefined) {
          const preferred =
            sess.textTracks.find((t) => t.language === settings.preferredSubtitleLanguage) ??
            sess.textTracks.find((t) => t.index === sess.mediaSource.DefaultSubtitleStreamIndex)
          if (preferred) {
            engine.setTextTrack(preferred.index)
            setSubtitleIndex(preferred.index)
          }
        }

        navigator.mediaSession.metadata = new MediaMetadata({
          title: playable.Name,
          artist: playable.SeriesName ?? ''
        })
      } catch {
        setError('Playback failed.')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.maxBitrate, settings.subtitlesEnabled, settings.preferredSubtitleLanguage]
  )

  // initial load once item arrives
  const loadedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!item.data || loadedFor.current === item.data.Id) return
    loadedFor.current = item.data.Id
    setError(null)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset for a new item, not a render loop
    if (search.audio !== undefined) setAudioIndex(search.audio)
    resolvePlayable(item.data)
      .then((playable) =>
        load(playable, {
          startSeconds: search.start,
          audioStreamIndex: search.audio,
          subtitleStreamIndex: search.sub
        })
      )
      .catch(() => setError('Nothing to play.'))
  }, [item.data, load, search.start, search.audio, search.sub])

  async function handleEnded(): Promise<void> {
    const playable = sessionRef.current?.item
    if (settings.autoplayNext && playable?.Type === 'Episode' && playable.SeriesId) {
      // ponytail: relies on the server having processed the Stopped report; if the
      // same episode comes back we bail to avoid a loop
      const next = await jf<ItemsResult>('/Shows/NextUp', {
        query: { seriesId: playable.SeriesId, Limit: 1 }
      })
        .then((r) => r.Items[0] ?? null)
        .catch(() => null)
      if (next && next.Id !== playable.Id) {
        loadedFor.current = next.Id
        await load(next, { startSeconds: 0 })
        navigate({
          to: '/player/$itemId',
          params: { itemId: next.Id },
          replace: true
        })
        return
      }
    }
    navigate({ to: '/' })
  }

  // engine events
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !session) return
    const offs = [
      engine.on('time', (t) => {
        setTime(t)
        setDuration(engine.duration() || ticksToSeconds(session.mediaSource.RunTimeTicks))
      }),
      engine.on('state', setState),
      engine.on('error', setError),
      engine.on('pip', setPip),
      engine.on('ended', () => {
        reportStopped(session, engine.currentTime())
        void handleEnded()
      })
    ]
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // progress reporting: every 10s + on pause
  useEffect(() => {
    const id = setInterval(() => {
      const sess = sessionRef.current
      const engine = engineRef.current
      if (sess && engine) reportProgress(sess, engine.currentTime(), state === 'paused')
    }, 10_000)
    return () => clearInterval(id)
  }, [state])

  // stopped report + engine teardown on unmount
  useEffect(() => {
    return () => {
      const sess = sessionRef.current
      const engine = engineRef.current
      if (sess && engine) reportStopped(sess, engine.currentTime())
      engine?.destroy()
      engineRef.current = null
    }
  }, [])

  const togglePlay = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    if (state === 'playing') {
      engine.pause()
      if (sessionRef.current) reportProgress(sessionRef.current, engine.currentTime(), true)
    } else engine.play()
  }, [state])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  }, [])

  const togglePiP = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    void (pip ? engine.exitPiP() : engine.enterPiP())
  }, [pip])

  // keyboard shortcuts (PRD: Navigation)
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const engine = engineRef.current
      if (!engine) return
      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          engine.seek(engine.currentTime() - 10)
          break
        case 'ArrowRight':
          engine.seek(engine.currentTime() + 10)
          break
        case 'ArrowUp': {
          e.preventDefault()
          const v = Math.min(1, volume + 0.05)
          engine.setVolume(v)
          setVolume(v)
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          const v = Math.max(0, volume - 0.05)
          engine.setVolume(v)
          setVolume(v)
          break
        }
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        case 'p':
        case 'P':
          togglePiP()
          break
        case 'm':
        case 'M':
          engine.setMuted(!muted)
          setMuted(!muted)
          break
        case '[':
        case ']': {
          // subtitle sync: shift delay by the same step as the slider, text subs only
          if (subtitleIndex === null) break
          const isText = session?.textTracks.some((t) => t.index === subtitleIndex) ?? false
          if (!isText) break
          const step = e.key === '[' ? -0.5 : 0.5
          const d = Math.max(-10, Math.min(10, subtitleDelay + step))
          changeDelay(d)
          showToast(`Subtitle delay: ${d > 0 ? '+' : ''}${d.toFixed(1)}s`)
          break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    togglePlay,
    toggleFullscreen,
    togglePiP,
    volume,
    muted,
    session,
    subtitleIndex,
    subtitleDelay,
    showToast
  ])

  // auto-hide controls
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const poke = useCallback(() => {
    setControlsVisible(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControlsVisible(false), 3000)
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot initial reveal
    poke()
    return () => clearTimeout(hideTimer.current)
  }, [poke])

  const displayDuration = useMemo(
    () => duration || ticksToSeconds(session?.mediaSource.RunTimeTicks),
    [duration, session]
  )

  function selectSubtitle(index: number | null): void {
    const engine = engineRef.current
    const sess = sessionRef.current
    if (!engine || !sess) return
    if (index === null) {
      engine.setTextTrack(null)
      setSubtitleIndex(null)
      return
    }
    const isText = sess.textTracks.some((t) => t.index === index)
    if (isText) {
      engine.setTextTrack(index)
      setSubtitleIndex(index)
    } else {
      // burn-in: requires a new transcode session at the current position
      setSubtitleIndex(index)
      void load(sess.item, {
        startSeconds: engine.currentTime(),
        audioStreamIndex: audioIndex,
        subtitleStreamIndex: index
      })
    }
  }

  function selectAudio(index: number): void {
    const engine = engineRef.current
    const sess = sessionRef.current
    if (!engine || !sess) return
    setAudioIndex(index)
    // HTML5 can't switch embedded audio tracks: reload stream with the new index
    void load(sess.item, {
      startSeconds: engine.currentTime(),
      audioStreamIndex: index,
      ...(subtitleIndex !== null && !sess.textTracks.some((t) => t.index === subtitleIndex)
        ? { subtitleStreamIndex: subtitleIndex }
        : {})
    })
  }

  function changeDelay(seconds: number): void {
    engineRef.current?.setSubtitleDelay(seconds)
    setSubtitleDelay(seconds)
  }

  const subtitleIsText =
    subtitleIndex === null || (session?.textTracks.some((t) => t.index === subtitleIndex) ?? true)

  return (
    <div
      className="relative h-full bg-black"
      onMouseMove={poke}
      style={{ cursor: controlsVisible ? 'default' : 'none' }}
    >
      <SubtitleStyleTag />
      <video ref={videoRef} className="h-full w-full" />
      {toast && (
        <div className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 rounded-lg bg-black/80 px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80">
          <p className="text-neutral-300">{error}</p>
          <button
            onClick={() => {
              setError(null)
              loadedFor.current = null
              item.refetch()
            }}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white"
          >
            Retry
          </button>
          <button onClick={() => navigate({ to: '/' })} className="text-sm text-neutral-500">
            Back to Home
          </button>
        </div>
      )}
      {!error && session && (
        <PlayerControls
          visible={controlsVisible}
          title={
            session.item.Type === 'Episode'
              ? `${session.item.SeriesName} · S${session.item.ParentIndexNumber}E${session.item.IndexNumber} · ${session.item.Name}`
              : session.item.Name
          }
          state={state}
          time={time}
          duration={displayDuration}
          volume={volume}
          muted={muted}
          rate={rate}
          pip={pip}
          audioStreams={session.audioStreams}
          subtitleStreams={session.subtitleStreams}
          audioIndex={audioIndex ?? session.mediaSource.DefaultAudioStreamIndex}
          subtitleIndex={subtitleIndex}
          subtitleDelay={subtitleDelay}
          subtitleDelayEnabled={subtitleIsText && subtitleIndex !== null}
          onBack={() => navigate({ to: '/' })}
          onTogglePlay={togglePlay}
          onSeek={(t) => engineRef.current?.seek(t)}
          onVolume={(v) => {
            engineRef.current?.setVolume(v)
            setVolume(v)
          }}
          onMute={() => {
            engineRef.current?.setMuted(!muted)
            setMuted(!muted)
          }}
          onRate={(r) => {
            engineRef.current?.setRate(r)
            setRate(r)
            if (settings.rememberSpeed) settings.set({ lastSpeed: r })
          }}
          onSelectAudio={selectAudio}
          onSelectSubtitle={selectSubtitle}
          onSubtitleDelay={changeDelay}
          onFullscreen={toggleFullscreen}
          onPiP={togglePiP}
        />
      )}
    </div>
  )
}
