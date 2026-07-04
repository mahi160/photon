import { useEffect, useRef, useState } from 'react'
import type { MediaStream } from '../lib/jellyfin'
import styles from './PlayerControls.module.css'

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
  children,
  open,
  setOpen
}: {
  label: React.ReactNode
  children: React.ReactNode
  open: boolean
  setOpen: (v: boolean) => void
}): React.JSX.Element {
  return (
    <div className={styles.menuWrap}>
      <button className={styles.iconBtn} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && <div className={styles.menu}>{children}</div>}
    </div>
  )
}

function MenuItem({
  active,
  onClick,
  children,
  disabled
}: {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`${styles.menuItem} ${active ? styles.menuItemActive : ''}`}
    >
      {children}
    </button>
  )
}

interface Props {
  visible: boolean
  title: string
  playMethod: 'DirectPlay' | 'Transcode'
  state: 'playing' | 'paused' | 'buffering'
  time: number
  duration: number
  volume: number
  muted: boolean
  rate: number
  pip: boolean
  audioStreams: MediaStream[]
  subtitleStreams: MediaStream[]
  audioIndex?: number
  subtitleIndex: number | null
  subtitleDelay: number
  subtitleDelayEnabled: boolean
  onBack: () => void
  onTogglePlay: () => void
  onSeek: (t: number) => void
  onVolume: (v: number) => void
  onMute: () => void
  onRate: (r: number) => void
  onSelectAudio: (i: number) => void
  onSelectSubtitle: (i: number | null) => void
  onSubtitleDelay: (s: number) => void
  onFullscreen: () => void
  onPiP: () => void
}

const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

export function PlayerControls(p: Props): React.JSX.Element {
  const [menu, setMenu] = useState<'audio' | 'subs' | 'speed' | null>(null)
  const toggle = (m: 'audio' | 'subs' | 'speed') => (open: boolean) => setMenu(open ? m : null)

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

  const timePct = p.duration ? `${Math.min(100, (p.time / p.duration) * 100)}%` : '0%'
  const volumePct = `${(p.muted ? 0 : p.volume) * 100}%`

  return (
    <div
      className={`${styles.layer} ${p.visible ? '' : styles.hidden}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onTogglePlay()
      }}
    >
      {pulse && (
        <div key={pulse.id} className={styles.pulse}>
          <span className={styles.pulseIcon} onAnimationEnd={() => setPulse(null)}>
            {pulse.kind === 'playing' ? (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
              </svg>
            )}
          </span>
        </div>
      )}

      <div className={styles.topScrim}>
        <div className={styles.topBar}>
          <button className={styles.iconBtn} onClick={p.onBack} aria-label="Back">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={styles.icon}
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className={styles.titleText}>{p.title}</div>
          <span
            className={styles.methodBadge}
            title={
              p.playMethod === 'DirectPlay'
                ? 'Playing the original file'
                : 'Converted by the server'
            }
          >
            {p.playMethod === 'DirectPlay' ? 'Direct' : 'Transcode'}
          </span>
          {p.state === 'buffering' && <div className={styles.spinner} />}
        </div>
      </div>

      <div className={styles.dock}>
        <div className={styles.dockInner}>
          <input
            type="range"
            min={0}
            max={p.duration || 0}
            step={1}
            value={Math.min(p.time, p.duration || 0)}
            onChange={(e) => p.onSeek(Number(e.target.value))}
            className={styles.timeline}
            style={{ '--pct': timePct } as React.CSSProperties}
            aria-label="Timeline"
          />
          <div className={styles.controlsRow}>
            <button className={styles.playBtn} onClick={p.onTogglePlay} aria-label="Play or pause">
              {p.state === 'playing' ? (
                <svg viewBox="0 0 24 24" fill="currentColor" className={styles.icon}>
                  <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" className={styles.icon}>
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <button className={styles.iconBtn} onClick={p.onMute} aria-label="Mute">
              {p.muted || p.volume === 0 ? (
                <svg viewBox="0 0 24 24" fill="currentColor" className={styles.icon}>
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3l3.5 3.5-1.5 1.5-3.5-3.5L11.5 17 10 15.5l3.5-3.5L10 8.5 11.5 7l3.5 3.5L18.5 7 20 8.5 16.5 12z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" className={styles.icon}>
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z" />
                </svg>
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={p.muted ? 0 : p.volume}
              onChange={(e) => p.onVolume(Number(e.target.value))}
              className={styles.volume}
              style={{ '--pct': volumePct } as React.CSSProperties}
              aria-label="Volume"
            />
            <span className={styles.time}>
              {fmt(p.time)} / {fmt(p.duration)}
            </span>
            <div className={styles.grow} />

            <Menu
              label={<span className={styles.rateLabel}>{p.rate}×</span>}
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
              label={
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={styles.icon}
                  aria-label="Audio"
                >
                  <path d="M12 3a4 4 0 0 0-4 4v5a4 4 0 0 0 8 0V7a4 4 0 0 0-4-4zm-7 9a7 7 0 0 0 14 0h-2a5 5 0 0 1-10 0H5z" />
                </svg>
              }
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

            <Menu
              label={
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={styles.icon}
                  aria-label="Subtitles"
                >
                  <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 9v2h8v-2H6zm10 0v2h2v-2h-2zM6 10v2h2v-2H6zm4 0v2h8v-2h-8z" />
                </svg>
              }
              open={menu === 'subs'}
              setOpen={toggle('subs')}
            >
              <MenuItem
                active={p.subtitleIndex === null}
                onClick={() => {
                  p.onSelectSubtitle(null)
                  setMenu(null)
                }}
              >
                Off
              </MenuItem>
              {p.subtitleStreams.map((s) => (
                <MenuItem
                  key={s.Index}
                  active={s.Index === p.subtitleIndex}
                  onClick={() => {
                    p.onSelectSubtitle(s.Index)
                    setMenu(null)
                  }}
                >
                  {s.DisplayTitle ?? `Subtitle ${s.Index}`}
                  {s.DeliveryMethod !== 'External' && ' (burned-in)'}
                </MenuItem>
              ))}
              <div className={styles.delay}>
                Delay: {p.subtitleDelay.toFixed(1)}s
                <input
                  type="range"
                  min={-10}
                  max={10}
                  step={0.5}
                  value={p.subtitleDelay}
                  disabled={!p.subtitleDelayEnabled}
                  onChange={(e) => p.onSubtitleDelay(Number(e.target.value))}
                  className={styles.delaySlider}
                  aria-label="Subtitle delay"
                />
              </div>
            </Menu>

            <button className={styles.iconBtn} onClick={p.onPiP} aria-label="Picture in Picture">
              <svg viewBox="0 0 24 24" fill="currentColor" className={styles.icon}>
                <path d="M19 7h-8v6h8V7zm4-4H1v18h22V3zm-2 16H3V5h18v14z" />
              </svg>
            </button>
            <button className={styles.iconBtn} onClick={p.onFullscreen} aria-label="Fullscreen">
              <svg viewBox="0 0 24 24" fill="currentColor" className={styles.icon}>
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
