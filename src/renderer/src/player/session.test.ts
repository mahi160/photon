import { describe, expect, it } from 'vitest'
import { transcodeNeeds } from './session'
import type { MediaStream } from '../lib/jellyfin'

const streams: MediaStream[] = [
  { Index: 0, Type: 'Video', Codec: 'h264' },
  { Index: 1, Type: 'Audio', Codec: 'aac', IsDefault: true },
  { Index: 2, Type: 'Audio', Codec: 'ac3' },
  { Index: 3, Type: 'Subtitle', Codec: 'subrip', DeliveryMethod: 'External' },
  { Index: 4, Type: 'Subtitle', Codec: 'pgssub', DeliveryMethod: 'Encode' }
]

describe('transcodeNeeds', () => {
  it('no requests → no transcode', () => {
    expect(transcodeNeeds(streams, {})).toEqual({ burnIn: false, audioSwitch: false })
  })

  it('text subtitle rides direct play', () => {
    expect(transcodeNeeds(streams, { subtitleStreamIndex: 3 }).burnIn).toBe(false)
  })

  it('PGS subtitle needs burn-in', () => {
    expect(transcodeNeeds(streams, { subtitleStreamIndex: 4 }).burnIn).toBe(true)
  })

  it('-1 (subs off) never burns in', () => {
    expect(transcodeNeeds(streams, { subtitleStreamIndex: -1 }).burnIn).toBe(false)
  })

  it('container-default audio stays direct', () => {
    expect(transcodeNeeds(streams, { audioStreamIndex: 1 }).audioSwitch).toBe(false)
  })

  it('non-default audio needs a transcode', () => {
    expect(transcodeNeeds(streams, { audioStreamIndex: 2 }).audioSwitch).toBe(true)
  })

  it('no IsDefault flag → first audio track is the container default', () => {
    const noFlags = streams.map((s) => ({ ...s, IsDefault: undefined }))
    expect(transcodeNeeds(noFlags, { audioStreamIndex: 1 }).audioSwitch).toBe(false)
    expect(transcodeNeeds(noFlags, { audioStreamIndex: 2 }).audioSwitch).toBe(true)
  })
})
