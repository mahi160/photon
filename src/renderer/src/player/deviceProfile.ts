// Accurate Chromium DeviceProfile — the server decides direct-play/remux/transcode
// and the user never sees which (PRD: API Usage).

// bitrate sent when the user picks "Auto" (settings.maxBitrate = 0)
export const AUTO_BITRATE = 140_000_000

function supported(type: string): boolean {
  return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type)
}

function rangeCondition(value: string): object {
  return { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: value, IsRequired: false }
}

export function buildDeviceProfile(maxBitrate: number): object {
  const h264 = 'h264'
  const videoCodecs = [h264]
  // gate every non-h264 codec the same way — an unchecked codec here claims
  // direct-play support this Electron's Chromium may not actually decode,
  // and the server has no way to know that (it just trusts the profile)
  if (supported('video/webm; codecs="vp9"')) videoCodecs.push('vp9')
  if (supported('video/mp4; codecs="av01.0.05M.08"')) videoCodecs.push('av1')
  if (supported('video/mp4; codecs="hvc1.1.6.L93.B0"')) videoCodecs.push('hevc')

  // permissive video-range declaration per codec (SDR/HDR10/HLG, no Dolby
  // Vision — Chromium <video> has no DOVI path worth claiming). Omitting this
  // makes the server assume the client can't handle non-SDR and insert an
  // HDR->SDR tonemap filter before encoding; combined with subtitle burn-in
  // that silently drops the subtitle overlay on some transcode paths, even
  // though the negotiation still reports SubtitleMethod=Encode.
  const hdrRanges = 'SDR|HDR10|HDR10Plus|HLG'
  const codecProfiles: object[] = [
    { Type: 'Video', Codec: 'h264', Conditions: [rangeCondition('SDR')] }
  ]
  for (const codec of ['hevc', 'vp9', 'av1']) {
    if (videoCodecs.includes(codec))
      codecProfiles.push({ Type: 'Video', Codec: codec, Conditions: [rangeCondition(hdrRanges)] })
  }

  return {
    MaxStreamingBitrate: maxBitrate,
    CodecProfiles: codecProfiles,
    DirectPlayProfiles: [
      {
        // mkv: Chromium demuxes Matroska — codec lists below still gate it,
        // so DTS/TrueHD audio etc. correctly falls back to remux/transcode
        Container: 'mp4,m4v,mkv',
        Type: 'Video',
        VideoCodec: videoCodecs.join(','),
        AudioCodec: 'aac,mp3,opus,flac'
      },
      { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9,av1', AudioCodec: 'vorbis,opus' }
    ],
    TranscodingProfiles: [
      // fmp4 first, same codec list as direct play: lets the server keep the
      // source video codec (stream copy) when only audio/subtitle need work,
      // instead of always burning a full h264 re-encode. Restricting this to
      // 'ts'+h264 only (the old profile) is what pushed the server onto its
      // coarse DirectPlayError fallback path, which never evaluates whether
      // the requested subtitle needs burning in — so subs silently dropped.
      {
        Container: 'mp4',
        Type: 'Video',
        VideoCodec: videoCodecs.join(','),
        AudioCodec: 'aac,mp3',
        Protocol: 'hls',
        Context: 'Streaming',
        MaxAudioChannels: '2',
        MinSegments: 2,
        BreakOnNonKeyFrames: true
      },
      {
        Container: 'ts',
        Type: 'Video',
        VideoCodec: h264,
        AudioCodec: 'aac,mp3',
        Protocol: 'hls',
        Context: 'Streaming',
        MaxAudioChannels: '2',
        MinSegments: 1,
        BreakOnNonKeyFrames: true
      }
    ],
    SubtitleProfiles: [
      // vtt only: Chromium <track> renders WebVTT exclusively — declaring srt here
      // makes the server hand out raw .srt the browser silently drops. The server
      // converts srt (and other text formats) to vtt when only vtt is listed.
      { Format: 'vtt', Method: 'External' },
      // anything not deliverable as text gets burned in by the server
      { Format: 'pgssub', Method: 'Encode' },
      { Format: 'dvdsub', Method: 'Encode' },
      { Format: 'ass', Method: 'Encode' },
      { Format: 'ssa', Method: 'Encode' }
    ]
  }
}
