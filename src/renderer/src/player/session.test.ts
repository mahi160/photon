import { describe, expect, it } from 'vitest'
import { resolveSubtitleSelection, toDemuxedIndex } from './session'
import { pickInitialTracks } from './usePlayback'
import type { MediaStream } from '../lib/jellyfin'

describe('toDemuxedIndex', () => {
  // video=0, audio=1, subs: 2 (External), 3 (embedded/PGS), 4 (External), 5 (embedded/ASS)
  const subtitleStreams: MediaStream[] = [
    { Index: 2, Type: 'Subtitle', DeliveryMethod: 'External' },
    { Index: 3, Type: 'Subtitle', DeliveryMethod: 'Encode' },
    { Index: 4, Type: 'Subtitle', DeliveryMethod: 'External' },
    { Index: 5, Type: 'Subtitle', DeliveryMethod: 'Encode' }
  ]
  const sess = { subtitleStreams }

  it('no external subs before it → unchanged', () => {
    expect(toDemuxedIndex(sess, 1)).toBe(1) // audio, before any subtitle
  })

  it('one external sub before it → shifted down by one', () => {
    expect(toDemuxedIndex(sess, 3)).toBe(2) // embedded sub, after the one external sub at 2
  })

  it('two external subs before it → shifted down by two', () => {
    expect(toDemuxedIndex(sess, 5)).toBe(3) // embedded sub, after external subs at 2 and 4
  })

  it('no subtitle streams at all → unchanged', () => {
    expect(toDemuxedIndex({ subtitleStreams: [] }, 1)).toBe(1)
  })
})

describe('resolveSubtitleSelection', () => {
  const sess = {
    textTracks: [
      { index: 3, label: 'English', language: 'eng', url: '' },
      { index: 5, label: 'German', language: 'ger', url: '' }
    ],
    mediaSource: {} as { DefaultSubtitleStreamIndex?: number }
  }
  const on = { subtitlesEnabled: true }
  const off = { subtitlesEnabled: false }

  it('explicit text track → displayed and activated', () => {
    expect(resolveSubtitleSelection(sess, 3, on)).toEqual({
      display: 3,
      textTrack: 3,
      embeddedTrack: null
    })
  })

  it('explicit embedded (non-text) track → displayed, selected via mpv directly', () => {
    expect(resolveSubtitleSelection(sess, 4, on)).toEqual({
      display: 4,
      textTrack: null,
      embeddedTrack: 4
    })
  })

  it('-1 → explicitly off, even with subtitles enabled', () => {
    expect(resolveSubtitleSelection(sess, -1, on)).toEqual({
      display: null,
      textTrack: null,
      embeddedTrack: null
    })
  })

  it('no request + subtitles disabled → off', () => {
    expect(resolveSubtitleSelection(sess, undefined, off)).toEqual({
      display: null,
      textTrack: null,
      embeddedTrack: null
    })
  })

  it('no request → preferred language wins over server default', () => {
    const s = { ...sess, mediaSource: { DefaultSubtitleStreamIndex: 3 } }
    expect(
      resolveSubtitleSelection(s, undefined, { ...on, preferredSubtitleLanguage: 'ger' })
    ).toEqual({ display: 5, textTrack: 5, embeddedTrack: null })
  })

  it('no request → falls back to the server default text track', () => {
    const s = { ...sess, mediaSource: { DefaultSubtitleStreamIndex: 5 } }
    expect(resolveSubtitleSelection(s, undefined, on)).toEqual({
      display: 5,
      textTrack: 5,
      embeddedTrack: null
    })
  })

  it('no request, non-text server default → selected via mpv directly, no reload needed', () => {
    const s = { ...sess, mediaSource: { DefaultSubtitleStreamIndex: 4 } }
    expect(resolveSubtitleSelection(s, undefined, on)).toEqual({
      display: 4,
      textTrack: null,
      embeddedTrack: 4
    })
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

  it('subtitles on, no preference, no server default → undefined lets the server pick', () => {
    expect(pickInitialTracks(withLangs, subsOn, {}).subtitleStreamIndex).toBeUndefined()
  })

  it('subtitles on, no preference → falls back to the server default (burn-in needs it up front)', () => {
    expect(pickInitialTracks(withLangs, subsOn, {}, 4).subtitleStreamIndex).toBe(4)
  })

  it('preferred subtitle language is requested up front (burn-in needs it)', () => {
    expect(
      pickInitialTracks(withLangs, { ...subsOn, preferredSubtitleLanguage: 'ger' }, {})
        .subtitleStreamIndex
    ).toBe(4)
  })
})
