import { describe, expect, it } from 'vitest'
import { buildDeviceProfile } from './deviceProfile'

interface CodecProfile {
  Type: string
  Codec: string
  Conditions: { Property: string; Value: string }[]
}

// Regression guard: server's rangeCondition check rejects direct play whole-request unless VideoRangeType is declared -- missing DV variant gets transcoded to SDR/HDR10 for no reason, despite ffmpeg decoding DV. Same bug class as jellyfin/jellyfin#16687.
describe('buildDeviceProfile HDR ranges', () => {
  const hevc = (buildDeviceProfile(0) as { CodecProfiles: CodecProfile[] }).CodecProfiles.find(
    (p) => p.Codec === 'hevc'
  )!

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
