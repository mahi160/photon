import {
  currentSession,
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
export function isTextTrack(sess: PlaybackSession, index: number): boolean {
  return sess.textTracks.some((t) => t.index === index)
}

interface PlaybackInfoResponse {
  MediaSources: MediaSource[]
  PlaySessionId: string
}

export async function startPlayback(
  item: BaseItem,
  opts: {
    startSeconds?: number
    audioStreamIndex?: number
    subtitleStreamIndex?: number // burn-in selection only
    maxBitrate?: number
  } = {}
): Promise<PlaybackSession> {
  const s = currentSession()
  if (!s) throw new Error('Not signed in')

  const startSeconds = opts.startSeconds ?? ticksToSeconds(item.UserData?.PlaybackPositionTicks)

  const info = await jf<PlaybackInfoResponse>(`/Items/${item.Id}/PlaybackInfo`, {
    method: 'POST',
    query: {
      UserId: s.userId,
      StartTimeIndex: 0,
      AutoOpenLiveStream: false,
      ...(opts.audioStreamIndex !== undefined ? { AudioStreamIndex: opts.audioStreamIndex } : {}),
      ...(opts.subtitleStreamIndex !== undefined
        ? { SubtitleStreamIndex: opts.subtitleStreamIndex }
        : {})
    },
    body: {
      DeviceProfile: buildDeviceProfile(opts.maxBitrate || AUTO_BITRATE),
      StartTimeTicks: secondsToTicks(startSeconds)
    }
  })

  const ms = info.MediaSources?.[0]
  if (!ms) throw new Error('Playback failed.')

  const streams = ms.MediaStreams ?? []
  const subtitleStreams = streams.filter((st) => st.Type === 'Subtitle')
  // a burn-in subtitle only exists in the server's transcoded output — direct
  // play/stream serves the original file and would silently drop it
  const requestedSubtitle = subtitleStreams.find((st) => st.Index === opts.subtitleStreamIndex)
  const requiresBurnIn = !!requestedSubtitle && requestedSubtitle.DeliveryMethod !== 'External'

  let url: string
  let hls = false
  let playMethod: 'DirectPlay' | 'Transcode' = 'Transcode'
  if (!requiresBurnIn && (ms.SupportsDirectPlay || ms.SupportsDirectStream)) {
    url = directStreamUrl(item.Id, ms.Id)
    playMethod = 'DirectPlay'
  } else if (ms.TranscodingUrl) {
    url = s.server + ms.TranscodingUrl
    hls = ms.TranscodingUrl.includes('.m3u8')
  } else {
    throw new Error('Playback failed.')
  }
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
