import { describe, it, expect } from 'vitest'
import { isWikiRefreshDue } from './wikiMonthlyRefresh.js'
import { sonTamAyBitisi } from './wikipediaBackfill.js'

describe('aylık okunma tazelemesi', () => {
  const ekim = (gun) => new Date(Date.UTC(2026, 9, gun, 12))

  it('ayın 2sinden itibaren ayda bir kez', () => {
    expect(isWikiRefreshDue({ now: ekim(1), lastMonth: '2026-09' })).toBe(false)
    expect(isWikiRefreshDue({ now: ekim(2), lastMonth: '2026-09' })).toBe(true)
    expect(isWikiRefreshDue({ now: ekim(20), lastMonth: '2026-10' })).toBe(false)
    expect(isWikiRefreshDue({ now: ekim(5), lastMonth: null })).toBe(true)
  })

  it('yarım ay yazılmaz: bitiş, son tamamlanmış ayın son günü', () => {
    expect(sonTamAyBitisi(ekim(5)).toISOString().slice(0, 10)).toBe('2026-09-30')
    expect(
      sonTamAyBitisi(new Date(Date.UTC(2026, 0, 15)))
        .toISOString()
        .slice(0, 10)
    ).toBe('2025-12-31')
  })
})
