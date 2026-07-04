import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { itemQuery } from '../lib/queries'
import { ticksToSeconds } from '../lib/jellyfin'
import { resolvePlayable, usePlayback, type StartParams } from '../player/usePlayback'
import { startPlayback } from '../player/session'
import { useSettings } from '../stores/settings'
import { PlayerControls } from '../components/PlayerControls'
import { SubtitleStyleTag } from '../components/SubtitleStyleTag'
import { useHotkeys } from '../lib/useHotkeys'
import { MpvPlayer } from './MpvPlayer'
import styles from './Player.module.css'

export function Player(): React.JSX.Element {
  const mode = useSettings((s) => s.playerMode)
  // one-shot escape hatch: mpv failed to start → built-in player for this item
  const [forceWeb, setForceWeb] = useState(false)
  // mpv → PiP handoff resumes the built-in player at mpv's last position
  const [webResume, setWebResume] = useState<number | undefined>(undefined)
  if (forceWeb) return <WebPlayer startOverride={webResume} />
  if (mode === 'mpv')
    return (
      <MpvPlayer
        onFallback={() => setForceWeb(true)}
        onRequestPiP={(pos) => {
          setWebResume(pos)
          setForceWeb(true)
        }}
      />
    )
  if (mode === 'auto') return <AutoPlayer />
  return <WebPlayer />
}

// Probes the server once: direct play stays in the built-in player, anything
// that would transcode is handed to mpv (which plays the original file).
// ponytail: decided at play start only — a mid-session reload that flips to
// transcoding (e.g. an audio switch) stays in the built-in player.
function AutoPlayer(): React.JSX.Element {
  const { itemId } = useParams({ from: '/app/player/$itemId' })
  const search = useSearch({ strict: false }) as StartParams
  const navigate = useNavigate()
  const item = useQuery(itemQuery(itemId))
  const [choice, setChoice] = useState<'web' | 'mpv' | null>(null)
  const [failed, setFailed] = useState(false)
  const probedFor = useRef<string | null>(null)
  // mpv → PiP handoff resumes the built-in player at mpv's last position
  const [webResume, setWebResume] = useState<number | undefined>(undefined)

  useEffect(() => {
    const it = item.data
    if (!it || probedFor.current === it.Id) return
    probedFor.current = it.Id
    const settings = useSettings.getState()
    resolvePlayable(it)
      .then((playable) =>
        startPlayback(playable, {
          startSeconds: search.start,
          audioStreamIndex: search.audio,
          subtitleStreamIndex: search.sub,
          maxBitrate: settings.maxBitrate || undefined
        })
      )
      .then(async (sess) => {
        // never route to a player that isn't installed — the server can
        // transcode for the built-in player instead
        const useMpv = sess.playMethod !== 'DirectPlay' && (await window.api.mpvCheck())
        setChoice(useMpv ? 'mpv' : 'web')
      })
      .catch(() => setFailed(true))
  }, [item.data, search.start, search.audio, search.sub])

  if (choice === 'web') return <WebPlayer startOverride={webResume} />
  if (choice === 'mpv')
    return (
      <MpvPlayer
        onFallback={() => setChoice('web')}
        onRequestPiP={(pos) => {
          setWebResume(pos)
          setChoice('web')
        }}
      />
    )
  return (
    <div className={styles.stage}>
      {failed && (
        <div className={styles.errorLayer}>
          <p className={styles.errorText}>Playback failed.</p>
          <button onClick={() => navigate({ to: '/' })} className={styles.errorBack}>
            Back to Home
          </button>
        </div>
      )}
    </div>
  )
}

function WebPlayer({ startOverride }: { startOverride?: number } = {}): React.JSX.Element {
  const { itemId } = useParams({ from: '/app/player/$itemId' })
  const routeSearch = useSearch({ strict: false }) as StartParams
  const search =
    startOverride !== undefined ? { ...routeSearch, start: startOverride } : routeSearch
  const navigate = useNavigate()

  const videoRef = useRef<HTMLVideoElement>(null)
  const item = useQuery(itemQuery(itemId))
  const player = usePlayback(videoRef, item.data, search)
  const { engine, session } = player

  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1200)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  }, [])

  // subtitle sync: shift delay by the same step as the slider, text subs only
  function shiftSubtitleDelay(step: number): void {
    if (player.subtitleIndex === null || !player.subtitleIsText) return
    const d = Math.max(-10, Math.min(10, player.subtitleDelay + step))
    player.changeDelay(d)
    showToast(`Subtitle delay: ${d > 0 ? '+' : ''}${d.toFixed(1)}s`)
  }

  // a burned-in pick reloads the stream (server transcode start can take a
  // few seconds) — say so, instead of leaving the picker looking unresponsive
  function selectSubtitle(index: number | null): void {
    player.selectSubtitle(index)
    if (index === null) {
      showToast('Subtitles off')
      return
    }
    const stream = session?.subtitleStreams.find((s) => s.Index === index)
    const label = stream?.DisplayTitle ?? `Subtitle ${index}`
    showToast(
      stream?.DeliveryMethod !== 'External' ? `Switching to ${label}…` : `Subtitles: ${label}`
    )
  }

  // keyboard shortcuts (PRD: Navigation)
  useHotkeys(
    {
      space: () => engine.togglePlay(),
      arrowleft: () => engine.seekBy(-10),
      arrowright: () => engine.seekBy(10),
      arrowup: () => engine.adjustVolume(0.05),
      arrowdown: () => engine.adjustVolume(-0.05),
      f: () => toggleFullscreen(),
      p: () => engine.togglePiP(),
      m: () => engine.toggleMute(),
      '[': () => shiftSubtitleDelay(-0.5),
      ']': () => shiftSubtitleDelay(0.5)
    },
    [engine, toggleFullscreen, player.subtitleIndex, player.subtitleDelay, player.subtitleIsText]
  )

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

  const displayDuration = engine.duration || ticksToSeconds(session?.mediaSource.RunTimeTicks)

  return (
    <div
      className={styles.stage}
      onMouseMove={poke}
      style={{ cursor: controlsVisible ? 'default' : 'none' }}
    >
      <SubtitleStyleTag />
      <video ref={videoRef} className={styles.video} />
      {toast && <div className={styles.toast}>{toast}</div>}
      {player.error && (
        <div className={styles.errorLayer}>
          <p className={styles.errorText}>{player.error}</p>
          <button
            onClick={() => {
              player.retry()
              item.refetch()
            }}
            className={styles.errorRetry}
          >
            Retry
          </button>
          <button onClick={() => navigate({ to: '/' })} className={styles.errorBack}>
            Back to Home
          </button>
        </div>
      )}
      {!player.error && session && (
        <PlayerControls
          visible={controlsVisible}
          title={
            session.item.Type === 'Episode'
              ? `${session.item.SeriesName} · S${session.item.ParentIndexNumber}E${session.item.IndexNumber} · ${session.item.Name}`
              : session.item.Name
          }
          playMethod={session.playMethod}
          state={engine.state}
          time={engine.time}
          duration={displayDuration}
          volume={engine.volume}
          muted={engine.muted}
          rate={engine.rate}
          pip={engine.pip}
          audioStreams={session.audioStreams}
          subtitleStreams={session.subtitleStreams}
          audioIndex={player.audioIndex ?? session.mediaSource.DefaultAudioStreamIndex}
          subtitleIndex={player.subtitleIndex}
          subtitleDelay={player.subtitleDelay}
          subtitleDelayEnabled={player.subtitleIsText && player.subtitleIndex !== null}
          onBack={() => navigate({ to: '/' })}
          onTogglePlay={engine.togglePlay}
          onSeek={engine.seek}
          onVolume={engine.changeVolume}
          onMute={engine.toggleMute}
          onRate={player.changeRate}
          onSelectAudio={player.selectAudio}
          onSelectSubtitle={selectSubtitle}
          onSubtitleDelay={player.changeDelay}
          onFullscreen={toggleFullscreen}
          onPiP={engine.togglePiP}
        />
      )}
    </div>
  )
}
