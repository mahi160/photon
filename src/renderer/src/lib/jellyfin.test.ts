import { describe, expect, it } from 'vitest'
import {
  mediaBadges,
  playerSpecialBadges,
  trickplayTile,
  type MediaStream,
  type TrickplayInfo
} from './jellyfin'

describe('mediaBadges', () => {
  const uhd: MediaStream[] = [
    { Index: 0, Type: 'Video', Codec: 'hevc', Width: 3840, Height: 2160, VideoRangeType: 'HDR10' },
    {
      Index: 1,
      Type: 'Audio',
      Codec: 'truehd',
      IsDefault: true,
      ChannelLayout: '7.1',
      Profile: 'Dolby TrueHD + Dolby Atmos'
    }
  ]

  it('4K HDR with Atmos', () => {
    expect(mediaBadges(uhd)).toEqual(['4K', 'HEVC', 'HDR10', 'Atmos', '7.1'])
  })

  it('1080p SDR stays quiet about range', () => {
    const hd: MediaStream[] = [
      { Index: 0, Type: 'Video', Codec: 'h264', Width: 1920, VideoRangeType: 'SDR' },
      { Index: 1, Type: 'Audio', Codec: 'aac', ChannelLayout: 'stereo' }
    ]
    expect(mediaBadges(hd)).toEqual(['1080p', 'H264', 'AAC', 'stereo'])
  })

  it('Dolby Vision variants collapse to one label', () => {
    const dv = uhd.map((s) => (s.Type === 'Video' ? { ...s, VideoRangeType: 'DOVIWithHDR10' } : s))
    expect(mediaBadges(dv)).toContain('Dolby Vision')
  })

  it('no streams → no badges', () => {
    expect(mediaBadges([])).toEqual([])
  })
})

describe('playerSpecialBadges', () => {
  const uhd: MediaStream[] = [
    { Index: 0, Type: 'Video', Codec: 'hevc', Width: 3840, Height: 2160, VideoRangeType: 'HDR10' },
    {
      Index: 1,
      Type: 'Audio',
      Codec: 'truehd',
      IsDefault: true,
      ChannelLayout: '7.1',
      Profile: 'Dolby TrueHD + Dolby Atmos'
    }
  ]

  it('4K HDR with Atmos: only the notable tags, no codec/channel-layout noise', () => {
    expect(playerSpecialBadges(uhd)).toEqual(['4K', 'HDR10', 'Atmos'])
  })

  it('1080p SDR stereo: the ordinary case shows nothing', () => {
    const hd: MediaStream[] = [
      { Index: 0, Type: 'Video', Codec: 'h264', Width: 1920, VideoRangeType: 'SDR' },
      { Index: 1, Type: 'Audio', Codec: 'aac', ChannelLayout: 'stereo' }
    ]
    expect(playerSpecialBadges(hd)).toEqual([])
  })

  it('plain 5.1 without Atmos stays quiet too', () => {
    const surround: MediaStream[] = [
      { Index: 0, Type: 'Video', Codec: 'h264', Width: 1920, VideoRangeType: 'SDR' },
      { Index: 1, Type: 'Audio', Codec: 'ac3', ChannelLayout: '5.1' }
    ]
    expect(playerSpecialBadges(surround)).toEqual([])
  })

  it('Dolby Vision variants collapse to one label', () => {
    const dv = uhd.map((s) => (s.Type === 'Video' ? { ...s, VideoRangeType: 'DOVIWithHDR10' } : s))
    expect(playerSpecialBadges(dv)).toContain('Dolby Vision')
  })

  it('no streams → no badges', () => {
    expect(playerSpecialBadges([])).toEqual([])
  })
})

describe('trickplayTile', () => {
  // 320×180 thumbs, 10×10 per tile, one thumb per 10s
  const info: TrickplayInfo = {
    Width: 320,
    Height: 180,
    TileWidth: 10,
    TileHeight: 10,
    ThumbnailCount: 250,
    Interval: 10_000
  }

  it('start of file → first thumb of first tile', () => {
    expect(trickplayTile(info, 0)).toEqual({ tile: 0, x: 0, y: 0 })
  })

  it('thumb 11 → second row, second column of tile 0', () => {
    // 110s / 10s = thumb 11 → row 1, col 1
    expect(trickplayTile(info, 110)).toEqual({ tile: 0, x: 320, y: 180 })
  })

  it('thumb 100 rolls into the second tile', () => {
    expect(trickplayTile(info, 1000)).toEqual({ tile: 1, x: 0, y: 0 })
  })

  it('clamps past the end instead of requesting a missing tile', () => {
    expect(trickplayTile(info, 999_999).tile).toBe(2) // thumb 249 → tile 2
  })
})
