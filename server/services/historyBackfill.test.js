import { describe, it, expect } from 'vitest'
import { trendsBackfillOrder, trendsStart } from './historyBackfill.js'
import { buildYearSearch, buildYearLists, buildYearTourism, yearRange } from './yearReport.js'

describe('geçmiş doldurma ve yıllık rapor', () => {
  it('arama geçmişi sırası: çok yıllık serisi olmayanlar, listelere girmiş olan önce', () => {
    const series = [
      { id: 1, name: 'A', popularity: 90 },
      { id: 2, name: 'B', popularity: 10 },
      { id: 3, name: 'C', popularity: 50 },
    ]
    const order = trendsBackfillOrder(series, new Map([[2, 5]]), (n) => n === 'c').map((s) => s.id)
    expect(order).toEqual([2, 1])
  })

  it('arama serisi 2010’dan, daha yeni dizide yayın yılından başlar', () => {
    expect(trendsStart({ firstAirDate: '2005-09-01' })).toBe('2010-01-01')
    expect(trendsStart({ firstAirDate: '2023-03-10' })).toBe('2023-01-01')
    expect(trendsStart({})).toBe('2010-01-01')
  })

  it('yıllık arama: yılı en çok kapsayan seriden yalnızca o yılın haftaları', () => {
    const ts = (d) => Date.parse(`${d}T00:00:00Z`) / 1000
    const uzun = {
      window_start: '2021-01-03',
      window_end: '2026-10-04',
      fetched_at: '2026-10-13',
      timeline: JSON.stringify([
        { timestamp: ts('2023-01-08'), value: 40 },
        { timestamp: ts('2023-06-04'), value: 80 },
        { timestamp: ts('2024-01-07'), value: 20 },
      ]),
    }
    const kisa = {
      window_start: '2025-10-05',
      window_end: '2026-10-04',
      fetched_at: '2026-10-14',
      timeline: JSON.stringify([
        { timestamp: ts('2025-10-05'), value: 10 },
        { timestamp: ts('2026-01-04'), value: 100 },
      ]),
    }
    const r = buildYearSearch([kisa, uzun], '2023-01-01', '2023-12-31')
    expect(r.data.timeline.map((p) => p.value)).toEqual([40, 80])
    expect(r.data.coverage.from).toBe('2021-01-03')
  })

  it('yıllık listeler: hafta sayısı ve aylık dizi sayısı; katalogda olmayan atlanır', () => {
    const r = buildYearLists(
      [
        { series_id: 1, period_date: '2024-03-04', rank: 5, provider: 'netflix_tudum' },
        { series_id: 1, period_date: '2024-03-11', rank: 2, provider: 'netflix_tudum' },
        { series_id: 9, period_date: '2024-03-11', rank: 1, provider: 'flixpatrol', platform: 'shahid' },
      ],
      new Map([[1, 'Dizi']])
    )
    expect(r.data.top).toEqual([{ seriesId: 1, name: 'Dizi', weeks: 2, bestRank: 2, platforms: ['netflix'] }])
    expect(r.data.monthly).toEqual([{ month: '2024-03', series: 1 }])
  })

  it('yıllık turizm: önceki yılın aynı aylarına göre değişim', () => {
    const r = buildYearTourism(
      [
        { year: 2024, month: 12, visitor_count: 110 },
        { year: 2025, month: 1, visitor_count: 110 },
      ],
      [
        { year: 2023, month: 12, visitor_count: 100 },
        { year: 2024, month: 1, visitor_count: 100 },
        { year: 2024, month: 3, visitor_count: 999 },
      ]
    )
    expect(r.data).toMatchObject({ total: 220, changePct: 10 })
    expect(r.data.monthly.map((m) => m.month)).toEqual(['2024-12', '2025-01'])
  })

  it('dönem: ay aralığı, etiket ve doğrulama', async () => {
    const { periodRange, periodLabel, parsePeriod } = await import('./yearReport.js')
    expect(periodRange({ from: '2023-02', to: '2024-02' }, new Date('2026-10-13T10:00:00Z'))).toMatchObject({
      from: '2023-02-01',
      to: '2024-02-29',
      ymFrom: 202302,
      ymTo: 202402,
      partial: false,
    })
    expect(periodLabel({ from: '2024-01', to: '2024-12' })).toBe('2024')
    expect(periodLabel({ from: '2023-01', to: '2024-06' })).toBe('Ocak 2023 – Haziran 2024')
    expect(parsePeriod({ year: '2025' })).toEqual({ from: '2025-01', to: '2025-12' })
    expect(parsePeriod({ from: '2025-06', to: '2025-01' })).toBeNull()
    expect(parsePeriod({ from: 'x', to: '2025-01' })).toBeNull()
  })

  it('içinde bulunulan yıl bugüne kadar', () => {
    expect(yearRange(2026, new Date('2026-10-13T10:00:00Z'))).toEqual({
      from: '2026-01-01',
      to: '2026-10-13',
      partial: true,
    })
    expect(yearRange(2024, new Date('2026-10-13T10:00:00Z'))).toEqual({
      from: '2024-01-01',
      to: '2024-12-31',
      partial: false,
    })
  })

  it('kıta: diziler ülke-haftaya, ülkeler dizi sayısına göre sıralanır', async () => {
    const { buildContinentSeries, buildContinentCountries } = await import('./yearReport.js')
    const names = new Map([
      [1, 'A'],
      [2, 'B'],
    ])
    const rows = [
      { series_id: 1, country_iso2: 'DE', period_date: '2026-01-05', rank: 3, provider: 'netflix_tudum' },
      { series_id: 1, country_iso2: 'DE', period_date: '2026-01-12', rank: 2, provider: 'netflix_tudum' },
      { series_id: 2, country_iso2: 'DE', period_date: '2026-01-05', rank: 5, provider: 'netflix_tudum' },
      { series_id: 2, country_iso2: 'FR', period_date: '2026-01-05', rank: 1, provider: 'netflix_tudum' },
      { series_id: 2, country_iso2: 'IT', period_date: '2026-01-05', rank: 4, provider: 'netflix_tudum' },
    ]
    const s = buildContinentSeries(rows, names).data
    expect(s.top.map((t) => [t.name, t.countries.length, t.countryWeeks])).toEqual([
      ['B', 3, 3],
      ['A', 1, 2],
    ])
    const c = buildContinentCountries(
      rows,
      [{ iso2: 'ES', idx: 40, level: 'Orta' }],
      ['DE', 'FR', 'IT', 'ES', 'PL']
    ).data
    expect(c).toMatchObject({ total: 5, listed: 3 })
    expect(c.rows.map((r) => r.iso2)).toEqual(['DE', 'FR', 'IT', 'ES'])
    expect(c.rows[3]).toMatchObject({ series: 0, watchLevel: 'Orta' })
  })
})
