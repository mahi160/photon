import { Menu as BaseMenu } from '@base-ui/react/menu'
import { Popover as BasePopover } from '@base-ui/react/popover'
import { Select as BaseSelect } from '@base-ui/react/select'
import {
  ArrowSquareOutIcon,
  CaretLeftIcon,
  ClockClockwiseIcon,
  ClosedCaptioningIcon,
  CornersInIcon,
  CornersOutIcon,
  HeadphonesIcon,
  PauseIcon,
  PictureInPictureIcon,
  PlayIcon,
  SkipForwardIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon
} from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { imageUrl, ticksToSeconds, type BaseItem, type MediaStream } from '../lib/jellyfin'
import { useSettings } from '../stores/settings'
import { Stepper, type StepperClasses } from './Stepper'
import { Tip } from './Tip'
import styles from './PlayerControls.module.css'

const stepperClasses: StepperClasses = {
  group: styles.stepperGroup,
  btn: styles.stepBtn,
  input: styles.stepInput
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

function Menu({
  label,
  ariaLabel,
  children,
  open,
  setOpen
}: {
  label: React.ReactNode
  ariaLabel: string
  children: React.ReactNode
  open: boolean
  setOpen: (v: boolean) => void
}): React.JSX.Element {
  return (
    <BaseMenu.Root open={open} onOpenChange={setOpen}>
      <Tip label={ariaLabel}>
        <BaseMenu.Trigger className={styles.iconBtn} aria-label={ariaLabel}>
          {label}
        </BaseMenu.Trigger>
      </Tip>
      <BaseMenu.Portal>
        <BaseMenu.Positioner side="top" align="end" sideOffset={10}>
          <BaseMenu.Popup className={styles.menu}>{children}</BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}

function MenuItem({
  active,
  onClick,
  children
}: {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <BaseMenu.Item
      onClick={onClick}
      className={`${styles.menuItem} ${active ? styles.menuItemActive : ''}`}
    >
      {children}
    </BaseMenu.Item>
  )
}

interface Props {
  visible: boolean
  item: BaseItem
  playMethod: 'DirectPlay' | 'Transcode'
  state: 'playing' | 'paused' | 'buffering'
  time: number
  duration: number
  bufferedEnd: number
  volume: number
  muted: boolean
  rate: number
  pip: boolean
  fullscreen: boolean
  audioStreams: MediaStream[]
  subtitleStreams: MediaStream[]
  audioIndex?: number
  subtitleIndex: number | null
  subtitleDelay: number
  subtitleDelayEnabled: boolean
  nextEpisode?: BaseItem
  onPlayNext?: () => void
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
  onOpenMpv?: () => void // absent = mpv not installed / not applicable
}

const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

export function PlayerControls(p: Props): React.JSX.Element {
  const [menu, setMenu] = useState<'audio' | 'subs' | 'speed' | 'sync' | null>(null)
  const [hover, setHover] = useState(false)
  const [showRemaining, setShowRemaining] = useState(false)

  // wall clock for the top-bar time and the ends-at estimate; 30s tick keeps
  // both honest even while paused
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // timeline hover — timestamp (and chapter, when the item has them) preview
  const [preview, setPreview] = useState<{ x: number; t: number } | null>(null)
  const chapters = (p.item.Chapters ?? [])
    .map((c) => ({ start: ticksToSeconds(c.StartPositionTicks), name: c.Name }))
    .filter((c) => c.start > 0 && c.start < p.duration)
  const previewChapter = preview
    ? [...chapters].reverse().find((c) => c.start <= preview.t)?.name
    : undefined

  // next-up card — the last 30 seconds of an episode announce what follows
  const autoplayNext = useSettings((s) => s.autoplayNext)
  // dismissal is per item — storing the id needs no reset effect on episode change
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const remaining = p.duration - p.time
  const showNextUp =
    !!p.nextEpisode &&
    !!p.onPlayNext &&
    p.duration > 0 &&
    remaining <= 30 &&
    remaining > 0 &&
    dismissedFor !== p.item.Id
  const toggle =
    (m: 'audio' | 'subs' | 'speed' | 'sync') =>
    (open: boolean): void =>
      setMenu(open ? m : null)

  // a pointer resting on the chrome or any open menu pins the controls
  const { onPinChange } = p
  useEffect(() => {
    onPinChange(hover || menu !== null)
  }, [hover, menu, onPinChange])

  // transient center play/pause pulse, like every other video player
  const [pulse, setPulse] = useState<{ kind: 'playing' | 'paused'; id: number } | null>(null)
  const prevState = useRef(p.state)
  useEffect(() => {
    const prev = prevState.current
    prevState.current = p.state
    if (prev === p.state) return
    if (p.state === 'playing' || p.state === 'paused') {
      if (prev === 'playing' || prev === 'paused') setPulse({ kind: p.state, id: Date.now() })
    }
  }, [p.state])

  const pct = p.duration ? `${Math.min(100, (p.time / p.duration) * 100)}%` : '0%'
  const buf = p.duration ? `${Math.min(100, (p.bufferedEnd / p.duration) * 100)}%` : '0%'

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
              {pulse.kind === 'playing' ? <PlayIcon weight="fill" /> : <PauseIcon weight="fill" />}
            </span>
          </div>
        )}

        <div
          className={styles.topScrim}
          onPointerEnter={() => setHover(true)}
          onPointerLeave={() => setHover(false)}
        >
          <div className={styles.topBar}>
            <Tip label="Back">
              <button className={styles.iconBtn} onClick={p.onBack} aria-label="Back">
                <CaretLeftIcon weight="bold" className={styles.icon} />
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
              <span
                className={styles.methodBadge}
                title={
                  p.playMethod === 'DirectPlay'
                    ? 'Playing the original file'
                    : 'Converted by the server'
                }
              >
                <span
                  className={styles.methodDot}
                  data-method={p.playMethod === 'DirectPlay' ? 'direct' : 'transcode'}
                />
                {p.playMethod === 'DirectPlay' ? 'direct' : 'transcode'}
              </span>
              <span className={styles.clock}>
                {new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
          </div>
        </div>

        <div
          className={styles.dock}
          onPointerEnter={() => setHover(true)}
          onPointerLeave={() => setHover(false)}
          onWheel={(e) => p.onVolumeStep(e.deltaY < 0 ? 0.05 : -0.05)}
        >
          <div className={styles.dockInner}>
            <div className={styles.timelineRow}>
              <span className={styles.time}>{fmt(p.time)}</span>
              <div
                className={styles.timelineWrap}
                onPointerMove={(e) => {
                  if (!p.duration) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
                  setPreview({ x: e.clientX - rect.left, t: frac * p.duration })
                }}
                onPointerLeave={() => setPreview(null)}
              >
                {preview && (
                  <div
                    className={styles.previewBubble}
                    style={{ '--x': `${preview.x}px` } as React.CSSProperties}
                  >
                    {previewChapter && (
                      <span className={styles.previewChapter}>{previewChapter}</span>
                    )}
                    {fmt(preview.t)}
                  </div>
                )}
                <input
                  type="range"
                  min={0}
                  max={p.duration || 0}
                  step={1}
                  value={Math.min(p.time, p.duration || 0)}
                  onChange={(e) => p.onSeek(Number(e.target.value))}
                  className={styles.timeline}
                  style={{ '--pct': pct, '--buf': buf } as React.CSSProperties}
                  aria-label="Timeline"
                />
                {chapters.map((c) => (
                  <span
                    key={c.start}
                    className={styles.chapterTick}
                    style={{ '--x': `${(c.start / p.duration) * 100}%` } as React.CSSProperties}
                  />
                ))}
              </div>
              {/* right-click flips between total runtime and time remaining */}
              <span
                className={styles.time}
                title="Right-click to toggle remaining"
                onContextMenu={(e) => {
                  e.preventDefault()
                  setShowRemaining((v) => !v)
                }}
              >
                {showRemaining ? `-${fmt(p.duration - p.time)}` : fmt(p.duration)}
              </span>
            </div>
            <div className={styles.controlsRow}>
              <Tip label={p.state === 'playing' ? 'Pause' : 'Play'} kbd="Space">
                <button
                  className={styles.playBtn}
                  onClick={p.onTogglePlay}
                  aria-label="Play or pause"
                >
                  {p.state === 'playing' ? (
                    <PauseIcon weight="fill" className={styles.icon} />
                  ) : (
                    <PlayIcon weight="fill" className={styles.icon} />
                  )}
                </button>
              </Tip>
              {p.onPlayNext && (
                <Tip label={p.nextEpisode ? `Next: ${p.nextEpisode.Name}` : 'Next episode'}>
                  <button
                    className={styles.iconBtn}
                    onClick={p.onPlayNext}
                    aria-label="Next episode"
                  >
                    <SkipForwardIcon weight="fill" className={styles.icon} />
                  </button>
                </Tip>
              )}
              <div className={styles.volumeGroup}>
                <Tip label={p.muted ? 'Unmute' : 'Mute'} kbd="M">
                  <button className={styles.iconBtn} onClick={p.onMute} aria-label="Mute">
                    {p.muted || p.volume === 0 ? (
                      <SpeakerSlashIcon className={styles.icon} />
                    ) : (
                      <SpeakerHighIcon className={styles.icon} />
                    )}
                  </button>
                </Tip>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={p.muted ? 0 : p.volume}
                  onChange={(e) => p.onVolume(Number(e.target.value))}
                  className={styles.volume}
                  style={{ '--vol': `${(p.muted ? 0 : p.volume) * 100}%` } as React.CSSProperties}
                  aria-label="Volume"
                />
              </div>
              {p.duration > 0 && (
                <span className={styles.endsAt}>
                  ends at{' '}
                  {new Date(
                    now + ((p.duration - p.time) / (p.rate || 1)) * 1000
                  ).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
              )}
              <div className={styles.grow} />

              <Menu
                label={<span className={styles.rateLabel}>{p.rate}×</span>}
                ariaLabel="Playback speed"
                open={menu === 'speed'}
                setOpen={toggle('speed')}
              >
                {speeds.map((s) => (
                  <MenuItem
                    key={s}
                    active={s === p.rate}
                    onClick={() => {
                      p.onRate(s)
                      setMenu(null)
                    }}
                  >
                    {s}×
                  </MenuItem>
                ))}
              </Menu>

              <Menu
                label={<HeadphonesIcon className={styles.icon} />}
                ariaLabel="Audio track"
                open={menu === 'audio'}
                setOpen={toggle('audio')}
              >
                {p.audioStreams.map((a) => (
                  <MenuItem
                    key={a.Index}
                    active={a.Index === p.audioIndex}
                    onClick={() => {
                      p.onSelectAudio(a.Index)
                      setMenu(null)
                    }}
                  >
                    {a.DisplayTitle ?? `Audio ${a.Index}`}
                  </MenuItem>
                ))}
                {!p.audioStreams.length && <MenuItem onClick={() => {}}>Default</MenuItem>}
              </Menu>

              <BaseSelect.Root
                value={p.subtitleIndex}
                onValueChange={(v) => p.onSelectSubtitle(v)}
                open={menu === 'subs'}
                onOpenChange={toggle('subs')}
              >
                <Tip label="Subtitles">
                  <BaseSelect.Trigger className={styles.iconBtn} aria-label="Subtitles">
                    <ClosedCaptioningIcon
                      weight={p.subtitleIndex !== null ? 'fill' : 'regular'}
                      className={styles.icon}
                    />
                  </BaseSelect.Trigger>
                </Tip>
                <BaseSelect.Portal>
                  {/* alignItemWithTrigger: opens with the selected subtitle lined up
                    on the trigger instead of always sliding out from one edge */}
                  <BaseSelect.Positioner alignItemWithTrigger side="top" sideOffset={10}>
                    <BaseSelect.Popup className={styles.menu}>
                      <BaseSelect.Item value={null} className={styles.menuItem}>
                        <BaseSelect.ItemText>Off</BaseSelect.ItemText>
                      </BaseSelect.Item>
                      {p.subtitleStreams.map((s) => (
                        <BaseSelect.Item key={s.Index} value={s.Index} className={styles.menuItem}>
                          <BaseSelect.ItemText>
                            {s.DisplayTitle ?? `Subtitle ${s.Index}`}
                            {s.DeliveryMethod !== 'External' && ' (burned-in)'}
                          </BaseSelect.ItemText>
                        </BaseSelect.Item>
                      ))}
                    </BaseSelect.Popup>
                  </BaseSelect.Positioner>
                </BaseSelect.Portal>
              </BaseSelect.Root>

              <BasePopover.Root open={menu === 'sync'} onOpenChange={toggle('sync')}>
                <Tip label="Subtitle sync" kbd="[ ]">
                  <BasePopover.Trigger
                    className={styles.iconBtn}
                    disabled={!p.subtitleDelayEnabled}
                    aria-label="Subtitle sync"
                  >
                    <ClockClockwiseIcon className={styles.icon} />
                  </BasePopover.Trigger>
                </Tip>
                <BasePopover.Portal>
                  <BasePopover.Positioner side="top" align="center" sideOffset={10}>
                    <BasePopover.Popup className={styles.syncPopup}>
                      <div className={styles.syncLabel}>Subtitle sync</div>
                      {/* delay value shifts cue times directly (cue.startTime += delay,
                        same convention as mpv's sub-delay): a bigger number pushes
                        subtitles LATER, a smaller/negative one pulls them EARLIER. */}
                      <Stepper
                        min={-10}
                        max={10}
                        step={0.5}
                        disabled={!p.subtitleDelayEnabled}
                        value={p.subtitleDelay}
                        onChange={p.onSubtitleDelay}
                        format={{
                          style: 'unit',
                          unit: 'second',
                          unitDisplay: 'narrow',
                          signDisplay: 'exceptZero'
                        }}
                        label="Subtitle delay"
                        decrementLabel="Advance subtitles (show earlier)"
                        incrementLabel="Delay subtitles (show later)"
                        classes={stepperClasses}
                      />
                      <div className={styles.syncHint}>[ earlier · later ]</div>
                    </BasePopover.Popup>
                  </BasePopover.Positioner>
                </BasePopover.Portal>
              </BasePopover.Root>

              {p.onOpenMpv && (
                <Tip label="Open in mpv">
                  <button className={styles.iconBtn} onClick={p.onOpenMpv} aria-label="Open in mpv">
                    <ArrowSquareOutIcon className={styles.icon} />
                  </button>
                </Tip>
              )}
              <Tip label={p.pip ? 'Exit Picture in Picture' : 'Picture in Picture'} kbd="P">
                <button
                  className={`${styles.iconBtn} ${p.pip ? styles.iconBtnActive : ''}`}
                  onClick={p.onPiP}
                  aria-label="Picture in Picture"
                >
                  <PictureInPictureIcon
                    weight={p.pip ? 'fill' : 'regular'}
                    className={styles.icon}
                  />
                </button>
              </Tip>
              <Tip label={p.fullscreen ? 'Exit fullscreen' : 'Fullscreen'} kbd="F">
                <button className={styles.iconBtn} onClick={p.onFullscreen} aria-label="Fullscreen">
                  {p.fullscreen ? (
                    <CornersInIcon className={styles.icon} />
                  ) : (
                    <CornersOutIcon className={styles.icon} />
                  )}
                </button>
              </Tip>
            </div>
          </div>
        </div>
      </div>

      {showNextUp && (
        <div className={styles.nextUp}>
          {imageUrl(p.nextEpisode!, 320) && (
            <img src={imageUrl(p.nextEpisode!, 320)!} alt="" className={styles.nextUpThumb} />
          )}
          <div className={styles.nextUpInfo}>
            <div className={styles.nextUpEyebrow}>
              {autoplayNext ? `up next in ${Math.ceil(remaining)}s` : 'up next'}
            </div>
            <div className={styles.nextUpTitle}>
              S{String(p.nextEpisode!.ParentIndexNumber ?? 0).padStart(2, '0')}E
              {String(p.nextEpisode!.IndexNumber ?? 0).padStart(2, '0')} · {p.nextEpisode!.Name}
            </div>
            <div className={styles.nextUpActions}>
              <button className={styles.nextUpPlay} onClick={p.onPlayNext}>
                Play now
              </button>
              <button className={styles.nextUpDismiss} onClick={() => setDismissedFor(p.item.Id)}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
