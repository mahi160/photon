import Hls from 'hls.js'
import type { EngineEvents, LoadRequest, PlaybackEngine } from './engine'

type Listeners = { [K in keyof EngineEvents]: Set<EngineEvents[K]> }

export class Html5Engine implements PlaybackEngine {
  private hls: Hls | null = null
  private delay = 0 // desired subtitle shift, seconds
  // shift actually applied to each track's cues — tracks load cues lazily and
  // keep them across mode changes, so the applied amount is tracked per track
  private appliedDelay = new WeakMap<TextTrack, number>()
  private abort = new AbortController()
  private listeners: Listeners = {
    time: new Set(),
    state: new Set(),
    ended: new Set(),
    error: new Set(),
    pip: new Set()
  }

  constructor(private video: HTMLVideoElement) {
    // external VTT tracks are cross-origin (Jellyfin server) — without this the
    // browser silently refuses to fetch/render them
    video.crossOrigin = 'anonymous'
    const signal = this.abort.signal
    video.addEventListener('timeupdate', this.onTime, { signal })
    video.addEventListener('play', this.onPlay, { signal })
    video.addEventListener('playing', this.onPlay, { signal })
    video.addEventListener('pause', this.onPause, { signal })
    video.addEventListener('waiting', this.onWaiting, { signal })
    video.addEventListener('ended', this.onEnded, { signal })
    video.addEventListener('error', this.onError, { signal })
    video.addEventListener('enterpictureinpicture', this.onPipEnter, { signal })
    video.addEventListener('leavepictureinpicture', this.onPipLeave, { signal })
  }

  private emit<K extends keyof EngineEvents>(event: K, ...args: Parameters<EngineEvents[K]>): void {
    for (const cb of this.listeners[event]) (cb as (...a: unknown[]) => void)(...args)
  }

  private onTime = (): void => this.emit('time', this.video.currentTime)
  private onPlay = (): void => this.emit('state', 'playing')
  private onPause = (): void => this.emit('state', 'paused')
  private onWaiting = (): void => this.emit('state', 'buffering')
  private onEnded = (): void => this.emit('ended')
  private onError = (): void => this.emit('error', 'Playback failed.')
  private onPipEnter = (): void => this.emit('pip', true)
  private onPipLeave = (): void => this.emit('pip', false)

  async load(req: LoadRequest): Promise<void> {
    this.hls?.destroy()
    this.hls = null
    this.delay = 0
    this.appliedDelay = new WeakMap()

    // remove previous <track> elements
    for (const el of Array.from(this.video.querySelectorAll('track'))) el.remove()

    if (req.hls && Hls.isSupported()) {
      this.hls = new Hls()
      this.hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) this.emit('error', 'Playback failed.')
      })
      this.hls.loadSource(req.url)
      this.hls.attachMedia(this.video)
    } else {
      this.video.src = req.url
    }

    for (const t of req.textTracks) {
      const track = document.createElement('track')
      track.kind = 'subtitles'
      track.label = t.label
      if (t.language) track.srclang = t.language
      track.src = t.url
      track.dataset.jfIndex = String(t.index)
      // cues arrive after the VTT fetch — sync the delay once they exist
      track.addEventListener('load', () => this.syncDelay(track.track))
      this.video.appendChild(track)
    }

    if (req.startSeconds > 0) this.video.currentTime = req.startSeconds
    await this.video.play().catch(() => {
      /* autoplay may be blocked; user presses play */
    })
  }

  play(): void {
    void this.video.play()
  }

  pause(): void {
    this.video.pause()
  }

  seek(seconds: number): void {
    this.video.currentTime = Math.max(0, Math.min(seconds, this.duration() || seconds))
  }

  setRate(rate: number): void {
    this.video.playbackRate = rate
  }

  setVolume(volume: number): void {
    this.video.volume = Math.max(0, Math.min(1, volume))
  }

  setMuted(muted: boolean): void {
    this.video.muted = muted
  }

  setTextTrack(index: number | null): void {
    const tracks = Array.from(this.video.querySelectorAll('track'))
    for (const el of tracks) {
      if (!el.track) continue
      const active = index !== null && el.dataset.jfIndex === String(index)
      el.track.mode = active ? 'showing' : 'disabled'
      if (active) this.syncDelay(el.track)
    }
  }

  setSubtitleDelay(seconds: number): void {
    this.delay = seconds
    for (const track of Array.from(this.video.textTracks)) this.syncDelay(track)
  }

  // shift a track's cues to match the desired delay; no-op until cues are loaded
  private syncDelay(track: TextTrack): void {
    if (!track.cues) return
    const shift = this.delay - (this.appliedDelay.get(track) ?? 0)
    if (shift === 0) return
    for (const cue of Array.from(track.cues)) {
      cue.startTime += shift
      cue.endTime += shift
    }
    this.appliedDelay.set(track, this.delay)
  }

  async enterPiP(): Promise<void> {
    await this.video.requestPictureInPicture()
  }

  async exitPiP(): Promise<void> {
    if (document.pictureInPictureElement) await document.exitPictureInPicture()
  }

  currentTime(): number {
    return this.video.currentTime
  }

  duration(): number {
    return this.video.duration || 0
  }

  on<K extends keyof EngineEvents>(event: K, cb: EngineEvents[K]): () => void {
    this.listeners[event].add(cb)
    return () => this.listeners[event].delete(cb)
  }

  destroy(): void {
    this.hls?.destroy()
    this.abort.abort()
    this.video.removeAttribute('src')
    this.video.load()
  }
}
