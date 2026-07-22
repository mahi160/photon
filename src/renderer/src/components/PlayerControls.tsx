import { CaretLeft, Pause, Play } from 'reicon-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type BaseItem, type MediaSegment, type MediaStream } from '../lib/jellyfin'
import { noFocusOnClick } from '../lib/noFocusOnClick'
import { Tip } from './Tip'
import { TimelinePreview } from './TimelinePreview'
import { ControlsBar } from './ControlsBar'
import { NextUpCard } from './NextUpCard'
import { SkipSegmentButton } from './SkipSegmentButton'
import styles from './PlayerControls.module.css'

export interface Props {
  visible: boolean
  item: BaseItem
  playMethod: 'DirectPlay' | 'Transcode'
  specialBadges: string[]
  // ADR-0009 -- true only when playback fell back to the CPU render path;
  // GPU rendering (the normal case) shows nothing (issue #12)
  cpuFallback: boolean
  state: 'playing' | 'paused' | 'buffering'
  time: number
  duration: number
  bufferedEnd: number
  volume: number
  muted: boolean
  rate: number
  pip: boolean
  pipAvailable: boolean
  fullscreen: boolean
  audioStreams: MediaStream[]
  subtitleStreams: MediaStream[]
  audioIndex?: number
  subtitleIndex: number | null
  subtitleDelay: number
  subtitleDelayEnabled: boolean
  nextEpisode?: BaseItem
  onPlayNext?: () => void
  activeSegment?: MediaSegment
  onSkipSegment?: () => void
  onPinChange: (pinned: boolean) => void
  onBack: () => void
  onTogglePlay: () => void
  onSeek: (t: number) => void
  onVolume: (v: number) => void
  onVolumeStep: (delta: number) => void
  onMute: () => void
  onRate: (r: number) => void
  onSelectAudio: (i: number) => void
  onSelectSubtitle: (i: number | null) => void
  onSubtitleDelay: (s: number) => void
  onFullscreen: () => void
  onPiP: () => void
}

export function PlayerControls(p: Props): React.JSX.Element {
  const [menu, setMenu] = useState<'audio' | 'subs' | 'speed' | 'sync' | null>(null)
  // stable identity — ControlsBar's menu group is memoized against ticking time
  const onToggleMenu = useCallback((m: 'audio' | 'subs' | 'speed' | 'sync', open: boolean) => {
    setMenu(open ? m : null)
    // don't let a closed menu's trigger retain focus -- useHotkeys treats a
    // focused control as "let the browser handle this key" instead of
    // running our shortcuts (:focus-visible guard, see useHotkeys.ts)
    if (!open) (document.activeElement as HTMLElement | null)?.blur()
  }, [])
  const [now, setNow] = useState(() => Date.now())
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const [pulse, setPulse] = useState<{ kind: 'playing' | 'paused'; id: number } | null>(null)
  const prevState = useRef(p.state)

  // wall clock: 30s tick
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // pulse on play/pause state change
  useEffect(() => {
    const prev = prevState.current
    prevState.current = p.state
    if (prev === p.state) return
    if (
      (p.state === 'playing' || p.state === 'paused') &&
      (prev === 'playing' || prev === 'paused')
    ) {
      setPulse({ kind: p.state, id: Date.now() })
    }
  }, [p.state])

  // pin controls open while a menu/popover is open -- hovering the dock
  // *without* one open no longer pins indefinitely (see
  // useAutoHideControls.ts): a motionless cursor resting over the controls
  // used to keep them up forever, which is the "overlay never goes away"
  // report -- any real mouse movement still re-pokes the same idle timer
  // via .stage's own onMouseMove, menu open/close is the only other case
  // that needs to override it.
  const { onPinChange } = p
  useEffect(() => {
    onPinChange(menu !== null)
  }, [menu, onPinChange])

  const remaining = p.duration - p.time
  const showNextUp =
    !!p.nextEpisode &&
    !!p.onPlayNext &&
    p.duration > 0 &&
    remaining <= 30 &&
    remaining > 0 &&
    dismissedFor !== p.item.Id

  return (
    <>
      <div
        className={`${styles.layer} ${p.visible ? '' : styles.hidden}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) p.onTogglePlay()
        }}
      >
        {pulse && (
          <div key={pulse.id} className={styles.pulse}>
            <span className={styles.pulseIcon} onAnimationEnd={() => setPulse(null)}>
              {pulse.kind === 'playing' ? <Play weight="Filled" /> : <Pause weight="Filled" />}
            </span>
          </div>
        )}

        <div className={styles.topScrim}>
          <div className={styles.topBar}>
            <Tip label="Back">
              <button
                className={styles.iconBtn}
                onClick={p.onBack}
                onMouseDown={noFocusOnClick}
                tabIndex={-1}
                aria-label="Back"
              >
                <CaretLeft className={styles.icon} />
              </button>
            </Tip>
            <div className={styles.titleBlock}>
              <div className={styles.titleText}>
                {p.item.Type === 'Episode' ? (p.item.SeriesName ?? p.item.Name) : p.item.Name}
              </div>
              {p.item.Type === 'Episode' && (
                <div className={styles.titleSub}>
                  S{String(p.item.ParentIndexNumber ?? 0).padStart(2, '0')}E
                  {String(p.item.IndexNumber ?? 0).padStart(2, '0')} · {p.item.Name}
                </div>
              )}
            </div>
            {p.state === 'buffering' && <div className={styles.spinner} />}
            <div className={styles.topRight}>
              {p.specialBadges.map((b) => (
                <span key={b} className={styles.methodBadge}>
                  {b}
                </span>
              ))}
              {p.playMethod !== 'DirectPlay' && (
                <span className={styles.methodBadge} title="Converted by the server">
                  <span className={styles.methodDot} data-method="transcode" />
                  transcode
                </span>
              )}
              {p.cpuFallback && (
                <span
                  className={styles.methodBadge}
                  title="GPU rendering unavailable on this machine -- playing back via the slower CPU path"
                >
                  CPU
                </span>
              )}
              <span className={styles.clock}>
                {new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.dock} onWheel={(e) => p.onVolumeStep(e.deltaY < 0 ? 0.05 : -0.05)}>
          <div className={styles.dockInner}>
            <TimelinePreview
              item={p.item}
              duration={p.duration}
              currentTime={p.time}
              bufferedEnd={p.bufferedEnd}
              onSeek={p.onSeek}
            />
            <ControlsBar
              state={p.state}
              time={p.time}
              duration={p.duration}
              rate={p.rate}
              volume={p.volume}
              muted={p.muted}
              pip={p.pip}
              pipAvailable={p.pipAvailable}
              fullscreen={p.fullscreen}
              audioStreams={p.audioStreams}
              audioIndex={p.audioIndex}
              subtitleStreams={p.subtitleStreams}
              subtitleIndex={p.subtitleIndex}
              subtitleDelay={p.subtitleDelay}
              subtitleDelayEnabled={p.subtitleDelayEnabled}
              nextEpisode={p.nextEpisode}
              menuOpen={menu}
              onToggleMenu={onToggleMenu}
              onTogglePlay={p.onTogglePlay}
              onPlayNext={p.onPlayNext}
              onVolume={p.onVolume}
              onVolumeStep={p.onVolumeStep}
              onMute={p.onMute}
              onRate={p.onRate}
              onSelectAudio={p.onSelectAudio}
              onSelectSubtitle={p.onSelectSubtitle}
              onSubtitleDelay={p.onSubtitleDelay}
              onFullscreen={p.onFullscreen}
              onPiP={p.onPiP}
            />
          </div>
        </div>
      </div>

      {p.activeSegment && p.onSkipSegment && (
        <SkipSegmentButton segment={p.activeSegment} onSkip={p.onSkipSegment} />
      )}

      {showNextUp && p.nextEpisode && (
        <NextUpCard
          nextEpisode={p.nextEpisode}
          remaining={remaining}
          duration={p.duration}
          onPlay={p.onPlayNext!}
          onDismiss={() => setDismissedFor(p.item.Id)}
        />
      )}
    </>
  )
}
