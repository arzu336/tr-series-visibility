import { describe, it, expect, vi, beforeEach } from 'vitest'

// AÇLIK REGRESYONU (canlı veriyle teşhis edildi):
// 24 saatlik kapı setInterval'in içindeydi, yani günlük tazeleme VE haftalık zenginleştirme
// zinciri birlikte günde yalnızca bir kez tetikleniyordu. GDELT geçişinden sonra basın taraması
// ~10 saate çıkıp hiç bitmeyince, zincirde ONUN ARKASINDA duran işlere sıra gelmedi. Canlı
// app.db'deki kanıt:
//     lastScheduledRefreshAt       2026-09-21   (günlük tazeleme çalışıyor)
//     lastAutoNewsScanAt           YOK          (tur bir kez bile tamamlanamadı)
//     lastTourismTrendsCollectAt   2026-08-26   (7 günlük kapısına rağmen 26 gün donmuş)
// Kapı artık SADECE günlük bölümü sarıyor; zincir her tetiklemede sırasını alıyor.
//
// db.js bilerek taklit ediliyor: bu test canlı app.db'yi ne açar ne de meta anahtarlarına yazar.

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

const { runScheduledRefreshInner, META_KEY } = await import('./scheduler.js')

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
    // Günlük tazeleme az önce yapılmış: 24 saat dolmadı.
    metaDeposu.set(META_KEY, String(Date.now() - 60_000))

    await runScheduledRefreshInner()

    expect(cagriSirasi.filter((a) => a.startsWith('gunluk:'))).toEqual([])
    // Kritik satır: bu kırmızıya dönerse öncü turizm sinyali toplayıcısı yine 26 gün susar.
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

  it('günlük tazeleme tamamlanınca kapısını kapatır', async () => {
    expect(metaDeposu.has(META_KEY)).toBe(false)

    await runScheduledRefreshInner()

    expect(Number(metaDeposu.get(META_KEY))).toBeGreaterThan(Date.now() - GUN_MS)
  })
})
