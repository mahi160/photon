import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { EngineEvents, LoadRequest, PlaybackEngine, TextTrackSource } from './engine'
import { guiSubtitleConfig, parseMpvConfig } from './mpvConfig'
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
  // stashed for enterPiP -- the currently-loaded stream URL, last rate, and
  // active text-subtitle (if any) aren't otherwise tracked/observable off
  // this engine. Embedded (non-text) subtitle picks have no URL to hand a
  // spawned PiP process, so PiP only ever carries text tracks over.
  private url = ''
  private rate = 1
  private textTracks: TextTrackSource[] = []
  private activeTextIndex: number | null = null
  // set once `mpv_attach` resolves (ADR-0009) -- see `renderBackend()`
  private backend: 'gpu' | 'cpu' | null = null

  constructor(private element: HTMLElement) {
    // GUI subtitle knobs first, so a matching key in the raw passthrough
    // below still wins (same order as engine.rs's own hardcoded defaults
    // vs. this whole extraConfig list) -- see guiSubtitleConfig's doc.
    const settings = useSettings.getState()
    const extraConfig = [...guiSubtitleConfig(settings), ...parseMpvConfig(settings.mpvConfig)]
    this.ready = invoke<string>('mpv_attach', { extraConfig }).then((backend) => {
      this.backend = backend === 'gpu' ? 'gpu' : 'cpu'
      return this.syncRect()
    })

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
    this.url = req.url
    this.textTracks = req.textTracks
    this.activeTextIndex = null
    await invoke('mpv_load', { url: req.url, startSeconds: req.startSeconds })
    // mpv fetches subtitle URLs itself (its own HTTP stack, no CORS) — no
    // need to fetch/blob these through the main process.
    // Rust owns the index -> mpv "sid" mapping (and the load-race deferral
    // for it, see engine.rs's add_subtitle) -- no map to keep in sync here.
    await Promise.all(
      req.textTracks.map(async (t) => {
        try {
          await invoke('mpv_add_subtitle', { url: t.url, lang: t.language, index: t.index })
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

  // Fires directly, like play/pause/seek/setRate -- *not* chained on `ready`
  // here (only the one-time initial apply in `applyInitialVolume` needs
  // that, see its own doc). Every call after construction reaches an
  // already-attached engine; adding a needless `.then()` per call was the
  // "mute doesn't react as fast as the other buttons" report.
  setVolume(volume: number): void {
    void invoke('mpv_set_volume', { volume: Math.max(0, Math.min(1, volume)) })
  }

  setMuted(muted: boolean): void {
    void invoke('mpv_set_muted', { muted })
  }

  // Chained on `ready`, not fire-and-forget: usePlayerEngine applies the
  // persisted lastVolume/lastMuted right at construction, before mpv_attach
  // resolves — a bare invoke can win the (non-FIFO) MpvState lock race, hit
  // the still-empty engine slot, and silently drop the initial value for the
  // whole session. Only this one-time call needs the wait; every later
  // setVolume/setMuted (user actions) fires straight through above.
  applyInitialVolume(volume: number, muted: boolean): void {
    void this.ready.then(() => {
      void invoke('mpv_set_volume', { volume: Math.max(0, Math.min(1, volume)) })
      void invoke('mpv_set_muted', { muted })
    })
  }

  // These three (unlike setVolume/setMuted above) resolve against server-
  // reported track state (add_subtitle's index -> mpv "sid" map, or mpv's
  // own demuxed track-list) that can legitimately not have what's asked --
  // e.g. a text track whose sub-add never landed, or a source index mpv's
  // own file never actually contains. Rust surfaces that as a rejected
  // promise; fire-and-forget silently dropped it into an unhandled-
  // rejection (only visible with devtools already open, no context) --
  // logged here instead so "a subtitle just doesn't show up" always leaves
  // a paper trail.
  setTextTrack(index: number | null): void {
    this.activeTextIndex = index
    void invoke('mpv_set_text_track', { index }).catch((e) =>
      console.error('[playback] setTextTrack failed', index, e)
    )
  }

  setSubtitleDelay(seconds: number): void {
    void invoke('mpv_set_subtitle_delay', { seconds })
  }

  selectAudioTrack(index: number): void {
    void invoke('mpv_select_track', { kind: 'audio', sourceIndex: index }).catch((e) =>
      console.error('[playback] selectAudioTrack failed', index, e)
    )
  }

  selectEmbeddedSubtitleTrack(index: number | null): void {
    void invoke('mpv_select_track', { kind: 'sub', sourceIndex: index }).catch((e) =>
      console.error('[playback] selectEmbeddedSubtitleTrack failed', index, e)
    )
  }

  async enterPiP(): Promise<void> {
    if (!this.url) return
    const wasPaused = this.last.paused
    this.pause() // avoid double audio while the spawned mpv also plays this stream
    // hands the active *text* subtitle (if any) over via --sub-file -- the
    // spawned mpv fetches it itself, same as sub-add does for the in-process
    // engine, no auth/CORS concerns either. An embedded (non-text) pick has
    // no URL to give it; PiP just plays without subs in that case, same as
    // if none were selected at all.
    const activeText = this.textTracks.find((t) => t.index === this.activeTextIndex)
    await invoke('pip_start', {
      url: this.url,
      startSeconds: this.last.time,
      volume: this.last.volume,
      muted: this.last.muted,
      rate: this.rate,
      paused: wasPaused,
      subUrl: activeText?.url,
      subLang: activeText?.language
    })
    this.emit('pip', true)
  }

  // Just kills the spawned process -- `pip://ended` (above) does the actual
  // resume, so closing it from here or from its own window behave the same.
  async exitPiP(): Promise<void> {
    await invoke('pip_stop')
  }

  renderBackend(): 'gpu' | 'cpu' | null {
    return this.backend
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
    void invoke('pip_stop') // don't orphan a floating mpv window if the player unmounts mid-PiP
    void invoke('mpv_destroy')
  }
}
