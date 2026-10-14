import { describe, it, expect } from 'vitest'
import { listingSummary, availabilitySummary, pressSummary } from './compare.js'

describe('kıyaslama özetleri', () => {
  it('listeler: Türkiye hariç ülke, ülke-hafta, en iyi sıra, platform', () => {
    const s = listingSummary([
      { iso2: 'DE', platform: 'Netflix', weeks: 3, bestRank: 2 },
      { iso2: 'DE', platform: 'Prime Video', weeks: 1, bestRank: 7 },
      { iso2: 'FR', platform: 'Netflix', weeks: 2, bestRank: 5 },
      { iso2: 'TR', platform: 'Netflix', weeks: 9, bestRank: 1 },
    ])
    expect(s).toEqual({ countries: 2, countryWeeks: 6, bestRank: 2, platforms: 2 })
    expect(listingSummary([]).bestRank).toBeNull()
  })

  it('yayında olduğu ülke: akış listesi olan ülkeler, Türkiye hariç', () => {
    expect(
      availabilitySummary({ DE: { flatrate: [{}] }, FR: { buy: [{}] }, TR: { flatrate: [{}] }, ES: {} }).countries
    ).toBe(1)
  })

  it('basın: haberli ülke, toplam haber, ortalama olumlu', () => {
    expect(
      pressSummary({
        countries: [
          { totalNewsCount: 4, positivePct: 50 },
          { totalNewsCount: 2, positivePct: 70 },
          { totalNewsCount: 0, positivePct: null },
        ],
      })
    ).toEqual({ countriesScanned: 3, countriesWithNews: 2, news: 6, positivePct: 60 })
  })
})
