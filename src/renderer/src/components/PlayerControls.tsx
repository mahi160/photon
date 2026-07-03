import { useState } from 'react'
import type { MediaStream } from '../lib/jellyfin'

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

const btn = 'rounded-lg p-2 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white'

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
    <div className="relative">
      <button className={btn} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div className="absolute bottom-12 right-0 max-h-72 w-64 overflow-y-auto rounded-xl bg-surface-1/95 p-2 shadow-xl backdrop-blur">
          {children}
        </div>
      )}
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
      className={`block w-full truncate rounded-lg px-3 py-1.5 text-left text-sm ${
        active ? 'bg-accent/20 text-accent' : 'text-neutral-300 hover:bg-white/5'
      } disabled:opacity-40`}
    >
      {children}
    </button>
  )
}

interface Props {
  visible: boolean
  title: string
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

  return (
    <div
      className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-150 ${
        p.visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onTogglePlay()
      }}
    >
      <div className="p-4">
        <div className="inline-flex max-w-[70%] items-center gap-2 rounded-xl bg-surface-1/80 py-1.5 pl-1.5 pr-4 shadow-lg backdrop-blur">
          <button className={btn} onClick={p.onBack} aria-label="Back">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="size-5"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="truncate text-sm text-neutral-200">{p.title}</div>
          {p.state === 'buffering' && (
            <div className="size-4 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
          )}
        </div>
      </div>

      <div className="mx-auto mb-6 w-[min(92%,56rem)] rounded-2xl bg-surface-1/80 p-4 shadow-xl backdrop-blur">
        <input
          type="range"
          min={0}
          max={p.duration || 0}
          step={1}
          value={Math.min(p.time, p.duration || 0)}
          onChange={(e) => p.onSeek(Number(e.target.value))}
          className="h-1 w-full cursor-pointer accent-(--color-accent)"
          aria-label="Timeline"
        />
        <div className="mt-2 flex items-center gap-1">
          <button className={btn} onClick={p.onTogglePlay} aria-label="Play or pause">
            {p.state === 'playing' ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-6">
                <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-6">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <button className={btn} onClick={p.onMute} aria-label="Mute">
            {p.muted || p.volume === 0 ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3l3.5 3.5-1.5 1.5-3.5-3.5L11.5 17 10 15.5l3.5-3.5L10 8.5 11.5 7l3.5 3.5L18.5 7 20 8.5 16.5 12z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
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
            className="h-1 w-20 cursor-pointer accent-(--color-accent)"
            aria-label="Volume"
          />
          <span className="ml-3 text-xs tabular-nums text-neutral-400">
            {fmt(p.time)} / {fmt(p.duration)}
          </span>
          <div className="flex-1" />

          <Menu
            label={<span className="text-xs">{p.rate}×</span>}
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
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-label="Audio">
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
                className="size-5"
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
            <div className="mt-2 border-t border-white/10 px-3 pt-2 text-xs text-neutral-400">
              Delay: {p.subtitleDelay.toFixed(1)}s
              <input
                type="range"
                min={-10}
                max={10}
                step={0.5}
                value={p.subtitleDelay}
                disabled={!p.subtitleDelayEnabled}
                onChange={(e) => p.onSubtitleDelay(Number(e.target.value))}
                className="mt-1 h-1 w-full cursor-pointer accent-(--color-accent) disabled:opacity-40"
                aria-label="Subtitle delay"
              />
            </div>
          </Menu>

          <button className={btn} onClick={p.onPiP} aria-label="Picture in Picture">
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
              <path d="M19 7h-8v6h8V7zm4-4H1v18h22V3zm-2 16H3V5h18v14z" />
            </svg>
          </button>
          <button className={btn} onClick={p.onFullscreen} aria-label="Fullscreen">
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
