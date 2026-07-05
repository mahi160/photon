import Hls from 'hls.js'
import type { EngineEvents, LoadRequest, PlaybackEngine } from './engine'

type Listeners = { [K in keyof EngineEvents]: Set<EngineEvents[K]> }

export class Html5Engine implements PlaybackEngine {
  private hls: Hls | null = null
  private hlsRecoveries = 0 // fatal-error recovery attempts for the current load
  private delay = 0 // desired subtitle shift, seconds
  // shift actually applied to each track's cues — tracks load cues lazily and
  // keep them across mode changes, so the applied amount is tracked per track
  private appliedDelay = new WeakMap<TextTrack, number>()
  private blobUrls: string[] = [] // revoke on reload/destroy
  private abort = new AbortController()
  private listeners: Listeners = {
    time: new Set(),
    state: new Set(),
    ended: new Set(),
    error: new Set(),
    pip: new Set(),
    volume: new Set()
  }

  constructor(private video: HTMLVideoElement) {
    // no crossOrigin here: it would force CORS on the main stream fetch too,
    // and most self-hosted servers/reverse proxies don't send CORS headers on
    // the streaming routes (jellyfin-web never hits this because it's
    // same-origin). <video src> plays cross-origin fine without it — text
    // tracks are fetched separately via main (see load()) to dodge CORS there.
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
    video.addEventListener('volumechange', this.onVolume, { signal })
  }

  private emit<K extends keyof EngineEvents>(event: K, ...args: Parameters<EngineEvents[K]>): void {
    for (const cb of this.listeners[event]) (cb as (...a: unknown[]) => void)(...args)
  }

  private onTime = (): void => this.emit('time', this.video.currentTime)
  private onPlay = (): void => this.emit('state', 'playing')
  private onPause = (): void => this.emit('state', 'paused')
  private onWaiting = (): void => this.emit('state', 'buffering')
  private onEnded = (): void => this.emit('ended')
  private onError = (): void => {
    console.error('[playback] video error', this.video.error)
    this.emit('error', 'Playback failed.')
  }
  private onPipEnter = (): void => this.emit('pip', true)
  private onPipLeave = (): void => this.emit('pip', false)
  private onVolume = (): void => this.emit('volume', this.video.volume, this.video.muted)

  async load(req: LoadRequest): Promise<void> {
    this.hls?.destroy()
    this.hls = null
    this.delay = 0
    this.appliedDelay = new WeakMap()

    // remove previous <track> elements and their blob urls
    for (const el of Array.from(this.video.querySelectorAll('track'))) el.remove()
    for (const u of this.blobUrls) URL.revokeObjectURL(u)
    this.blobUrls = []

    // drop whatever the video element was previously doing (plain src or a
    // prior hls.js MSE blob) before switching modes — otherwise the old
    // request keeps retrying in the background after this reload (harmless,
    // but noisy in devtools/network logs)
    this.video.removeAttribute('src')
    if (req.hls && Hls.isSupported()) {
      this.hlsRecoveries = 0
      // Jellyfin produces HLS segments on demand: a request for a segment the
      // transcoder hasn't encoded yet blocks until it exists. Slow transcodes
      // (10-bit HEVC → h264 + subtitle burn-in) need far more than the 20s
      // default before that's a real failure — jellyfin-web uses 120s too.
      const hls = new Hls({
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 120_000,
            maxLoadTimeMs: 120_000,
            timeoutRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
            errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 }
          }
        }
      })
      this.hls = hls
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) {
          console.warn('[playback] hls error', data)
          return
        }
        // transient segment/decode hiccups are common mid-transcode — try the
        // standard hls.js recovery before surfacing a hard failure
        if (this.hlsRecoveries < 3) {
          this.hlsRecoveries++
          console.warn('[playback] hls fatal error, recovering', data)
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad()
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
          else this.emit('error', 'Playback failed.')
          return
        }
        console.error('[playback] hls fatal error', data)
        this.emit('error', 'Playback failed.')
      })
      hls.loadSource(req.url)
      hls.attachMedia(this.video)
    } else {
      this.video.src = req.url
    }

    for (const t of req.textTracks) {
      const track = document.createElement('track')
      track.kind = 'subtitles'
      track.label = t.label
      if (t.language) track.srclang = t.language
      track.dataset.jfIndex = String(t.index)
      // cues arrive after the VTT fetch — sync the delay once they exist
      track.addEventListener('load', () => this.syncDelay(track.track))
      this.video.appendChild(track)
      // fetched via main (not track.src = t.url directly) so a server/proxy
      // missing CORS headers only breaks this subtitle, not the whole video
      window.api
        .fetchSubtitle(t.url)
        .then((vtt) => {
          const blobUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
          this.blobUrls.push(blobUrl)
          track.src = blobUrl
        })
        .catch((e) => console.error('[playback] subtitle fetch failed', t.label, e))
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

  paused(): boolean {
    return this.video.paused
  }

  buffered(): number {
    const b = this.video.buffered
    return b.length ? b.end(b.length - 1) : 0
  }

  on<K extends keyof EngineEvents>(event: K, cb: EngineEvents[K]): () => void {
    this.listeners[event].add(cb)
    return () => this.listeners[event].delete(cb)
  }

  destroy(): void {
    this.hls?.destroy()
    this.abort.abort()
    for (const u of this.blobUrls) URL.revokeObjectURL(u)
    this.blobUrls = []
    this.video.removeAttribute('src')
    this.video.load()
  }
}
