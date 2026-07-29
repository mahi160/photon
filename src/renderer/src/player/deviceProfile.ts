// DeviceProfile — tells server what this client can play directly, so it knows when transcoding isn't needed (PRD: API Usage).
// mpv is the sole playback engine (ADR-0003), demuxes/decodes via ffmpeg (ADR-0008) — not limited to webview-exposed codecs like a <video> tag. Claims that broad capability directly instead of probing MediaSource.isTypeSupported() (old HTML5-engine leftover that under-claimed support, caused needless transcodes).

// bitrate sent when the user picks "Auto" (settings.maxBitrate = 0)
export const AUTO_BITRATE = 140_000_000

function rangeCondition(value: string): object {
  return { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: value, IsRequired: false }
}

export function buildDeviceProfile(maxBitrate: number): object {
  // every common video codec ffmpeg (mpv's decoder backend) ships with — not gated behind a webview capability check
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

  // permissive range declaration: every Dolby Vision variant + HDR10/HDR10Plus/HLG. ffmpeg decodes DV streams (at minimum via HDR10-compatible base layer). Omitting any makes server assume client can't handle it and insert an HDR->SDR tonemap transcode for no reason (jellyfin/jellyfin#16687, same bug class on other clients).
  const hdrRanges =
    'SDR|HDR10|HDR10Plus|HLG|DOVI|DOVIWithHDR10|DOVIWithHLG|DOVIWithSDR|DOVIWithEL|DOVIWithHDR10Plus|DOVIWithELHDR10Plus'
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
    // schema safety net, not a path this client asks for (always direct play, ADR-0008) — only reached if server decides a source genuinely can't be direct played
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
    // Server's direct-play eligibility check (StreamBuilder.GetVideoDirectPlayProfile) rejects the *whole* request unless GetSubtitleProfile() resolves to Drop/External/Embed -- any format with no matching profile falls to Encode, forcing a full transcode.
    SubtitleProfiles: [
      // srt (not vtt) External for text formats -- keeps delay/styling working (text-only, see engine.setTextTrack). vtt was tried first, but Jellyfin's ASS/SSA->vtt conversion emits a malformed `Region:` header when source has cue positioning, and mpv's webvtt decoder silently drops every cue past it. Plain srt has no region/style block, sidesteps this -- no loss, Photon ships one fixed subtitle style anyway (ADR-0007).
      { Format: 'srt', Method: 'External' },
      // Embed for image-based formats mpv selects as embedded track (ADR-0008, engine.selectEmbeddedSubtitleTrack) -- tells server not to burn these in. ass/ssa excluded, stay on srt path above.
      { Format: 'pgssub', Method: 'Embed' },
      { Format: 'dvdsub', Method: 'Embed' },
      { Format: 'dvbsub', Method: 'Embed' }
    ]
  }
}
