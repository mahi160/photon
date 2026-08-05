import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { EngineEvents, LoadRequest, PlaybackEngine, TextTrackSource } from './engine'
import { guiSubtitleConfig, parseMpvConfig } from './mpvConfig'
import { createSerialQueue } from '../lib/serialQueue'
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

// PlaybackEngine backed by in-process libmpv (render API, ADR-0003/0005), composited under `element`'s on-screen rect — see src-tauri/src/mpv/engine.rs. PiP (ADR-0006) hands off to a standalone system mpv process (src-tauri/src/pip.rs), pausing this engine to avoid double audio and resuming on `pip://ended`.
// currentTime()/duration()/paused()/buffered() are sync per PlaybackEngine contract, but IPC is async — mirrors last "mpv://tick" snapshot instead of round-tripping.
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
  // stashed for enterPiP: not otherwise tracked/observable off this engine. Embedded (non-text) subtitle picks have no URL, so PiP only ever carries text tracks over.
  private url = ''
  private rate = 1
  private textTracks: TextTrackSource[] = []
  private activeTextIndex: number | null = null
  // which text tracks have actually been sub-add'd to mpv -- lazy per-track, see setTextTrack
  private addedTextTracks = new Set<number>()
  // serializes add+select per text-track switch -- without this, rapidly switching subtitles (each an
  // add-if-needed then a select, two awaited IPC round trips) could apply out of call order
  private textTrackQueue = createSerialQueue()
  // set once `mpv_attach` resolves (ADR-0009) -- see `renderBackend()`
  private backend: 'gpu' | 'cpu' | null = null

  constructor(private element: HTMLElement) {
    // GUI subtitle knobs first, so a matching raw passthrough key still wins (same order as engine.rs's hardcoded defaults)
    const settings = useSettings.getState()
    const extraConfig = [...guiSubtitleConfig(settings), ...parseMpvConfig(settings.mpvConfig)]
    this.ready = invoke<string>('mpv_attach', { extraConfig }).then((backend) => {
      this.backend = backend === 'gpu' ? 'gpu' : 'cpu'
      return this.syncRect()
    })

    this.resizeObserver = new ResizeObserver(() => this.syncRect())
    this.resizeObserver.observe(element)
    // element size doesn't change on scroll/window move, but its on-screen position does — mpv's surface uses window-local coords
    const signal = this.rectListenersAbort.signal
    window.addEventListener('resize', this.syncRect, { signal })
    window.addEventListener('scroll', this.syncRect, { signal, capture: true })

    void listen<Tick>('mpv://tick', ({ payload }) => {
      const prev = this.last
      // duration/buffered have no dedicated event — `last` updated before emitting so duration()/buffered() are fresh for anything reading off 'time'
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

    // fires once spawned PiP mpv exits (user closed window, or exitPiP() killed it) -- single place that resumes this engine
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
    this.addedTextTracks = new Set()
    await invoke('mpv_load', { url: req.url, startSeconds: req.startSeconds })
    // External subtitles are no longer added here for every track up front -- a file with many external
    // subs (10+ languages) otherwise pays N HTTP fetches on load for tracks the user may never pick.
    // setTextTrack below adds a track the first time it's actually selected instead.
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

  // Fires directly like play/pause/seek/setRate, not chained on `ready` (only applyInitialVolume needs that) -- needless .then() per call was the "mute reacts slower than other buttons" bug.
  setVolume(volume: number): void {
    void invoke('mpv_set_volume', { volume: Math.max(0, Math.min(1, volume)) })
  }

  setMuted(muted: boolean): void {
    void invoke('mpv_set_muted', { muted })
  }

  // Chained on `ready`, not fire-and-forget: applied before mpv_attach resolves — a bare invoke can win the non-FIFO MpvState lock race and silently drop the initial value for the whole session.
  applyInitialVolume(volume: number, muted: boolean): void {
    void this.ready.then(() => {
      void invoke('mpv_set_volume', { volume: Math.max(0, Math.min(1, volume)) })
      void invoke('mpv_set_muted', { muted })
    })
  }

  // Unlike setVolume/setMuted, these three can legitimately ask for track state that doesn't exist (sub-add never landed, source index absent) -- Rust rejects the promise, so log it instead of an invisible unhandled-rejection, keeping "subtitle doesn't show up" debuggable.
  setTextTrack(index: number | null): void {
    this.activeTextIndex = index
    // queued (not fired directly): lazy-adds the track first if this is the first time it's selected,
    // and switching rapidly between two tracks must apply in call order, not response order
    void this.textTrackQueue(() => this.applyTextTrack(index))
  }

  private async applyTextTrack(index: number | null): Promise<void> {
    if (index !== null && !this.addedTextTracks.has(index)) {
      const t = this.textTracks.find((t) => t.index === index)
      if (t) {
        this.addedTextTracks.add(index)
        try {
          await invoke('mpv_add_subtitle', { url: t.url, lang: t.language, index: t.index })
        } catch (e) {
          console.error('[playback] subtitle add failed', t.label, e)
          this.addedTextTracks.delete(index)
        }
      }
    }
    try {
      await invoke('mpv_set_text_track', { index })
    } catch (e) {
      console.error('[playback] setTextTrack failed', index, e)
    }
  }

  setSubtitleDelay(seconds: number): void {
    void invoke('mpv_set_subtitle_delay', { seconds })
  }

  // Generic mpv command passthrough (screenshot, frame-step, cycle deinterlace, ...) -- one Rust command
  // instead of one #[tauri::command] per mpv command, see commands.rs's mpv_run_command doc.
  runCommand(args: string[]): void {
    void invoke('mpv_run_command', { args }).catch((e) =>
      console.error('[playback] runCommand failed', args, e)
    )
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
    // hands active *text* subtitle (if any) via --sub-file -- spawned mpv fetches it itself, no auth/CORS concerns. Embedded (non-text) pick has no URL, PiP just plays without subs.
    const activeText = this.textTracks.find((t) => t.index === this.activeTextIndex)
    // Pause only *after* pip_start resolves -- pausing unconditionally before the await left a failed spawn stuck on a paused frame with no PiP window and no way back but manual play.
    try {
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
    } catch (e) {
      console.error('[playback] enterPiP failed, staying in the main window', e)
      this.emit('error', 'Picture-in-Picture failed to start.')
      return
    }
    this.pause() // avoid double audio while spawned mpv also plays this stream
    this.emit('pip', true)
  }

  // kills the spawned process -- `pip://ended` above does the actual resume, so closing from here or its own window behaves the same
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
    void invoke('pip_stop') // don't orphan a floating mpv window if player unmounts mid-PiP
    void invoke('mpv_destroy')
  }
}
