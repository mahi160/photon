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

export async function startPlayback(
  item: BaseItem,
  opts: PlayOptions = {}
): Promise<PlaybackSession> {
  const s = currentSession()
  if (!s) throw new Error('Not signed in')

  const startSeconds = opts.startSeconds ?? ticksToSeconds(item.UserData?.PlaybackPositionTicks)
  const info = await fetchPlaybackInfo(item.Id, startSeconds, opts)
  const ms = info.MediaSources?.[0]
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

function reportBody(sess: PlaybackSession, positionSeconds: number, isPaused: boolean): object {
  return {
    ItemId: sess.item.Id,
    MediaSourceId: sess.mediaSource.Id,
    PlaySessionId: sess.playSessionId,
    PositionTicks: secondsToTicks(positionSeconds),
    IsPaused: isPaused,
    PlayMethod: sess.playMethod,
    CanSeek: true
  }
}

export function reportStart(sess: PlaybackSession, positionSeconds: number): void {
  void jf('/Sessions/Playing', {
    method: 'POST',
    body: reportBody(sess, positionSeconds, false)
  }).catch(() => {})
}

export function reportProgress(
  sess: PlaybackSession,
  positionSeconds: number,
  isPaused: boolean
): void {
  void jf('/Sessions/Playing/Progress', {
    method: 'POST',
    body: reportBody(sess, positionSeconds, isPaused)
  }).catch(() => {})
}

export function reportStopped(sess: PlaybackSession, positionSeconds: number): void {
  void jf('/Sessions/Playing/Stopped', {
    method: 'POST',
    body: reportBody(sess, positionSeconds, true)
  }).catch(() => {})
}

// /Sessions/Playing/Stopped only updates progress tracking, doesn't kill the ffmpeg job -- without this, switching audio/subtitles mid-transcode leaves the old encode running (jellyfin-web calls this before every track-switch reload too).
export async function stopActiveEncoding(sess: PlaybackSession): Promise<void> {
  await jf(`/Videos/ActiveEncodings`, {
    method: 'DELETE',
    query: { deviceId: deviceId(), playSessionId: sess.playSessionId }
  }).catch(() => {})
}
