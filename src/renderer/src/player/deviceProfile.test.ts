import { describe, expect, it } from 'vitest'
import { buildDeviceProfile } from './deviceProfile'

interface CodecProfile {
  Type: string
  Codec: string
  Conditions: { Property: string; Value: string }[]
}

// Regression guard: jellyfin's server-side direct-play eligibility check
// (StreamBuilder.GetVideoDirectPlayProfile) rejects direct play for the
// *whole* request unless GetSubtitleProfile() resolves the requested
// subtitle to Drop/External/Embed -- any format missing a matching entry
// here falls through to Encode and silently forces a transcode. This once
// regressed for pgssub/dvdsub/dvbsub with no test catching it.
// Regression guard: the server's rangeCondition check
// (StreamBuilder.GetVideoDirectPlayProfile) rejects direct play for the
// whole request unless the source's VideoRangeType is declared here -- any
// Dolby Vision variant missing from this list gets transcoded to SDR/HDR10
// for no reason, even though ffmpeg (mpv's decoder backend) does decode
// Dolby Vision streams. Same class of bug as jellyfin/jellyfin#16687.
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

describe('buildDeviceProfile subtitle profiles', () => {
  const profiles = (
    buildDeviceProfile(0) as { SubtitleProfiles: { Format: string; Method: string }[] }
  ).SubtitleProfiles

  it('declares Embed for every image-based format mpv selects natively', () => {
    for (const format of ['pgssub', 'dvdsub', 'dvbsub']) {
      expect(profiles).toContainEqual({ Format: format, Method: 'Embed' })
    }
  })

  it('keeps text formats on the External vtt path (delay/styling support)', () => {
    expect(profiles).toContainEqual({ Format: 'vtt', Method: 'External' })
    expect(profiles.some((p) => p.Format === 'ass')).toBe(false)
    expect(profiles.some((p) => p.Format === 'ssa')).toBe(false)
  })
})
