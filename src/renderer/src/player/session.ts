import {
  currentSession,
  deviceId,
  directStreamUrl,
  jf,
  secondsToTicks,
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
  subtitleStreams: MediaStream[] // all subs incl. burn-in candidates
  startSeconds: number
}

// whether a stream index is deliverable as a text track (vs. burned in)
export function isTextTrack(sess: Pick<PlaybackSession, 'textTracks'>, index: number): boolean {
  return sess.textTracks.some((t) => t.index === index)
}

// Whether switching subtitles from `current` to `next` (null = off) needs a
// new stream from the server: a burn-in sub only exists in the transcoded
// pixels, so entering OR leaving one can't be done with text tracks alone.
export function subtitleSwitchRequiresReload(
  sess: Pick<PlaybackSession, 'textTracks' | 'subtitleStreams'>,
  current: number | null,
  next: number | null
): boolean {
  const burned = (index: number | null): boolean =>
    index !== null &&
    sess.subtitleStreams.some((st) => st.Index === index) &&
    !isTextTrack(sess, index)
  return burned(current) || burned(next)
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
  opts: PlayOptions,
  disableDirect: boolean
): Promise<PlaybackInfoResponse> {
  const s = currentSession()
  if (!s) throw new Error('Not signed in')
  // Everything rides in the body as one PlaybackInfoDto (matches
  // jellyfin-web's own client). Query-param support on this endpoint is
  // deprecated and doesn't reliably bind into the same negotiation as the
  // body fields (EnableDirectPlay etc.) — splitting fields across both
  // silently dropped SubtitleStreamIndex in testing.
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
      ...(opts.mediaSourceId ? { MediaSourceId: opts.mediaSourceId } : {}),
      ...(disableDirect ? { EnableDirectPlay: false, EnableDirectStream: false } : {})
    }
  })
}

// Why the requested tracks can't ride on the original file:
// - burnIn: a non-text subtitle only exists in the server's transcoded output
// - audioSwitch: in direct play the browser always plays the container's
//   default audio track — another track needs a server remux/transcode
// (exported for tests)
export function transcodeNeeds(
  streams: MediaStream[],
  opts: { audioStreamIndex?: number; subtitleStreamIndex?: number }
): { burnIn: boolean; audioSwitch: boolean } {
  const requestedSubtitle = streams.find(
    (st) => st.Type === 'Subtitle' && st.Index === opts.subtitleStreamIndex
  )
  const audioStreams = streams.filter((st) => st.Type === 'Audio')
  const containerDefaultAudio = audioStreams.find((st) => st.IsDefault) ?? audioStreams[0]
  return {
    burnIn: !!requestedSubtitle && requestedSubtitle.DeliveryMethod !== 'External',
    audioSwitch:
      opts.audioStreamIndex !== undefined &&
      containerDefaultAudio !== undefined &&
      opts.audioStreamIndex !== containerDefaultAudio.Index
  }
}

// Routing probe for the 'auto' player mode: one PlaybackInfo round-trip, no
// playback report is ever sent, so nothing is left running server-side.
export async function canDirectPlay(item: BaseItem, opts: PlayOptions = {}): Promise<boolean> {
  const info = await fetchPlaybackInfo(item.Id, 0, opts, false)
  const ms = info.MediaSources?.[0]
  if (!ms) throw new Error('Playback failed.')
  const needs = transcodeNeeds(ms.MediaStreams ?? [], opts)
  return !needs.burnIn && !needs.audioSwitch && !!(ms.SupportsDirectPlay || ms.SupportsDirectStream)
}

export interface SubtitleSelection {
  display: number | null // stream index shown as selected in the UI
  textTrack: number | null // text track to activate in the engine, null = none
}

// Which subtitle ends up active after a load. Explicit request wins (-1 =
// explicitly off), else preferred language / server default when subtitles
// are enabled. Burn-in subtitles are already in the video pixels (display
// only); text tracks additionally need activating in the engine.
export function resolveSubtitleSelection(
  sess: {
    textTracks: TextTrackSource[]
    subtitleStreams: MediaStream[]
    mediaSource: Pick<MediaSource, 'DefaultSubtitleStreamIndex'>
    playMethod: 'DirectPlay' | 'Transcode'
  },
  requestedIndex: number | undefined,
  settings: { subtitlesEnabled: boolean; preferredSubtitleLanguage?: string }
): SubtitleSelection {
  if (requestedIndex !== undefined) {
    if (requestedIndex < 0) return { display: null, textTrack: null }
    const text = sess.textTracks.find((t) => t.index === requestedIndex)
    return { display: requestedIndex, textTrack: text?.index ?? null }
  }
  if (!settings.subtitlesEnabled) return { display: null, textTrack: null }
  const defaultIndex = sess.mediaSource.DefaultSubtitleStreamIndex
  const preferred =
    sess.textTracks.find(
      (t) =>
        !!settings.preferredSubtitleLanguage && t.language === settings.preferredSubtitleLanguage
    ) ?? sess.textTracks.find((t) => t.index === defaultIndex)
  if (preferred) return { display: preferred.index, textTrack: preferred.index }
  // server picked a non-text default (PGS/ASS) and burned it in
  const burnedDefault =
    sess.playMethod === 'Transcode' &&
    defaultIndex !== undefined &&
    defaultIndex >= 0 &&
    sess.subtitleStreams.some((st) => st.Index === defaultIndex && st.DeliveryMethod !== 'External')
  return { display: burnedDefault ? defaultIndex : null, textTrack: null }
}

export async function startPlayback(
  item: BaseItem,
  opts: PlayOptions = {}
): Promise<PlaybackSession> {
  const s = currentSession()
  if (!s) throw new Error('Not signed in')

  const startSeconds = opts.startSeconds ?? ticksToSeconds(item.UserData?.PlaybackPositionTicks)
  const fetchInfo = (disableDirect: boolean): Promise<PlaybackInfoResponse> =>
    fetchPlaybackInfo(item.Id, startSeconds, opts, disableDirect)

  let info = await fetchInfo(false)
  let ms = info.MediaSources?.[0]
  if (!ms) throw new Error('Playback failed.')

  let needs = transcodeNeeds(ms.MediaStreams ?? [], opts)
  let requiresTranscode = needs.burnIn || needs.audioSwitch
  // the server doesn't know an audio switch or burn-in rules out direct
  // play (that's a browser limitation, not a codec one) — ask again with
  // direct play explicitly disabled once we know transcoding is required,
  // so the negotiation commits to a TranscodingUrl instead of possibly
  // still offering a direct-play MediaSource that ignores our request.
  if (requiresTranscode) {
    info = await fetchInfo(true)
    ms = info.MediaSources?.[0]
    if (!ms) throw new Error('Playback failed.')
    needs = transcodeNeeds(ms.MediaStreams ?? [], opts)
    requiresTranscode = needs.burnIn || needs.audioSwitch
  }

  const streams = ms.MediaStreams ?? []
  const subtitleStreams = streams.filter((st) => st.Type === 'Subtitle')

  let url: string
  let hls = false
  let playMethod: 'DirectPlay' | 'Transcode' = 'Transcode'
  if (!requiresTranscode && (ms.SupportsDirectPlay || ms.SupportsDirectStream)) {
    url = directStreamUrl(item.Id, ms.Id)
    playMethod = 'DirectPlay'
  } else if (ms.TranscodingUrl) {
    url = s.server + ms.TranscodingUrl
    hls = ms.TranscodingUrl.includes('.m3u8')
  } else {
    throw new Error('Playback failed.')
  }
  // ponytail: cheap visibility into what the server was asked to burn in —
  // check this before assuming a client-side bug when subtitles don't show
  // console.log, not .debug — Chromium DevTools hides Verbose-level logs by default
  if (needs.burnIn)
    console.log('[playback] burn-in requested', {
      url,
      subtitleStreamIndex: opts.subtitleStreamIndex
    })
  const textTracks: TextTrackSource[] = subtitleStreams
    .filter((st) => st.DeliveryMethod === 'External' && st.DeliveryUrl)
    .map((st) => ({
      index: st.Index,
      label: st.DisplayTitle ?? st.Language ?? `Subtitle ${st.Index}`,
      language: st.Language,
      url: s.server + st.DeliveryUrl
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
