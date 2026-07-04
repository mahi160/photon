import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { itemQuery } from '../lib/queries'
import { ticksToSeconds } from '../lib/jellyfin'
import { usePlayback, type StartParams } from '../player/usePlayback'
import { useSettings } from '../stores/settings'
import { PlayerControls } from '../components/PlayerControls'
import { SubtitleStyleTag } from '../components/SubtitleStyleTag'
import { useHotkeys } from '../lib/useHotkeys'
import { MpvPlayer } from './MpvPlayer'
import styles from './Player.module.css'

export function Player(): React.JSX.Element {
  const useMpv = useSettings((s) => s.useMpv)
  return useMpv ? <MpvPlayer /> : <WebPlayer />
}

function WebPlayer(): React.JSX.Element {
  const { itemId } = useParams({ from: '/app/player/$itemId' })
  const search = useSearch({ strict: false }) as StartParams
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
          onSelectSubtitle={player.selectSubtitle}
          onSubtitleDelay={player.changeDelay}
          onFullscreen={toggleFullscreen}
          onPiP={engine.togglePiP}
        />
      )}
    </div>
  )
}
