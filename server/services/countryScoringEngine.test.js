import { describe, it, expect } from 'vitest'
import { listPerformance, pickCandidates, getAvailabilityScore } from './countryScoringEngine.js'

const r = (series_id, provider, segment, period_date, rank) => ({ series_id, provider, segment, period_date, rank })

describe('listPerformance — tüm platformların Top 10 listeleri', () => {
  it('aynı hafta birden çok platformda tek hafta; en iyi sıra; platformlar birlikte', () => {
    const m = listPerformance([
      r(1, 'netflix_tudum', 'TV', '2026-09-27', 4),
      r(1, 'flixpatrol', 'shahid', '2026-09-25', 2), // aynı hafta (Pazar 27 Eylül)
      r(1, 'flixpatrol', 'shahid', '2026-10-02', 3), // sonraki hafta
      r(2, 'flixpatrol', 'disney', '2026-10-02', 10),
    ])
    expect(m.get(1)).toMatchObject({ weeks: 2, bestRank: 2, platforms: ['Netflix', 'Shahid'] })
    expect(m.get(1).evidence).toBe('Listelerde 2 hafta') // kaynak/platform adı yok
    // 60 × 2/26 + 40 × 9/10
    expect(m.get(1).value).toBeCloseTo(40.6, 1)
    expect(m.get(2).value).toBeCloseTo(6.3, 1)
  })

  it('26 hafta ve 1. sıra tavanı 100', () => {
    const rows = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 4 + i * 7)).toISOString().slice(0, 10)
      return r(5, 'netflix_tudum', 'TV', d, 1)
    })
    expect(listPerformance(rows).get(5).value).toBe(100)
  })
})

describe('pickCandidates — aday havuzu', () => {
  const raw = {
    series: [
      { id: 1, name: 'Popüler', popularity: 90 },
      { id: 2, name: 'Listede', popularity: 5 },
      { id: 3, name: 'Yayında değil', popularity: 80 },
      { id: 4, name: 'Orta', popularity: 40 },
    ],
    providersById: { 1: { DE: {} }, 2: { DE: {} }, 4: { DE: {} } },
  }

  it('önce listelere giren (popülerliği düşük olsa da), sonra yayındaki en popüler; tekrar yok', () => {
    const lists = new Map([
      [2, { value: 50 }],
      [99, { value: 90 }], // katalogda yok → atlanır
    ])
    expect(pickCandidates(raw, 'DE', lists, 3).map((s) => s.id)).toEqual([2, 1, 4])
    expect(pickCandidates(raw, 'DE', new Map(), 5).map((s) => s.id)).toEqual([1, 4, 2])
  })
})

describe('getAvailabilityScore — yayın varlığı', () => {
  it('TMDB kaydı yoksa Top 10 listesindeki platformlar kanıt sayılır; ikisi de yoksa 0', () => {
    expect(getAvailabilityScore(undefined, { platforms: ['Shahid'] })).toEqual({
      value: 25,
      evidence: 'Listede olduğu 1 platformda yayında',
    })
    expect(getAvailabilityScore(undefined, null).value).toBe(0)
    const tmdb = { flatrate: [{ provider_id: 8 }, { provider_id: 9 }] }
    expect(getAvailabilityScore(tmdb, { platforms: ['Shahid'] })).toEqual({
      value: 50,
      evidence: '2 farklı platformda yayında',
    })
  })
})
