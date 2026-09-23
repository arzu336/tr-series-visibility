import { describe, it, expect, vi, beforeEach } from 'vitest'

const metaDeposu = new Map()

vi.mock('./db.js', () => ({
  default: {
    prepare: (sql) => ({
      get: (key) => (metaDeposu.has(key) ? { value: metaDeposu.get(key) } : undefined),
      run: (key, value) => metaDeposu.set(key, value),
      all: () => [],
    }),
  },
}))

const cagriSirasi = []
const kaydet = (ad) => vi.fn(async () => { cagriSirasi.push(ad) })

vi.mock('./auth.js', () => ({ purgeExpiredSessions: vi.fn(() => 0) }))
vi.mock('./cache.js', () => ({ purgeExpiredCacheEntries: vi.fn(() => 0) }))
vi.mock('./data-pipeline.js', () => ({ getEnrichedVisibility: kaydet('gunluk:visibility') }))
vi.mock('./period-history.js', () => ({ rollupMonthlyIfNeeded: kaydet('gunluk:rollup') }))
vi.mock('./series-period-history.js', () => ({ rollupSeriesMonthlyIfNeeded: kaydet('gunluk:seriesRollup') }))
vi.mock('./services/tourismData.js', () => ({ syncTourismDataIfNeeded: kaydet('zincir:tourismSync') }))
vi.mock('./services/autoNewsScheduler.js', () => ({ runAutoNewsScanIfNeeded: kaydet('zincir:news') }))
vi.mock('./services/tourismTrendsCollector.js', () => ({ runTourismTrendsCollectionIfNeeded: kaydet('zincir:tourismTrends') }))
vi.mock('./services/socialEnricher.js', () => ({ runSocialEnrichmentIfNeeded: kaydet('zincir:social') }))
vi.mock('./services/actorTrendsCollector.js', () => ({ runActorTrendsCollectionIfNeeded: kaydet('zincir:actor') }))
vi.mock('./services/netflixPipelineRunner.js', () => ({ runNetflixSyncIfNeeded: kaydet('zincir:netflix') }))

const { runScheduledRefreshInner, startScheduler, META_KEY } = await import('./scheduler.js')

const GUN_MS = 24 * 60 * 60 * 1000

beforeEach(() => {
  cagriSirasi.length = 0
  metaDeposu.clear()
})

describe('zamanlanmış tetikleme', () => {
  it('günlük kapı AÇIKKEN hem günlük tazeleme hem zincir çalışır', async () => {
    await runScheduledRefreshInner()

    expect(cagriSirasi).toContain('gunluk:visibility')
    expect(cagriSirasi).toContain('zincir:news')
    expect(cagriSirasi).toContain('zincir:tourismTrends')
  })

  it('günlük kapı KAPALIYKEN zincir YİNE DE çalışır (açlık regresyonunun tam senaryosu)', async () => {
    metaDeposu.set(META_KEY, String(Date.now() - 60_000))

    await runScheduledRefreshInner()

    expect(cagriSirasi.filter((a) => a.startsWith('gunluk:'))).toEqual([])
    expect(cagriSirasi).toContain('zincir:tourismTrends')
    expect(cagriSirasi).toContain('zincir:news')
  })

  it('basın taraması ile turizm toplayıcısı arasındaki sıra korunur', async () => {
    await runScheduledRefreshInner()

    expect(cagriSirasi.indexOf('zincir:news')).toBeLessThan(cagriSirasi.indexOf('zincir:tourismTrends'))
  })

  it('basın taraması ÇÖKSE BİLE arkasındaki işlere sıra gelir', async () => {
    const { runAutoNewsScanIfNeeded } = await import('./services/autoNewsScheduler.js')
    vi.mocked(runAutoNewsScanIfNeeded).mockRejectedValueOnce(new Error('GDELT erişilemedi'))

    await runScheduledRefreshInner()

    expect(cagriSirasi).toContain('zincir:tourismTrends')
  })

  it('kapalı işler (C.3 kararı) env bayrağı olmadan çalışmaz', async () => {
    delete process.env.ENABLE_SOCIAL_ENRICHMENT
    delete process.env.ENABLE_ACTOR_TRENDS

    await runScheduledRefreshInner()

    expect(cagriSirasi).not.toContain('zincir:social')
    expect(cagriSirasi).not.toContain('zincir:actor')
  })

  it('haftalık Netflix senkronizasyonu zincirde tetiklenir — günlük kapı kapalıyken de', async () => {
    metaDeposu.set(META_KEY, String(Date.now() - 60_000))

    await runScheduledRefreshInner()

    expect(cagriSirasi).toContain('zincir:netflix')
  })

  it('Netflix senkronizasyonu zincirin SONUNDA çalışır (15 dk sürebilir, önündekileri geciktirmez)', async () => {
    await runScheduledRefreshInner()

    const netflixSira = cagriSirasi.indexOf('zincir:netflix')
    expect(netflixSira).toBeGreaterThan(cagriSirasi.indexOf('zincir:news'))
    expect(netflixSira).toBeGreaterThan(cagriSirasi.indexOf('zincir:tourismTrends'))
    expect(netflixSira).toBe(cagriSirasi.length - 1)
  })

  it('Netflix senkronizasyonu FIRLATSA BİLE tetikleme çökmez ve bir sonraki tur çalışır', async () => {
    const { runNetflixSyncIfNeeded } = await import('./services/netflixPipelineRunner.js')
    vi.mocked(runNetflixSyncIfNeeded).mockRejectedValueOnce(new Error('python: command not found'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runScheduledRefreshInner()).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalledWith('[scheduler] Netflix senkronizasyonu başarısız:', 'python: command not found')

    cagriSirasi.length = 0
    await runScheduledRefreshInner()
    expect(cagriSirasi).toContain('zincir:netflix')
    consoleError.mockRestore()
  })

  it('önündeki iş çökse bile Netflix senkronizasyonuna sıra gelir', async () => {
    const { runTourismTrendsCollectionIfNeeded } = await import('./services/tourismTrendsCollector.js')
    vi.mocked(runTourismTrendsCollectionIfNeeded).mockRejectedValueOnce(new Error('SerpAPI kotası'))

    await runScheduledRefreshInner()

    expect(cagriSirasi).toContain('zincir:netflix')
  })

  it('günlük tazeleme LLM sınıflandırmasının BİTMESİNİ bekler (kullanıcı isteğinden farklı)', async () => {
    const { getEnrichedVisibility } = await import('./data-pipeline.js')
    await runScheduledRefreshInner()
    expect(vi.mocked(getEnrichedVisibility)).toHaveBeenCalledWith({ waitForClassification: true })
  })

  it('startScheduler yeniden başlatma sonrası ilk turu 30 dk beklemeden atar', async () => {
    vi.useFakeTimers()
    try {
      const durdur = startScheduler({ initialDelayMs: 1000, intervalMs: 10_000 })
      expect(cagriSirasi).toEqual([])
      await vi.advanceTimersByTimeAsync(1000)
      expect(cagriSirasi).toContain('gunluk:visibility')

      cagriSirasi.length = 0
      await vi.advanceTimersByTimeAsync(10_000)
      expect(cagriSirasi).toContain('zincir:news') // periyodik tur da çalıştı
      durdur()
      cagriSirasi.length = 0
      await vi.advanceTimersByTimeAsync(30_000)
      expect(cagriSirasi).toEqual([]) // durdurulduktan sonra sessiz
    } finally {
      vi.useRealTimers()
    }
  })

  it('günlük tazeleme tamamlanınca kapısını kapatır', async () => {
    expect(metaDeposu.has(META_KEY)).toBe(false)

    await runScheduledRefreshInner()

    expect(Number(metaDeposu.get(META_KEY))).toBeGreaterThan(Date.now() - GUN_MS)
  })
})
