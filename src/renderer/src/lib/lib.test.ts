import { describe, expect, it } from 'vitest'
import { normalizeServer, secondsToTicks, ticksToSeconds } from './jellyfin'
import { filterLocal } from './search'
import type { BaseItem } from './jellyfin'

describe('normalizeServer', () => {
  it('adds protocol and strips trailing slashes', () => {
    expect(normalizeServer('demo.jellyfin.org/')).toBe('http://demo.jellyfin.org')
    expect(normalizeServer('https://my.server:8096///')).toBe('https://my.server:8096')
    expect(normalizeServer('  http://x  ')).toBe('http://x')
  })
})

describe('ticks conversion', () => {
  it('round-trips', () => {
    expect(ticksToSeconds(secondsToTicks(123.4))).toBeCloseTo(123.4)
    expect(ticksToSeconds(undefined)).toBe(0)
  })
})

describe('filterLocal', () => {
  const items = ['Alien', 'Aliens', 'The Alienist', 'Blade Runner'].map(
    (Name, i) => ({ Id: String(i), Name, Type: 'Movie' }) as BaseItem
  )
  it('ranks prefix matches first, includes substring matches', () => {
    const names = filterLocal(items, 'alien').map((i) => i.Name)
    expect(names).toEqual(['Alien', 'Aliens', 'The Alienist'])
  })
  it('is case-insensitive and respects limit', () => {
    expect(filterLocal(items, 'ALIEN', 1).map((i) => i.Name)).toEqual(['Alien'])
    expect(filterLocal(items, 'zzz')).toEqual([])
  })
})
