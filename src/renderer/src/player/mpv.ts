import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { EngineEvents, LoadRequest, PlaybackEngine } from './engine'
import { parseMpvConfig } from './mpvConfig'
import { useSettings } from '../stores/settings'

type Listeners = { [K in keyof EngineEvents]: Set<EngineEvents[K]> }

interface Tick {
  time: number
  duration: number
  paused: boolean
  coreIdle: boolean
  buffered: number
  volume: number
  muted: boolean
}

// PlaybackEngine backed by in-process libmpv (render API, ADR-0003/0005),
// composited under `element`'s on-screen rect instead of a <video> tag — see
// src-tauri/src/mpv/engine.rs. PiP (ADR-0006 rev.) hands playback off to a
// standalone, borderless/always-on-top *system* mpv process instead — see
// src-tauri/src/pip.rs — pausing this in-process engine for the handoff so
// there's no double audio, and resuming it at the position the spawned mpv
// reports back on close (`pip://ended`, fired whether the user closed it or
// `exitPiP` did).
//
// currentTime()/duration()/paused()/buffered() are synchronous per the
// PlaybackEngine contract, but IPC to Rust is inherently async — this class
// mirrors the last "mpv://tick" snapshot locally instead of round-tripping.
export class MpvEngine implements PlaybackEngine {
  private listeners: Listeners = {
    time: new Set(),
    state: new Set(),
    ended: new Set(),
    error: new Set(),
    pip: new Set(),
    volume: new Set()
  }
  private last: Tick = {
    time: 0,
    duration: 0,
    paused: true,
    coreIdle: false,
    buffered: 0,
    volume: 1,
    muted: false
  }
  private unlisten: UnlistenFn[] = []
  private resizeObserver: ResizeObserver
  private rectListenersAbort = new AbortController()
  private ready: Promise<void>
  // jellyfin stream index -> mpv's track id ("sid") for the current file,
  // populated by load() as it adds each external text subtitle
  private subtitleSids = new Map<number, number>()
  // stashed for enterPiP -- the currently-loaded stream URL and last rate
  // sent to mpv aren't otherwise tracked/observable off this engine
  private url = ''
  private rate = 1

  constructor(private element: HTMLElement) {
    const extraConfig = parseMpvConfig(useSettings.getState().mpvConfig)
    this.ready = invoke('mpv_attach', { extraConfig }).then(() => this.syncRect())

    this.resizeObserver = new ResizeObserver(() => this.syncRect())
    this.resizeObserver.observe(element)
    // element size doesn't change on scroll/window move, but its on-screen
    // *position* does — mpv's surface is positioned in window-local
    // coordinates, so any of these can shift it
    const signal = this.rectListenersAbort.signal
    window.addEventListener('resize', this.syncRect, { signal })
    window.addEventListener('scroll', this.syncRect, { signal, capture: true })

    void listen<Tick>('mpv://tick', ({ payload }) => {
      const prev = this.last
      // duration/buffered have no dedicated event on this interface —
      // `last` is updated before emitting so duration()/buffered() are
      // already fresh for anything reading them off the 'time' callback
      this.last = payload
      this.emit('time', payload.time)
      if (payload.paused !== prev.paused || payload.coreIdle !== prev.coreIdle) {
        this.emit('state', payload.paused ? 'paused' : payload.coreIdle ? 'buffering' : 'playing')
      }
      if (payload.volume !== prev.volume || payload.muted !== prev.muted) {
        this.emit('volume', payload.volume, payload.muted)
      }
    }).then((un) => this.unlisten.push(un))

    void listen('mpv://ended', () => this.emit('ended')).then((un) => this.unlisten.push(un))
    void listen<string>('mpv://error', ({ payload }) => {
      console.error('[playback] mpv error', payload)
      this.emit('error', 'Playback failed.')
    }).then((un) => this.unlisten.push(un))

    // fires once the spawned PiP mpv process exits, for either reason (user
    // closed its window, or exitPiP() killed it) -- single place that
    // resumes this engine, so both paths behave identically
    void listen<number>('pip://ended', ({ payload }) => {
      this.seek(payload)
      this.emit('pip', false)
    }).then((un) => this.unlisten.push(un))
  }

  private emit<K extends keyof EngineEvents>(event: K, ...args: Parameters<EngineEvents[K]>): void {
    for (const cb of this.listeners[event]) (cb as (...a: unknown[]) => void)(...args)
  }

  // top-left CSS px, matching engine.rs's expectation
  private syncRect = (): void => {
    const r = this.element.getBoundingClientRect()
    const visible = r.width > 0 && r.height > 0 && !document.hidden
    void invoke('mpv_set_rect', {
      x: r.left,
      y: r.top,
      w: visible ? r.width : 0,
      h: visible ? r.height : 0
    })
  }

  async load(req: LoadRequest): Promise<void> {
    await this.ready
    this.subtitleSids.clear()
    this.url = req.url
    await invoke('mpv_load', { url: req.url, startSeconds: req.startSeconds })
    // mpv fetches subtitle URLs itself (its own HTTP stack, no CORS) — unlike
    // html5.ts there's no need to fetch/blob these through the main process
    await Promise.all(
      req.textTracks.map(async (t) => {
        try {
          const sid = await invoke<number>('mpv_add_subtitle', { url: t.url, lang: t.language })
          this.subtitleSids.set(t.index, sid)
        } catch (e) {
          console.error('[playback] subtitle add failed', t.label, e)
        }
      })
    )
  }

  play(): void {
    void invoke('mpv_play')
  }

  pause(): void {
    void invoke('mpv_pause')
  }

  seek(seconds: number): void {
    void invoke('mpv_seek', { seconds: Math.max(0, seconds) })
  }

  setRate(rate: number): void {
    this.rate = rate
    void invoke('mpv_set_rate', { rate })
  }

  // chained on `ready`, not fire-and-forget: usePlayerEngine applies the
  // persisted lastVolume/lastMuted at construction, before mpv_attach
  // resolves — a bare invoke can win the (non-FIFO) MpvState lock race, hit
  // the still-empty engine slot, and silently drop the initial value for the
  // whole session. `.then` callbacks fire in registration order, so rapid
  // slider changes stay ordered.
  setVolume(volume: number): void {
    void this.ready.then(() =>
      invoke('mpv_set_volume', { volume: Math.max(0, Math.min(1, volume)) })
    )
  }

  setMuted(muted: boolean): void {
    void this.ready.then(() => invoke('mpv_set_muted', { muted }))
  }

  setTextTrack(index: number | null): void {
    const sid = index === null ? null : (this.subtitleSids.get(index) ?? null)
    void invoke('mpv_set_text_track', { sid })
  }

  setSubtitleDelay(seconds: number): void {
    void invoke('mpv_set_subtitle_delay', { seconds })
  }

  selectAudioTrack(index: number): void {
    void invoke('mpv_select_track', { kind: 'audio', sourceIndex: index })
  }

  selectEmbeddedSubtitleTrack(index: number | null): void {
    void invoke('mpv_select_track', { kind: 'sub', sourceIndex: index })
  }

  async enterPiP(): Promise<void> {
    if (!this.url) return
    const wasPaused = this.last.paused
    this.pause() // avoid double audio while the spawned mpv also plays this stream
    await invoke('pip_start', {
      url: this.url,
      startSeconds: this.last.time,
      volume: this.last.volume,
      muted: this.last.muted,
      rate: this.rate,
      paused: wasPaused
    })
    this.emit('pip', true)
  }

  // Just kills the spawned process -- `pip://ended` (above) does the actual
  // resume, so closing it from here or from its own window behave the same.
  async exitPiP(): Promise<void> {
    await invoke('pip_stop')
  }

  currentTime(): number {
    return this.last.time
  }

  duration(): number {
    return this.last.duration
  }

  paused(): boolean {
    return this.last.paused
  }

  buffered(): number {
    return this.last.buffered
  }

  on<K extends keyof EngineEvents>(event: K, cb: EngineEvents[K]): () => void {
    this.listeners[event].add(cb)
    return () => this.listeners[event].delete(cb)
  }

  destroy(): void {
    this.resizeObserver.disconnect()
    this.rectListenersAbort.abort()
    for (const un of this.unlisten) un()
    this.unlisten = []
    this.subtitleSids.clear()
    void invoke('pip_stop') // don't orphan a floating mpv window if the player unmounts mid-PiP
    void invoke('mpv_destroy')
  }
}
