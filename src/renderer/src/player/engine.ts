// PlaybackEngine boundary (ADR-0002): playback primitives + events only.
// Jellyfin sync, shortcuts, autoplay-next and subtitle styling live outside.

// selectable playback rates (speed menu + < > hotkeys)
export const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

export interface TextTrackSource {
  index: number // jellyfin stream index
  label: string
  language?: string
  url: string // SRT delivery url
}

export interface LoadRequest {
  url: string
  startSeconds: number
  textTracks: TextTrackSource[]
}

export interface EngineEvents {
  time: (seconds: number) => void
  state: (state: 'playing' | 'paused' | 'buffering') => void
  ended: () => void
  error: (message: string) => void
  pip: (active: boolean) => void
  volume: (volume: number, muted: boolean) => void
}

export interface PlaybackEngine {
  load(req: LoadRequest): Promise<void>
  play(): void
  pause(): void
  seek(seconds: number): void
  setRate(rate: number): void
  setVolume(volume: number): void // 0..1
  setMuted(muted: boolean): void
  // one-time application of persisted volume/mute at construction -- see MpvEngine's doc for why this is separate from setVolume/setMuted
  applyInitialVolume(volume: number, muted: boolean): void
  setTextTrack(index: number | null): void // jellyfin stream index, null = off
  setSubtitleDelay(seconds: number): void // text tracks only
  // both take the media's own stream index -- always direct play (ADR-0008), every track already embedded in the file mpv demuxes, no server round-trip needed
  selectAudioTrack(index: number): void // no "off" case — always a track
  selectEmbeddedSubtitleTrack(index: number | null): void // non-text (PGS/VOBSUB/styled ASS); null = off
  enterPiP(): Promise<void>
  exitPiP(): Promise<void>
  // Generic mpv command passthrough (screenshot, frame-step, cycle deinterlace, ...) -- see MpvEngine's doc.
  runCommand(args: string[]): void
  // Render backend attach() landed on (ADR-0009, macOS only) -- null until attach resolves, or on an engine with no such concept. Drives player overlay's CPU-fallback badge only, never gates behavior.
  renderBackend(): 'gpu' | 'cpu' | null
  currentTime(): number
  duration(): number
  paused(): boolean
  buffered(): number
  destroy(): void
  on<K extends keyof EngineEvents>(event: K, cb: EngineEvents[K]): () => void
}
