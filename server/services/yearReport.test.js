import { describe, it, expect } from 'vitest'
import { buildYearTourism } from './yearReport.js'

describe('kıta raporu hesaplayıcıları', () => {
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
