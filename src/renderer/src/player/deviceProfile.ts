// DeviceProfile — tells the server what this client can play directly, so it
// knows when transcoding genuinely isn't needed (PRD: API Usage).
//
// mpv is the sole playback engine (ADR-0003) and does its own demuxing/
// decoding via ffmpeg (ADR-0008) — unlike a browser <video>/MediaSource tag,
// it isn't limited to whatever codecs the OS's media framework happens to
// expose to the webview. This claims that real, broad capability directly
// instead of probing MediaSource.isTypeSupported() (a leftover from the old
// HTML5 engine that under-claimed support and caused needless transcodes).

// bitrate sent when the user picks "Auto" (settings.maxBitrate = 0)
export const AUTO_BITRATE = 140_000_000

function rangeCondition(value: string): object {
  return { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: value, IsRequired: false }
}

export function buildDeviceProfile(maxBitrate: number): object {
  // every common video codec ffmpeg (mpv's decoder backend) ships with —
  // not gated behind a webview capability check, see module doc
  const videoCodecs = ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg2video', 'mpeg4', 'vc1']
  const audioCodecs = [
    'aac',
    'mp3',
    'ac3',
    'eac3',
    'dts',
    'truehd',
    'flac',
    'opus',
    'vorbis',
    'pcm_s16le',
    'pcm_s24le'
  ]

  // permissive video-range declaration per codec (SDR/HDR10/HLG, no Dolby
  // Vision profile claimed — mpv has no dedicated DOVI tone-mapping path
  // worth claiming here). Omitting this makes the server assume the client
  // can't handle non-SDR and insert an HDR->SDR tonemap filter, i.e. a
  // transcode, for no reason.
  const hdrRanges = 'SDR|HDR10|HDR10Plus|HLG'
  const codecProfiles = videoCodecs.map((codec) => ({
    Type: 'Video',
    Codec: codec,
    Conditions: [rangeCondition(codec === 'h264' ? 'SDR' : hdrRanges)]
  }))

  return {
    MaxStreamingBitrate: maxBitrate,
    CodecProfiles: codecProfiles,
    DirectPlayProfiles: [
      {
        Container: 'mp4,m4v,mkv,avi,mov,ts,m2ts,webm',
        Type: 'Video',
        VideoCodec: videoCodecs.join(','),
        AudioCodec: audioCodecs.join(',')
      }
    ],
    // schema safety net, not a path this client's own logic ever asks for
    // (always direct play, ADR-0008) — only reached if the server itself
    // decides a source genuinely can't be direct played (exotic codec,
    // bitrate cap it wants to enforce, etc).
    TranscodingProfiles: [
      {
        Container: 'mp4',
        Type: 'Video',
        VideoCodec: 'h264',
        AudioCodec: 'aac,mp3',
        Protocol: 'hls',
        Context: 'Streaming',
        MaxAudioChannels: '2',
        MinSegments: 2,
        BreakOnNonKeyFrames: true
      }
    ],
    SubtitleProfiles: [
      // vtt External for anything text-convertible; every other format
      // (pgssub/dvdsub/ass/ssa/etc.) is selected as an embedded mpv track
      // instead (ADR-0008) — deliberately undeclared here, same as before:
      // declaring an Encode profile for them short-circuits the server's own
      // negotiation into burning them in server-side, which is exactly the
      // transcode this profile is trying to avoid.
      { Format: 'vtt', Method: 'External' }
    ]
  }
}
