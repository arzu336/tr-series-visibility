import { describe, it, expect, beforeEach } from 'vitest'
import db from '../db.js'
import { fillSearchData, runSearchFillIfNeeded } from './searchFill.js'

const visibility = async () => ({
  raw: {
    series: [
      { name: 'B', popularity: 9 },
      { name: 'A', popularity: 1 },
    ],
  },
  data: {
    countries: [
      { iso2: 'TR', dataSource: 'tmdb', seriesList: [{ name: 'X', popularity: 1 }] },
      { iso2: 'MN', dataSource: 'proxy', seriesList: [] },
      {
        iso2: 'DE',
        dataSource: 'tmdb',
        seriesList: [
          { name: 'A', popularity: 1 },
          { name: 'B', popularity: 9 },
          { name: 'C', popularity: 5 },
          { name: 'D', popularity: 7 },
        ],
      },
    ],
  },
})

beforeEach(() => db.prepare("DELETE FROM meta WHERE key = 'searchFillMonth'").run())

describe('aylık arama verisi doldurma', () => {
  it('yalnızca katalog ülkeleri (Türkiye hariç): arama payı + en popüler 3 dizinin serisi; canlı sorgu sayılır', async () => {
    const seriler = []
    const r = await fillSearchData({
      visibility,
      composite: async () => ({ shareOfSearchMeta: { fromCache: false, stale: false } }),
      timeSeries: async (name, iso2) => {
        seriler.push(`${iso2}:${name}`)
        return { fromCache: name === 'B' }
      },
      turkishLearning: async () => ({ fromCache: false }),
      worldwide: async (name) => ({ fromCache: name === 'A' }),
      worldwideSeries: 1,
    })
    expect(seriler).toEqual(['DE:B', 'DE:D', 'DE:C'])
    expect(r).toMatchObject({
      countries: 1,
      worldwide: 1,
      shareOfSearch: 1,
      timeSeries: 3,
      live: 3 + 1 + 1 + 2,
      quotaExhausted: false,
    })
  })

  it('kota dolunca durur; ayda bir kez çalışır, kota dolduysa ay işaretlenmez', async () => {
    const r = await fillSearchData({
      visibility,
      composite: async () => {
        throw new Error('Aylık kota dolmuş görünüyor (429)')
      },
      timeSeries: async () => ({ fromCache: true }),
      turkishLearning: async () => ({ fromCache: true }),
      worldwide: async () => ({ fromCache: true }),
    })
    expect(r.quotaExhausted).toBe(true)
    process.env.SERPAPI_API_KEY = process.env.SERPAPI_API_KEY || 'test'
    const now = new Date('2026-10-06T10:00:00Z')
    await runSearchFillIfNeeded({ now, fill: async () => ({ quotaExhausted: true }) })
    let cagri = 0
    await runSearchFillIfNeeded({ now, fill: async () => (cagri++, { quotaExhausted: false }) })
    await runSearchFillIfNeeded({ now, fill: async () => (cagri++, { quotaExhausted: false }) })
    expect(cagri).toBe(1)
  })
})
