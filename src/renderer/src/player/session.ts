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
  hls: boolean
  textTracks: TextTrackSource[]
  audioStreams: MediaStream[]
  subtitleStreams: MediaStream[] // all subs, text-deliverable or embedded-only
  startSeconds: number
}

// whether a stream index is deliverable as a text track (vs. selected as an
// embedded track via engine.selectEmbeddedSubtitleTrack)
export function isTextTrack(sess: Pick<PlaybackSession, 'textTracks'>, index: number): boolean {
  return sess.textTracks.some((t) => t.index === index)
}

// Jellyfin's MediaStream.Index numbers every stream in the *original*
// file's raw layout, but the actual direct-stream/static URL mpv plays
// drops every subtitle stream delivered externally (DeliveryMethod ===
// 'External') -- confirmed against two real files via raw mpv IPC: mpv's
// own demuxed track-list is shifted down by exactly one position for every
// externally-delivered subtitle stream positioned before a given stream in
// the source's raw index. Anything engine.selectAudioTrack/
// selectEmbeddedSubtitleTrack resolves against mpv's *own* track-list (see
// engine.rs's `select_track`) needs this correction first, or it silently
// resolves to the wrong track (or none at all).
export function toDemuxedIndex(
  sess: Pick<PlaybackSession, 'subtitleStreams'>,
  index: number
): number {
  const stripped = sess.subtitleStreams.filter(
    (st) => st.DeliveryMethod === 'External' && st.Index < index
  ).length
  return index - stripped
}

// Whether switching the *embedded* (non-text) subtitle selection from
// `current` to `next` (null = off) needs a fresh PlaybackInfo negotiation
// instead of an instant mpv-side switch. Under direct play (ADR-0008) mpv
// owns every embedded track itself, so this is always false there. Under a
// Transcode fallback there's no mpv-selectable embedded track at all --
// deviceProfile.ts declares no Encode subtitle profile, so a non-text pick
// only exists because the server burned it into that transcode's pixels,
// and burned pixels can't be toggled by any mpv property. Entering OR
// leaving one needs the server to build a new stream.
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
  // Everything rides in the body as one PlaybackInfoDto (matches
  // jellyfin-web's own client). Query-param support on this endpoint is
  // deprecated and doesn't reliably bind into the same negotiation as the
  // body fields — splitting fields across both silently dropped
  // SubtitleStreamIndex in testing.
  //
  // Always direct play (ADR-0008): no EnableDirectPlay/EnableDirectStream
  // override here, ever. The two things that used to force a client-side
  // transcode request — picking a non-default audio track, and non-text
  // (PGS/ASS) subtitles — are both real mpv capabilities now (see
  // engine.rs's `select_track`): mpv demuxes the exact same file this
  // negotiation resolves, so it can select any embedded audio/subtitle
  // track itself, no server remux needed. If the server still can't direct
  // play a source for a genuine reason (exotic codec, bitrate cap), it's
  // free to fall back to TranscodingUrl below — this only removes
  // *client-manufactured* reasons to ask for that.
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

// Which subtitle ends up active after a load. Explicit request wins (-1 =
// explicitly off), else preferred language / server default when subtitles
// are enabled. Every subtitle stream is playable directly now (ADR-0008) —
// text-deliverable ones via engine.setTextTrack, everything else (PGS/VOBSUB/
// styled ASS) via mpv's own embedded-track selection.
//
// A forced track (IsForced — foreign-dialogue-only, e.g. anime/foreign-
// language films) is meant to show regardless of subtitlesEnabled: that
// preference is about *normal* subtitles, not the handful of foreign lines a
// forced track exists for. Only checked when subtitlesEnabled is off and
// nothing else was explicitly requested — subtitlesEnabled=true already
// reaches a real pick (preferred language or the server's own default,
// which itself accounts for forced tracks) further down.
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

  // Always direct play when the server allows it (ADR-0008) — no client-side
  // reason left to ask for anything else. TranscodingUrl only happens when
  // the server itself decides direct play genuinely isn't possible.
  let url: string
  let hls = false
  let playMethod: 'DirectPlay' | 'Transcode'
  if (ms.SupportsDirectPlay || ms.SupportsDirectStream) {
    url = directStreamUrl(item.Id, ms.Id)
    playMethod = 'DirectPlay'
  } else if (ms.TranscodingUrl) {
    url = s.server + ms.TranscodingUrl
    hls = ms.TranscodingUrl.includes('.m3u8')
    playMethod = 'Transcode'
  } else {
    throw new Error('Playback failed.')
  }
  // Built ourselves via subtitleStreamUrl, not st.DeliveryUrl -- see that
  // function's doc for why the server-supplied URL is unsafe to use as-is.
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
    hls,
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

// /Sessions/Playing/Stopped only updates progress tracking — it doesn't kill
// the server-side ffmpeg job. Without this, switching audio/subtitles mid-
// transcode leaves the old encode running and the new stream can still
// resolve against it (jellyfin-web calls this before every track-switch
// reload, for the same reason).
export async function stopActiveEncoding(sess: PlaybackSession): Promise<void> {
  await jf(`/Videos/ActiveEncodings`, {
    method: 'DELETE',
    query: { deviceId: deviceId(), playSessionId: sess.playSessionId }
  }).catch(() => {})
}
