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

  // permissive video-range declaration per codec, including every Dolby
  // Vision variant Jellyfin's VideoRangeType enum defines (DOVI/
  // DOVIWithHDR10/DOVIWithHLG/DOVIWithSDR/DOVIWithEL/DOVIWithHDR10Plus/
  // DOVIWithELHDR10Plus) alongside HDR10/HDR10Plus/HLG. ffmpeg (mpv's decoder
  // backend) decodes Dolby Vision streams -- at minimum via the HDR10-
  // compatible base layer/RPU-agnostic path profiles 5/8 fall back to.
  // Omitting any of these makes the server assume the client can't handle
  // that range and insert an HDR->SDR tonemap filter, i.e. a transcode, for
  // no reason (see jellyfin/jellyfin#16687 for the same class of bug on
  // other clients that only declared a subset of these).
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
    // The server's direct-play eligibility check runs GetSubtitleProfile()
    // against whatever subtitle is currently requested and rejects direct
    // play outright unless the result is Drop/External/Embed -- anything
    // that falls through to its own Encode default (i.e. every format with
    // no matching profile here) disqualifies direct play for the *whole*
    // request, not just the subtitle, forcing a full transcode. Confirmed
    // against jellyfin server's StreamBuilder.GetVideoDirectPlayProfile.
    SubtitleProfiles: [
      // srt (not vtt) External for text formats (subrip/ass/ssa/mov_text/
      // etc, server converts on the fly) -- keeps these on the Text
      // Subtitle path so delay/appearance styling keeps working (only text
      // tracks support that, see engine.setTextTrack). vtt was tried first,
      // but Jellyfin's ASS/SSA->vtt conversion emits a malformed `Region:`
      // header (real WebVTT spec: `REGION` on its own line, newline-
      // separated settings, not `Region:` with space-separated key:value
      // pairs) whenever the source has cue positioning -- confirmed against
      // a real server response. mpv's webvtt decoder silently drops every
      // cue in the file once it hits that malformed header (track still
      // shows up, selectable, just empty). Plain srt has no region/style
      // block at all, sidestepping this class of bug entirely -- no loss,
      // since Photon ships one fixed subtitle style regardless (ADR-0007).
      { Format: 'srt', Method: 'External' },
      // Embed for the image-based formats mpv selects as an embedded track
      // instead (ADR-0008, engine.selectEmbeddedSubtitleTrack) -- this is
      // what tells the server direct play doesn't need to burn these in.
      // ass/ssa deliberately excluded: those stay on the srt path above.
      { Format: 'pgssub', Method: 'Embed' },
      { Format: 'dvdsub', Method: 'Embed' },
      { Format: 'dvbsub', Method: 'Embed' }
    ]
  }
}
