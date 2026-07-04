// Accurate Chromium DeviceProfile — the server decides direct-play/remux/transcode
// and the user never sees which (PRD: API Usage).

// bitrate sent when the user picks "Auto" (settings.maxBitrate = 0)
export const AUTO_BITRATE = 140_000_000

function supported(type: string): boolean {
  return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type)
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

  return {
    MaxStreamingBitrate: maxBitrate,
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
