// PlaybackEngine boundary (ADR-0002): playback primitives + events only.
// Jellyfin sync, shortcuts, autoplay-next and subtitle styling live outside.

export interface TextTrackSource {
  index: number // jellyfin stream index
  label: string
  language?: string
  url: string // VTT delivery url
}

export interface LoadRequest {
  url: string
  hls: boolean
  startSeconds: number
  textTracks: TextTrackSource[]
}

export interface EngineEvents {
  time: (seconds: number) => void
  state: (state: 'playing' | 'paused' | 'buffering') => void
  ended: () => void
  error: (message: string) => void
  pip: (active: boolean) => void
}

export interface PlaybackEngine {
  load(req: LoadRequest): Promise<void>
  play(): void
  pause(): void
  seek(seconds: number): void
  setRate(rate: number): void
  setVolume(volume: number): void // 0..1
  setMuted(muted: boolean): void
  setTextTrack(index: number | null): void // jellyfin stream index, null = off
  setSubtitleDelay(seconds: number): void // text tracks only
  enterPiP(): Promise<void>
  exitPiP(): Promise<void>
  currentTime(): number
  duration(): number
  destroy(): void
  on<K extends keyof EngineEvents>(event: K, cb: EngineEvents[K]): () => void
}
