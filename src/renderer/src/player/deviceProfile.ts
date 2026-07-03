// Accurate Chromium DeviceProfile — the server decides direct-play/remux/transcode
// and the user never sees which (PRD: API Usage).

function supported(type: string): boolean {
  return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type)
}

export function buildDeviceProfile(maxBitrate: number): object {
  const h264 = 'h264'
  const videoCodecs = [h264, 'vp9', 'av1']
  if (supported('video/mp4; codecs="hvc1.1.6.L93.B0"')) videoCodecs.push('hevc')

  return {
    MaxStreamingBitrate: maxBitrate,
    DirectPlayProfiles: [
      { Container: 'mp4,m4v', Type: 'Video', VideoCodec: videoCodecs.join(','), AudioCodec: 'aac,mp3,opus,flac' },
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
      { Format: 'vtt', Method: 'External' },
      { Format: 'srt', Method: 'External' },
      // anything not deliverable as text gets burned in by the server
      { Format: 'pgssub', Method: 'Encode' },
      { Format: 'dvdsub', Method: 'Encode' },
      { Format: 'ass', Method: 'Encode' },
      { Format: 'ssa', Method: 'Encode' }
    ]
  }
}
