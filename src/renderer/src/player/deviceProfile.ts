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

  // permissive range declaration: every Dolby Vision variant + HDR10/HDR10Plus/HLG. ffmpeg decodes DV streams (at minimum via HDR10-compatible base layer). Omitting any makes server assume client can't handle it and insert an HDR->SDR tonemap transcode for no reason (jellyfin/jellyfin#16687, same bug class on other clients).
  // Applied to every codec, h264 included — h264 clips can legitimately carry HDR10/HLG metadata too, and mpv decodes them the same way it decodes any other h264. A codec-specific SDR-only carve-out here was the same bug as omitting a DOVI variant: declaring less than mpv can actually do.
  const hdrRanges =
    'SDR|HDR10|HDR10Plus|HLG|DOVI|DOVIWithHDR10|DOVIWithHLG|DOVIWithSDR|DOVIWithEL|DOVIWithHDR10Plus|DOVIWithELHDR10Plus'
  const codecProfiles = videoCodecs.map((codec) => ({
    Type: 'Video',
    Codec: codec,
    Conditions: [rangeCondition(hdrRanges)]
  }))

  return {
    MaxStreamingBitrate: maxBitrate,
    CodecProfiles: codecProfiles,
    // Wildcard (no Container/VideoCodec/AudioCodec) — Jellyfin treats a profile with no codec/container list
    // as "accept anything of this Type", same shape jellyfin-mpv-shim declares. mpv/ffmpeg plays far more
    // containers and codecs than any explicit allowlist would enumerate (the previous list forced a
    // transcode on anything outside mp4/m4v/mkv/avi/mov/ts/m2ts/webm + 8 named codecs for no real reason —
    // mpv doesn't care what container the bytes came from). CodecProfiles above still narrows what counts
    // as HDR-capable per codec; this only stops the container/codec allowlist from vetoing direct play first.
    DirectPlayProfiles: [{ Type: 'Video' }, { Type: 'Audio' }, { Type: 'Photo' }],
    // schema safety net, not a path this client asks for (always direct play, ADR-0008) — only reached if server decides a source genuinely can't be direct played
    TranscodingProfiles: [
      {
        Container: 'mp4',
        Type: 'Video',
        VideoCodec: 'h264',
        AudioCodec: 'aac,mp3',
        Protocol: 'hls',
        Context: 'Streaming',
        // 8, not 2: avoids downmixing 5.1/7.1 sources to stereo on the rare forced transcode. Server clamps
        // this per output codec anyway (libmp3lame hard-caps at 2ch server-side; aac goes up to this value) —
        // asking for 8 only helps the aac case, never risks an over-wide mp3 request.
        MaxAudioChannels: '8',
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
