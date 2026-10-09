import { describe, it, expect, vi } from 'vitest'

vi.mock('../data-pipeline.js', () => ({ getEnrichedVisibility: vi.fn() }))
vi.mock('./charts.js', () => ({ getAllOwnRankings: vi.fn() }))
vi.mock('./newsScanTargets.js', () => ({ getSeriesPressCountries: vi.fn() }))
vi.mock('./autoNewsScheduler.js', () => ({ scanSeriesAcrossCountries: vi.fn() }))
vi.mock('./serpApiCache.js', () => ({
  getSerpApiUsageThisMonth: () => ({ used: 0, budget: 5000, ownCounter: 0 }),
  refreshSerpApiAccountUsage: async () => null,
  readStoredSerpApi: () => null,
  cacheFirstSerpApi: vi.fn(),
  fetchRegionalInterestRaw: vi.fn(),
  regionalCacheKey: (n, i) => `${n}::${i}`,
  calculateRegionalScore: vi.fn(),
}))

const { istanbulClock, pressOrder, runNightlyPrefillIfNeeded } = await import('./nightlyPrefill.js')

describe('istanbulClock', () => {
  it('UTC 23:30 → Türkiye 02:30 ertesi gün', () => {
    expect(istanbulClock(new Date('2026-10-09T23:30:00Z'))).toEqual({ day: '2026-10-10', hour: 2 })
  })
})

describe('pressOrder — gece basın sırası', () => {
  it('kuyruktaki dizi önce, sonra listelere girdiği ülke sayısı; yeterince taze taranmış dizi atlanır', () => {
    const series = [
      { id: 1, popularity: 90 },
      { id: 2, popularity: 10 },
      { id: 3, popularity: 50 },
      { id: 4, popularity: 99 },
    ]
    const order = pressOrder({
      series,
      freshCount: new Map([[4, 5]]),
      listedCount: new Map([
        [1, 2],
        [3, 9],
      ]),
      queue: ['2'],
    }).map((s) => s.id)
    expect(order).toEqual([2, 3, 1])
  })
})

describe('runNightlyPrefillIfNeeded — zaman penceresi', () => {
  it('pencere 01:00–10:00 (Türkiye); öğlen hiçbir şey yapmaz (ücretli sorgu yok)', async () => {
    const r = await runNightlyPrefillIfNeeded({ now: new Date('2026-10-09T09:00:00Z') }) // 12:00 TR
    expect(r).toEqual({ skipped: 'gündüz' })
  })
})
