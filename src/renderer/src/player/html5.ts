import Hls from 'hls.js'
import type { EngineEvents, LoadRequest, PlaybackEngine } from './engine'

type Listeners = { [K in keyof EngineEvents]: Set<EngineEvents[K]> }

export class Html5Engine implements PlaybackEngine {
  private hls: Hls | null = null
  private delay = 0 // applied cumulative subtitle shift, seconds
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
    video.addEventListener('timeupdate', this.onTime)
    video.addEventListener('play', this.onPlay)
    video.addEventListener('playing', this.onPlay)
    video.addEventListener('pause', this.onPause)
    video.addEventListener('waiting', this.onWaiting)
    video.addEventListener('ended', this.onEnded)
    video.addEventListener('error', this.onError)
    video.addEventListener('enterpictureinpicture', this.onPipEnter)
    video.addEventListener('leavepictureinpicture', this.onPipLeave)
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
      const mode = index !== null && el.dataset.jfIndex === String(index) ? 'showing' : 'disabled'
      if (el.track) el.track.mode = mode
    }
  }

  setSubtitleDelay(seconds: number): void {
    const shift = seconds - this.delay
    if (shift === 0) return
    this.delay = seconds
    for (const track of Array.from(this.video.textTracks)) {
      if (!track.cues) continue
      for (const cue of Array.from(track.cues)) {
        cue.startTime += shift
        cue.endTime += shift
      }
    }
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
    this.video.removeEventListener('timeupdate', this.onTime)
    this.video.removeEventListener('play', this.onPlay)
    this.video.removeEventListener('playing', this.onPlay)
    this.video.removeEventListener('pause', this.onPause)
    this.video.removeEventListener('waiting', this.onWaiting)
    this.video.removeEventListener('ended', this.onEnded)
    this.video.removeEventListener('error', this.onError)
    this.video.removeEventListener('enterpictureinpicture', this.onPipEnter)
    this.video.removeEventListener('leavepictureinpicture', this.onPipLeave)
    this.video.removeAttribute('src')
    this.video.load()
  }
}
