import { memo } from 'react'
import { Menu as BaseMenu } from '@base-ui/react/menu'
import { Select as BaseSelect } from '@base-ui/react/select'
import { Popover as BasePopover } from '@base-ui/react/popover'
import {
  ArrowUpRightSquare,
  Cc,
  Headphones,
  History,
  Maximize,
  Minimize,
  Mute,
  Pause,
  Pip,
  Play,
  ForwardStep,
  Volume
} from 'reicon-react'
import type { MediaStream, BaseItem } from '../lib/jellyfin'
import { Stepper, type StepperClasses } from './Stepper'
import { Tip } from './Tip'
import { TrackSelectMenu } from './TrackSelectMenu'
import styles from './PlayerControls.module.css'

const stepperClasses: StepperClasses = {
  group: styles.stepperGroup,
  btn: styles.stepBtn,
  input: styles.stepInput
}

const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

export interface ControlsBarProps {
  state: 'playing' | 'paused' | 'buffering'
  time: number
  duration: number
  rate: number
  volume: number
  muted: boolean
  pip: boolean
  fullscreen: boolean
  audioStreams: MediaStream[]
  audioIndex?: number
  subtitleStreams: MediaStream[]
  subtitleIndex: number | null
  subtitleDelay: number
  subtitleDelayEnabled: boolean
  nextEpisode?: BaseItem
  menuOpen: 'audio' | 'subs' | 'speed' | 'sync' | null
  onToggleMenu: (menu: 'audio' | 'subs' | 'speed' | 'sync', open: boolean) => void
  onTogglePlay: () => void
  onPlayNext?: () => void
  onVolume: (v: number) => void
  onVolumeStep: (delta: number) => void
  onMute: () => void
  onRate: (r: number) => void
  onSelectAudio: (i: number) => void
  onSelectSubtitle: (i: number | null) => void
  onSubtitleDelay: (s: number) => void
  onFullscreen: () => void
  onPiP: () => void
  onOpenMpv?: () => void
}

function EndTimeDisplay({
  duration,
  currentTime,
  rate
}: {
  duration: number
  currentTime: number
  rate: number
}): React.JSX.Element | null {
  if (duration <= 0) return null
  // ponytail: genuinely needs the wall clock every render (playback ticks
  // currentTime forward) — no pure/lazy-init substitute exists for "now"
  // eslint-disable-next-line react-hooks/purity
  const endsAt = new Date(Date.now() + ((duration - currentTime) / (rate || 1)) * 1000)
  return (
    <span className={styles.endsAt}>
      ends at {endsAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
    </span>
  )
}

// Everything below is untouched by playback ticks (speed/audio/subtitle/sync
// menus, mpv/PiP/fullscreen). It's memoized so those base-ui popovers don't
// reconcile on every `time` update from the video element — only when a
// track/menu actually changes. None of ControlsBar's other props (time,
// duration, play/pause state, volume) are in this list on purpose.
type PlaybackMenusProps = Pick<
  ControlsBarProps,
  | 'rate'
  | 'audioStreams'
  | 'audioIndex'
  | 'subtitleStreams'
  | 'subtitleIndex'
  | 'subtitleDelay'
  | 'subtitleDelayEnabled'
  | 'pip'
  | 'fullscreen'
  | 'menuOpen'
  | 'onToggleMenu'
  | 'onRate'
  | 'onSelectAudio'
  | 'onSelectSubtitle'
  | 'onSubtitleDelay'
  | 'onFullscreen'
  | 'onPiP'
  | 'onOpenMpv'
>

const PlaybackMenus = memo(function PlaybackMenus({
  rate,
  audioStreams,
  audioIndex,
  subtitleStreams,
  subtitleIndex,
  subtitleDelay,
  subtitleDelayEnabled,
  pip,
  fullscreen,
  menuOpen,
  onToggleMenu,
  onRate,
  onSelectAudio,
  onSelectSubtitle,
  onSubtitleDelay,
  onFullscreen,
  onPiP,
  onOpenMpv
}: PlaybackMenusProps): React.JSX.Element {
  return (
    <>
      <BaseMenu.Root
        open={menuOpen === 'speed'}
        onOpenChange={(open) => onToggleMenu('speed', open)}
      >
        <Tip label="Playback speed">
          <BaseMenu.Trigger className={styles.iconBtn} aria-label="Playback speed">
            <span className={styles.rateLabel}>{rate}×</span>
          </BaseMenu.Trigger>
        </Tip>
        <BaseMenu.Portal>
          <BaseMenu.Positioner side="top" align="end" sideOffset={10}>
            <BaseMenu.Popup className={styles.menu}>
              {speeds.map((s) => (
                <BaseMenu.Item
                  key={s}
                  onClick={() => {
                    onRate(s)
                    onToggleMenu('speed', false)
                  }}
                  className={`${styles.menuItem} ${rate === s ? styles.menuItemActive : ''}`}
                >
                  {s}×
                </BaseMenu.Item>
              ))}
            </BaseMenu.Popup>
          </BaseMenu.Positioner>
        </BaseMenu.Portal>
      </BaseMenu.Root>

      <TrackSelectMenu
        label={<Headphones className={styles.icon} />}
        ariaLabel="Audio track"
        open={menuOpen === 'audio'}
        onOpenChange={(open) => onToggleMenu('audio', open)}
        value={audioIndex}
        tracks={audioStreams}
        onSelect={onSelectAudio}
        defaultLabel="Default"
      />

      <BaseSelect.Root
        value={subtitleIndex}
        onValueChange={(v) => onSelectSubtitle(v)}
        open={menuOpen === 'subs'}
        onOpenChange={(open) => onToggleMenu('subs', open)}
      >
        <Tip label="Subtitles">
          <BaseSelect.Trigger className={styles.iconBtn} aria-label="Subtitles">
            <Cc weight={subtitleIndex !== null ? 'Filled' : 'Outline'} className={styles.icon} />
          </BaseSelect.Trigger>
        </Tip>
        <BaseSelect.Portal>
          <BaseSelect.Positioner alignItemWithTrigger side="top" sideOffset={10}>
            <BaseSelect.Popup className={styles.menu}>
              <BaseSelect.Item value={null} className={styles.menuItem}>
                <BaseSelect.ItemText>Off</BaseSelect.ItemText>
              </BaseSelect.Item>
              {subtitleStreams.map((s) => (
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

      <BasePopover.Root
        open={menuOpen === 'sync'}
        onOpenChange={(open) => onToggleMenu('sync', open)}
      >
        <Tip label="Subtitle sync" kbd="[ ]">
          <BasePopover.Trigger
            className={styles.iconBtn}
            disabled={!subtitleDelayEnabled}
            aria-label="Subtitle sync"
          >
            <History className={styles.icon} />
          </BasePopover.Trigger>
        </Tip>
        <BasePopover.Portal>
          <BasePopover.Positioner side="top" align="center" sideOffset={10}>
            <BasePopover.Popup className={styles.syncPopup}>
              <div className={styles.syncLabel}>Subtitle sync</div>
              <Stepper
                min={-10}
                max={10}
                step={0.5}
                disabled={!subtitleDelayEnabled}
                value={subtitleDelay}
                onChange={onSubtitleDelay}
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

      {onOpenMpv && (
        <Tip label="Open in mpv">
          <button className={styles.iconBtn} onClick={onOpenMpv} aria-label="Open in mpv">
            <ArrowUpRightSquare className={styles.icon} />
          </button>
        </Tip>
      )}

      <Tip label={pip ? 'Exit Picture in Picture' : 'Picture in Picture'} kbd="P">
        <button
          className={`${styles.iconBtn} ${pip ? styles.iconBtnActive : ''}`}
          onClick={onPiP}
          aria-label="Picture in Picture"
        >
          <Pip weight={pip ? 'Filled' : 'Outline'} className={styles.icon} />
        </button>
      </Tip>

      <Tip label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} kbd="F">
        <button className={styles.iconBtn} onClick={onFullscreen} aria-label="Fullscreen">
          {fullscreen ? <Minimize className={styles.icon} /> : <Maximize className={styles.icon} />}
        </button>
      </Tip>
    </>
  )
})

export function ControlsBar({
  state,
  time,
  duration,
  rate,
  volume,
  muted,
  pip,
  fullscreen,
  audioStreams,
  audioIndex,
  subtitleStreams,
  subtitleIndex,
  subtitleDelay,
  subtitleDelayEnabled,
  nextEpisode,
  menuOpen,
  onToggleMenu,
  onTogglePlay,
  onPlayNext,
  onVolume,
  onVolumeStep,
  onMute,
  onRate,
  onSelectAudio,
  onSelectSubtitle,
  onSubtitleDelay,
  onFullscreen,
  onPiP,
  onOpenMpv
}: ControlsBarProps): React.JSX.Element {
  return (
    <div className={styles.controlsRow}>
      <Tip label={state === 'playing' ? 'Pause' : 'Play'} kbd="Space">
        <button className={styles.playBtn} onClick={onTogglePlay} aria-label="Play or pause">
          {state === 'playing' ? (
            <Pause weight="Filled" className={styles.icon} />
          ) : (
            <Play weight="Filled" className={styles.icon} />
          )}
        </button>
      </Tip>

      {onPlayNext && (
        <Tip label={nextEpisode ? `Next: ${nextEpisode.Name}` : 'Next episode'}>
          <button className={styles.iconBtn} onClick={onPlayNext} aria-label="Next episode">
            <ForwardStep weight="Filled" className={styles.icon} />
          </button>
        </Tip>
      )}

      <div className={styles.volumeGroup}>
        <Tip label={muted ? 'Unmute' : 'Mute'} kbd="M">
          <button className={styles.iconBtn} onClick={onMute} aria-label="Mute">
            {muted || volume === 0 ? (
              <Mute className={styles.icon} />
            ) : (
              <Volume className={styles.icon} />
            )}
          </button>
        </Tip>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          className={styles.volume}
          style={{ '--vol': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
          aria-label="Volume"
          onWheel={(e) => onVolumeStep(e.deltaY < 0 ? 0.05 : -0.05)}
        />
      </div>

      <EndTimeDisplay duration={duration} currentTime={time} rate={rate} />

      <div className={styles.grow} />

      <PlaybackMenus
        rate={rate}
        audioStreams={audioStreams}
        audioIndex={audioIndex}
        subtitleStreams={subtitleStreams}
        subtitleIndex={subtitleIndex}
        subtitleDelay={subtitleDelay}
        subtitleDelayEnabled={subtitleDelayEnabled}
        pip={pip}
        fullscreen={fullscreen}
        menuOpen={menuOpen}
        onToggleMenu={onToggleMenu}
        onRate={onRate}
        onSelectAudio={onSelectAudio}
        onSelectSubtitle={onSelectSubtitle}
        onSubtitleDelay={onSubtitleDelay}
        onFullscreen={onFullscreen}
        onPiP={onPiP}
        onOpenMpv={onOpenMpv}
      />
    </div>
  )
}
