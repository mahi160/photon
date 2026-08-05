import { describe, expect, it } from 'vitest'
import { buildDeviceProfile } from './deviceProfile'

interface CodecProfile {
  Type: string
  Codec: string
  Conditions: { Property: string; Value: string }[]
}

// Regression guard: server's rangeCondition check rejects direct play whole-request unless VideoRangeType is declared -- missing DV variant gets transcoded to SDR/HDR10 for no reason, despite ffmpeg decoding DV. Same bug class as jellyfin/jellyfin#16687.
describe('buildDeviceProfile HDR ranges', () => {
  const profiles = (buildDeviceProfile(0) as { CodecProfiles: CodecProfile[] }).CodecProfiles
  const hevc = profiles.find((p) => p.Codec === 'hevc')!

  it('declares every non-SDR VideoRangeType Jellyfin defines, including every DOVI variant', () => {
    const value = hevc.Conditions[0].Value
    for (const range of [
      'HDR10',
      'HDR10Plus',
      'HLG',
      'DOVI',
      'DOVIWithHDR10',
      'DOVIWithHLG',
      'DOVIWithSDR',
      'DOVIWithEL',
      'DOVIWithHDR10Plus',
      'DOVIWithELHDR10Plus'
    ]) {
      expect(value.split('|')).toContain(range)
    }
  })

  // Regression guard: h264 used to be pinned to a SDR-only range, forcing a transcode for any h264 clip
  // carrying HDR10/HLG metadata even though mpv decodes it the same way as any other h264 stream.
  it('declares the same HDR ranges for h264 as every other codec', () => {
    const h264 = profiles.find((p) => p.Codec === 'h264')!
    expect(h264.Conditions[0].Value).toBe(hevc.Conditions[0].Value)
  })
})

// Regression guard: an explicit Container/VideoCodec/AudioCodec allowlist here silently vetoes direct
// play for anything outside it (obscure containers, codecs missing from the list) even though mpv/ffmpeg
// plays far more than Photon could ever enumerate -- wildcard is what jellyfin-mpv-shim does too.
describe('buildDeviceProfile DirectPlayProfiles', () => {
  it('declares accept-all (no Container/VideoCodec/AudioCodec) for Video/Audio/Photo', () => {
    const profiles = (buildDeviceProfile(0) as { DirectPlayProfiles: object[] }).DirectPlayProfiles
    expect(profiles).toEqual([{ Type: 'Video' }, { Type: 'Audio' }, { Type: 'Photo' }])
  })
})

// Regression guard: 2ch here downmixes any multichannel source on the (rare, server-decided) transcode
// fallback. Server clamps this per output audio codec regardless (libmp3lame hard-caps at 2ch), so 8 only
// ever helps the aac case.
describe('buildDeviceProfile TranscodingProfiles', () => {
  it('does not downmix to stereo on fallback transcode', () => {
    const profiles = (
      buildDeviceProfile(0) as { TranscodingProfiles: { MaxAudioChannels: string }[] }
    ).TranscodingProfiles
    expect(profiles[0].MaxAudioChannels).toBe('8')
  })
})

// Regression guard: any subtitle format missing a matching profile falls through to Encode and silently forces a transcode -- once regressed for pgssub/dvdsub/dvbsub with no test catching it.
describe('buildDeviceProfile subtitle profiles', () => {
  const profiles = (
    buildDeviceProfile(0) as { SubtitleProfiles: { Format: string; Method: string }[] }
  ).SubtitleProfiles

  it('declares Embed for every image-based format mpv selects natively', () => {
    for (const format of ['pgssub', 'dvdsub', 'dvbsub']) {
      expect(profiles).toContainEqual({ Format: format, Method: 'Embed' })
    }
  })

  it('keeps text formats on the External srt path (delay/styling support)', () => {
    expect(profiles).toContainEqual({ Format: 'srt', Method: 'External' })
    expect(profiles.some((p) => p.Format === 'ass')).toBe(false)
    expect(profiles.some((p) => p.Format === 'ssa')).toBe(false)
  })
})
