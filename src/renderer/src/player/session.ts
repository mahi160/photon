import {
  currentSession,
  deviceId,
  directStreamUrl,
  jf,
  secondsToTicks,
  subtitleStreamUrl,
  ticksToSeconds,
  type BaseItem,
  type MediaSource,
  type MediaStream
} from '../lib/jellyfin'
import { createSerialQueue } from '../lib/serialQueue'
import { AUTO_BITRATE, buildDeviceProfile } from './deviceProfile'
import type { TextTrackSource } from './engine'

export interface PlaybackSession {
  item: BaseItem
  mediaSource: MediaSource
  playSessionId: string
  playMethod: 'DirectPlay' | 'Transcode'
  url: string
  textTracks: TextTrackSource[]
  audioStreams: MediaStream[]
  subtitleStreams: MediaStream[] // all subs, text-deliverable or embedded-only
  startSeconds: number
}

// whether a stream index is deliverable as a text track (vs. embedded via engine.selectEmbeddedSubtitleTrack)
export function isTextTrack(sess: Pick<PlaybackSession, 'textTracks'>, index: number): boolean {
  return sess.textTracks.some((t) => t.index === index)
}

// Jellyfin's MediaStream.Index numbers streams in the original file's raw layout, but mpv's demuxed track-list drops every externally-delivered subtitle (DeliveryMethod === 'External'), shifting later indexes down by one each -- confirmed via raw mpv IPC. engine.selectAudioTrack/selectEmbeddedSubtitleTrack resolve against mpv's own track-list (engine.rs's select_track), so this correction is required first or they silently pick the wrong track.
// Also used (usePlayback.ts) to correct an *audio* index for the same reason, relying on an invariant
// this function doesn't itself check: Jellyfin's scanner always numbers externally-delivered subtitles
// after every embedded stream (video/audio/embedded-sub) in the item, so no audio index is ever actually
// shifted by an external-subtitle count in practice. If that numbering ever didn't hold, this would
// silently resolve to the wrong mpv audio track with no error -- same failure shape as a stale
// select_track queued before FILE_LOADED, just one layer further from any log line.
export function toDemuxedIndex(
  sess: Pick<PlaybackSession, 'subtitleStreams'>,
  index: number
): number {
  const stripped = sess.subtitleStreams.filter(
    (st) => st.DeliveryMethod === 'External' && st.Index < index
  ).length
  return index - stripped
}

// Whether switching embedded (non-text) subtitle from `current` to `next` (null = off) needs a fresh PlaybackInfo negotiation vs. instant mpv-side switch. Direct play (ADR-0008): always false, mpv owns embedded tracks. Transcode: burned-in pixels can't be toggled by any mpv property, so entering or leaving one needs a new stream.
export function embeddedSubtitleSwitchNeedsReload(
  sess: Pick<PlaybackSession, 'playMethod' | 'textTracks'>,
  current: number | null,
  next: number | null
): boolean {
  if (sess.playMethod === 'DirectPlay') return false
  const embedded = (index: number | null): boolean => index !== null && !isTextTrack(sess, index)
  return embedded(current) || embedded(next)
}

interface PlaybackInfoResponse {
  MediaSources: MediaSource[]
  PlaySessionId: string
}

interface PlayOptions {
  startSeconds?: number
  audioStreamIndex?: number
  subtitleStreamIndex?: number // stream index, or -1 for explicitly off
  maxBitrate?: number
  mediaSourceId?: string // pins renegotiation to the source already playing (track switch reloads)
}

function fetchPlaybackInfo(
  itemId: string,
  startSeconds: number,
  opts: PlayOptions
): Promise<PlaybackInfoResponse> {
  const s = currentSession()
  if (!s) throw new Error('Not signed in')
  // Everything rides in the body as one PlaybackInfoDto (matches jellyfin-web) -- query-param support here is deprecated, splitting fields across both silently dropped SubtitleStreamIndex in testing.
  // Always direct play (ADR-0008): no EnableDirectPlay/EnableDirectStream override, ever. Non-default audio + non-text subtitles are real mpv capabilities (engine.rs's select_track), no server remux needed. Server still falls back to TranscodingUrl for genuine reasons (exotic codec, bitrate cap) -- this only removes client-manufactured reasons.
  return jf<PlaybackInfoResponse>(`/Items/${itemId}/PlaybackInfo`, {
    method: 'POST',
    body: {
      UserId: s.userId,
      DeviceProfile: buildDeviceProfile(opts.maxBitrate || AUTO_BITRATE),
      StartTimeTicks: secondsToTicks(startSeconds),
      IsPlayback: true,
      AutoOpenLiveStream: false,
      ...(opts.audioStreamIndex !== undefined ? { AudioStreamIndex: opts.audioStreamIndex } : {}),
      ...(opts.subtitleStreamIndex !== undefined
        ? { SubtitleStreamIndex: opts.subtitleStreamIndex }
        : {}),
      ...(opts.mediaSourceId ? { MediaSourceId: opts.mediaSourceId } : {})
    }
  })
}

export interface SubtitleSelection {
  display: number | null // stream index shown as selected in the UI
  textTrack: number | null // activate via engine.setTextTrack, null = none
  embeddedTrack: number | null // activate via engine.selectEmbeddedSubtitleTrack, null = none
}

const SUBTITLES_OFF: SubtitleSelection = { display: null, textTrack: null, embeddedTrack: null }

// Which subtitle ends up active after load. Explicit request wins (-1 = off), else preferred language/server default when enabled. Every subtitle is playable directly now (ADR-0008) -- text via engine.setTextTrack, else mpv's embedded-track selection.
// A forced track (IsForced, foreign-dialogue-only) shows regardless of subtitlesEnabled -- only checked when disabled and nothing else requested, since enabled already reaches a real pick that accounts for forced tracks.
export function resolveSubtitleSelection(
  sess: {
    textTracks: TextTrackSource[]
    mediaSource: Pick<MediaSource, 'DefaultSubtitleStreamIndex'>
    subtitleStreams: Pick<MediaStream, 'Index' | 'IsForced'>[]
  },
  requestedIndex: number | undefined,
  settings: { subtitlesEnabled: boolean; preferredSubtitleLanguage?: string }
): SubtitleSelection {
  const forIndex = (index: number): SubtitleSelection => {
    const text = sess.textTracks.find((t) => t.index === index)
    return text
      ? { display: index, textTrack: text.index, embeddedTrack: null }
      : { display: index, textTrack: null, embeddedTrack: index }
  }
  if (requestedIndex !== undefined)
    return requestedIndex < 0 ? SUBTITLES_OFF : forIndex(requestedIndex)
  if (!settings.subtitlesEnabled) {
    const forced = sess.subtitleStreams.find((s) => s.IsForced)
    return forced ? forIndex(forced.Index) : SUBTITLES_OFF
  }
  const preferredText = sess.textTracks.find(
    (t) => !!settings.preferredSubtitleLanguage && t.language === settings.preferredSubtitleLanguage
  )
  if (preferredText) return forIndex(preferredText.index)
  const defaultIndex = sess.mediaSource.DefaultSubtitleStreamIndex
  return defaultIndex !== undefined && defaultIndex >= 0 ? forIndex(defaultIndex) : SUBTITLES_OFF
}

// Which of possibly several MediaSources to play (multi-version items: extras, upgraded rips, different
// quality encodes of the same title). A pinned id (track-switch/reload, already-negotiated source) always
// wins; otherwise prefers a source the server itself says can skip transcoding, then the highest bitrate
// among those, same weighted pick jellyfin-mpv-shim does instead of blindly taking array index 0.
export function pickMediaSource(
  sources: MediaSource[],
  mediaSourceId?: string
): MediaSource | undefined {
  if (mediaSourceId) {
    const pinned = sources.find((s) => s.Id === mediaSourceId)
    if (pinned) return pinned
  }
  const isDirect = (s: MediaSource): boolean => !!(s.SupportsDirectPlay || s.SupportsDirectStream)
  return [...sources].sort((a, b) => {
    if (isDirect(a) !== isDirect(b)) return isDirect(a) ? -1 : 1
    return (b.Bitrate ?? 0) - (a.Bitrate ?? 0)
  })[0]
}

export async function startPlayback(
  item: BaseItem,
  opts: PlayOptions = {}
): Promise<PlaybackSession> {
  const s = currentSession()
  if (!s) throw new Error('Not signed in')

  const startSeconds = opts.startSeconds ?? ticksToSeconds(item.UserData?.PlaybackPositionTicks)
  const info = await fetchPlaybackInfo(item.Id, startSeconds, opts)
  const ms = pickMediaSource(info.MediaSources ?? [], opts.mediaSourceId)
  if (!ms) throw new Error('Playback failed.')

  const streams = ms.MediaStreams ?? []
  const subtitleStreams = streams.filter((st) => st.Type === 'Subtitle')

  // Always direct play when server allows it (ADR-0008) -- TranscodingUrl only when server itself decides direct play genuinely isn't possible.
  let url: string
  let playMethod: 'DirectPlay' | 'Transcode'
  if (ms.SupportsDirectPlay || ms.SupportsDirectStream) {
    url = directStreamUrl(item.Id, ms.Id)
    playMethod = 'DirectPlay'
  } else if (ms.TranscodingUrl) {
    url = s.server + ms.TranscodingUrl
    playMethod = 'Transcode'
  } else {
    throw new Error('Playback failed.')
  }
  // Built via subtitleStreamUrl, not st.DeliveryUrl -- see that function's doc for why the server-supplied URL is unsafe as-is.
  const textTracks: TextTrackSource[] = subtitleStreams
    .filter((st) => st.DeliveryMethod === 'External' && st.DeliveryUrl)
    .map((st) => ({
      index: st.Index,
      label: st.DisplayTitle ?? st.Language ?? `Subtitle ${st.Index}`,
      language: st.Language,
      url: subtitleStreamUrl(item.Id, ms.Id, st.Index)
    }))

  return {
    item,
    mediaSource: ms,
    playSessionId: info.PlaySessionId,
    playMethod,
    url,
    textTracks,
    audioStreams: streams.filter((st) => st.Type === 'Audio'),
    subtitleStreams,
    startSeconds
  }
}

// track indices are optional -- callers that haven't resolved them yet (or are reporting a stop after
// the session already tore down) can omit them, matching PlaybackProgressInfo's nullable fields.
interface ReportTracks {
  audioStreamIndex?: number
  subtitleStreamIndex?: number | null // -1/null both mean "off"; server only cares that it's present
  volume?: number // 0..1, engine's own mirror -- mapped to Jellyfin's 0..100 VolumeLevel below
  muted?: boolean
}

function reportBody(
  sess: PlaybackSession,
  positionSeconds: number,
  isPaused: boolean,
  tracks: ReportTracks = {}
): object {
  return {
    ItemId: sess.item.Id,
    MediaSourceId: sess.mediaSource.Id,
    PlaySessionId: sess.playSessionId,
    PositionTicks: secondsToTicks(positionSeconds),
    IsPaused: isPaused,
    PlayMethod: sess.playMethod,
    CanSeek: true,
    // Server persists these into UserData.AudioStreamIndex/SubtitleStreamIndex when the user's Jellyfin
    // profile has "Remember audio/subtitle selections" on (SessionManager.cs's UpdatePlaybackSettings) --
    // and always mirrors them into the live PlayState other clients/the dashboard see. Photon has its own
    // local track-memory store too, but leaving these off means the server-side preference (and any other
    // Jellyfin client reading it) never sees what's actually playing.
    ...(tracks.audioStreamIndex !== undefined ? { AudioStreamIndex: tracks.audioStreamIndex } : {}),
    ...(tracks.subtitleStreamIndex !== undefined && tracks.subtitleStreamIndex !== null
      ? { SubtitleStreamIndex: tracks.subtitleStreamIndex }
      : {}),
    // Same as above: the dashboard's "Now Playing" panel and any client polling /Sessions otherwise
    // shows a Photon session at an indeterminate volume -- Photon already has both on hand every tick.
    ...(tracks.volume !== undefined ? { VolumeLevel: Math.round(tracks.volume * 100) } : {}),
    ...(tracks.muted !== undefined ? { IsMuted: tracks.muted } : {})
  }
}

// Shared FIFO queue for every playback report -- a network round trip can complete out of order vs. the
// order it was fired, so a fire-and-forget "stopped" (track switch, autoplay) could otherwise arrive at
// the server after the next item's "start", or after that item's own progress ticks. Chaining every report
// through one queue guarantees the server sees them in call order, not response order.
const reportQueue = createSerialQueue()

export function reportStart(
  sess: PlaybackSession,
  positionSeconds: number,
  tracks?: ReportTracks
): Promise<void> {
  return reportQueue(() =>
    jf('/Sessions/Playing', {
      method: 'POST',
      body: reportBody(sess, positionSeconds, false, tracks)
    }).catch(() => {})
  )
}

export function reportProgress(
  sess: PlaybackSession,
  positionSeconds: number,
  isPaused: boolean,
  tracks?: ReportTracks
): Promise<void> {
  return reportQueue(() =>
    jf('/Sessions/Playing/Progress', {
      method: 'POST',
      body: reportBody(sess, positionSeconds, isPaused, tracks)
    }).catch(() => {})
  )
}

export function reportStopped(
  sess: PlaybackSession,
  positionSeconds: number,
  tracks?: ReportTracks
): Promise<void> {
  return reportQueue(() =>
    jf('/Sessions/Playing/Stopped', {
      method: 'POST',
      body: reportBody(sess, positionSeconds, true, tracks)
    }).catch(() => {})
  )
}

// /Sessions/Playing/Stopped only updates progress tracking, doesn't kill the ffmpeg job -- without this, switching audio/subtitles mid-transcode leaves the old encode running (jellyfin-web calls this before every track-switch reload too).
export async function stopActiveEncoding(sess: PlaybackSession): Promise<void> {
  await jf(`/Videos/ActiveEncodings`, {
    method: 'DELETE',
    query: { deviceId: deviceId(), playSessionId: sess.playSessionId }
  }).catch(() => {})
}
