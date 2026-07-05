import { describe, expect, it } from 'vitest'
import { resolveSubtitleSelection, transcodeNeeds } from './session'
import { pickInitialTracks } from './usePlayback'
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

describe('resolveSubtitleSelection', () => {
  const sess = {
    textTracks: [
      { index: 3, label: 'English', language: 'eng', url: '' },
      { index: 5, label: 'German', language: 'ger', url: '' }
    ],
    subtitleStreams: [
      { Index: 3, Type: 'Subtitle', DeliveryMethod: 'External' },
      { Index: 4, Type: 'Subtitle', DeliveryMethod: 'Encode' },
      { Index: 5, Type: 'Subtitle', DeliveryMethod: 'External' }
    ] as MediaStream[],
    mediaSource: {} as { DefaultSubtitleStreamIndex?: number },
    playMethod: 'DirectPlay' as const
  }
  const on = { subtitlesEnabled: true }
  const off = { subtitlesEnabled: false }

  it('explicit text track → displayed and activated', () => {
    expect(resolveSubtitleSelection(sess, 3, on)).toEqual({ display: 3, textTrack: 3 })
  })

  it('explicit burn-in → displayed but no text track (already in the pixels)', () => {
    expect(resolveSubtitleSelection(sess, 4, on)).toEqual({ display: 4, textTrack: null })
  })

  it('-1 → explicitly off, even with subtitles enabled', () => {
    expect(resolveSubtitleSelection(sess, -1, on)).toEqual({ display: null, textTrack: null })
  })

  it('no request + subtitles disabled → off', () => {
    expect(resolveSubtitleSelection(sess, undefined, off)).toEqual({
      display: null,
      textTrack: null
    })
  })

  it('no request → preferred language wins over server default', () => {
    const s = { ...sess, mediaSource: { DefaultSubtitleStreamIndex: 3 } }
    expect(
      resolveSubtitleSelection(s, undefined, { ...on, preferredSubtitleLanguage: 'ger' })
    ).toEqual({ display: 5, textTrack: 5 })
  })

  it('no request → falls back to the server default text track', () => {
    const s = { ...sess, mediaSource: { DefaultSubtitleStreamIndex: 5 } }
    expect(resolveSubtitleSelection(s, undefined, on)).toEqual({ display: 5, textTrack: 5 })
  })

  it('transcode + non-text server default → burned in, display only', () => {
    const s = {
      ...sess,
      playMethod: 'Transcode' as const,
      mediaSource: { DefaultSubtitleStreamIndex: 4 }
    }
    expect(resolveSubtitleSelection(s, undefined, on)).toEqual({ display: 4, textTrack: null })
  })

  it('direct play + non-text server default → nothing shown', () => {
    const s = { ...sess, mediaSource: { DefaultSubtitleStreamIndex: 4 } }
    expect(resolveSubtitleSelection(s, undefined, on)).toEqual({ display: null, textTrack: null })
  })
})

describe('pickInitialTracks', () => {
  const withLangs: MediaStream[] = [
    { Index: 0, Type: 'Video' },
    { Index: 1, Type: 'Audio', Language: 'jpn', IsDefault: true },
    { Index: 2, Type: 'Audio', Language: 'eng' },
    { Index: 3, Type: 'Subtitle', Language: 'eng', DeliveryMethod: 'External' },
    { Index: 4, Type: 'Subtitle', Language: 'ger', DeliveryMethod: 'External' }
  ]
  const subsOn = { subtitlesEnabled: true }

  it('explicit params win', () => {
    expect(pickInitialTracks(withLangs, subsOn, { audio: 1, sub: 4 })).toEqual({
      audioStreamIndex: 1,
      subtitleStreamIndex: 4
    })
  })

  it('preferred audio language beats English and container default', () => {
    expect(
      pickInitialTracks(withLangs, { ...subsOn, preferredAudioLanguage: 'jpn' }, {})
        .audioStreamIndex
    ).toBe(1)
  })

  it('no preference → English, then container default', () => {
    expect(pickInitialTracks(withLangs, subsOn, {}).audioStreamIndex).toBe(2)
    const noEng = withLangs.filter((s) => s.Language !== 'eng' || s.Type !== 'Audio')
    expect(pickInitialTracks(noEng, subsOn, {}).audioStreamIndex).toBe(1)
  })

  it('subtitles off → -1 keeps the server from burning in its default', () => {
    expect(pickInitialTracks(withLangs, { subtitlesEnabled: false }, {}).subtitleStreamIndex).toBe(
      -1
    )
  })

  it('subtitles on, no preference → undefined lets the server pick', () => {
    expect(pickInitialTracks(withLangs, subsOn, {}).subtitleStreamIndex).toBeUndefined()
  })

  it('preferred subtitle language is requested up front (burn-in needs it)', () => {
    expect(
      pickInitialTracks(withLangs, { ...subsOn, preferredSubtitleLanguage: 'ger' }, {})
        .subtitleStreamIndex
    ).toBe(4)
  })
})
