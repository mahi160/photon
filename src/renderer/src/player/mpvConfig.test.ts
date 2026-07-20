import { describe, expect, it } from 'vitest'
import { parseMpvConfig } from './mpvConfig'

describe('parseMpvConfig', () => {
  it('empty string → no pairs', () => {
    expect(parseMpvConfig('')).toEqual([])
  })

  it('parses key=value lines', () => {
    expect(parseMpvConfig('sub-font-size=64\nsub-color=#FFFF00')).toEqual([
      ['sub-font-size', '64'],
      ['sub-color', '#FFFF00']
    ])
  })

  it('trims whitespace around key and value', () => {
    expect(parseMpvConfig('  sub-font-size = 64  ')).toEqual([['sub-font-size', '64']])
  })

  it('ignores blank lines', () => {
    expect(parseMpvConfig('sub-font-size=64\n\n\nsub-color=#fff')).toEqual([
      ['sub-font-size', '64'],
      ['sub-color', '#fff']
    ])
  })

  it('ignores # and ; comment lines', () => {
    expect(parseMpvConfig('# a comment\n; another\nsub-font-size=64')).toEqual([
      ['sub-font-size', '64']
    ])
  })

  it('strips a leading -- prefix', () => {
    expect(parseMpvConfig('--sub-font-size=64')).toEqual([['sub-font-size', '64']])
  })

  it('allows an empty value', () => {
    expect(parseMpvConfig('sub-back-color=')).toEqual([['sub-back-color', '']])
  })

  it('drops lines with no =', () => {
    expect(parseMpvConfig('fullscreen\nsub-font-size=64')).toEqual([['sub-font-size', '64']])
  })

  it('drops lines with an empty key', () => {
    expect(parseMpvConfig('=64\nsub-font-size=64')).toEqual([['sub-font-size', '64']])
  })

  it('later duplicate keys are both kept, in order — last one applied wins', () => {
    expect(parseMpvConfig('sub-font-size=64\nsub-font-size=48')).toEqual([
      ['sub-font-size', '64'],
      ['sub-font-size', '48']
    ])
  })
})
