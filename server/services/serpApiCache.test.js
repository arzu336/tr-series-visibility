import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import db from '../db.js'
import { cacheFirstSerpApi, serpapiGet, getSerpApiUsageThisMonth, inFlightCount } from './serpApiCache.js'

const silCache = db.prepare("DELETE FROM cache_entries WHERE key LIKE 'test:%'")
const silUsage = db.prepare("DELETE FROM meta WHERE key LIKE 'serpApiUsage:%' OR key LIKE 'liveCalls:%'")

const gecikmeli = (deger, ms = 20) => new Promise((r) => setTimeout(() => r(deger), ms))

beforeEach(() => {
  silCache.run()
  silUsage.run()
})

describe('cacheFirstSerpApi — uçuş içi tekilleştirme', () => {
  it('aynı anahtara eş zamanlı 5 istek TEK fetch yapar, hepsi aynı veriyi alır', async () => {
    const fetchFn = vi.fn(() => gecikmeli({ veri: 42 }))
    const sonuclar = await Promise.all(Array.from({ length: 5 }, () => cacheFirstSerpApi('test:ayni', 60_000, fetchFn)))

    expect(fetchFn).toHaveBeenCalledTimes(1)
    for (const s of sonuclar) expect(s.veri).toBe(42)
    expect(sonuclar.filter((s) => s.coalesced)).toHaveLength(4)
    expect(sonuclar.find((s) => !s.coalesced).fromCache).toBe(false)
    expect(inFlightCount()).toBe(0)
  })

  it('farklı anahtarlar birbirine bağlanmaz', async () => {
    const fetchFn = vi.fn((k) => gecikmeli({ k }))
    await Promise.all([cacheFirstSerpApi('test:a', 60_000, () => fetchFn('a')), cacheFirstSerpApi('test:b', 60_000, () => fetchFn('b'))])
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('ilk istek bittikten sonra gelen istek önbellekten okur, fetch yapmaz', async () => {
    const fetchFn = vi.fn(() => gecikmeli({ veri: 1 }))
    await cacheFirstSerpApi('test:sonra', 60_000, fetchFn)
    const ikinci = await cacheFirstSerpApi('test:sonra', 60_000, fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(ikinci.fromCache).toBe(true)
  })

  it('paylaşılan istek başarısız olursa bekleyenler de aynı hatayı alır ve kayıt temizlenir', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error('kota')))
    const sonuclar = await Promise.allSettled([cacheFirstSerpApi('test:hata', 60_000, fetchFn), cacheFirstSerpApi('test:hata', 60_000, fetchFn)])
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(sonuclar.every((s) => s.status === 'rejected')).toBe(true)
    expect(inFlightCount()).toBe(0)
  })

  it('süresi dolmuş kayıt varken canlı istek düşerse stale:true ile döner', async () => {
    db.prepare('INSERT INTO cache_entries (key, value, expires_at, updated_at) VALUES (?, ?, ?, ?)').run(
      'test:bayat', JSON.stringify({ veri: 'eski' }), Date.now() - 1000, Date.now() - 100_000
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = await cacheFirstSerpApi('test:bayat', 60_000, () => Promise.reject(new Error('ağ')))
    expect(s).toMatchObject({ veri: 'eski', fromCache: true, stale: true, staleReason: 'ağ' })
    vi.restoreAllMocks()
  })
})

describe('serpapiGet — aylık bütçe sayacı', () => {
  const oncekiEnv = { key: process.env.SERPAPI_API_KEY, budget: process.env.SERPAPI_MONTHLY_BUDGET }

  beforeEach(() => {
    process.env.SERPAPI_API_KEY = 'test-key'
    process.env.SERPAPI_MONTHLY_BUDGET = '2'
  })

  afterEach(() => {
    process.env.SERPAPI_API_KEY = oncekiEnv.key
    process.env.SERPAPI_MONTHLY_BUDGET = oncekiEnv.budget
    vi.unstubAllGlobals()
  })

  const okYanit = (body) => ({ ok: true, status: 200, json: async () => body })

  it('başarılı çağrı sayacı 1 artırır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okYanit({ sonuc: 1 })))
    await serpapiGet({ engine: 'google_trends', q: 'x' })
    expect(getSerpApiUsageThisMonth()).toEqual({ used: 1, budget: 2 })
  })

  it('api_key sorgu parametresi olarak gider, params korunur', async () => {
    const fetchMock = vi.fn(async () => okYanit({}))
    vi.stubGlobal('fetch', fetchMock)
    await serpapiGet({ engine: 'google_trends', q: 'Terzi' })
    const url = fetchMock.mock.calls[0][0]
    expect(url.searchParams.get('api_key')).toBe('test-key')
    expect(url.searchParams.get('q')).toBe('Terzi')
  })

  it('başarısız çağrı (5xx) rezervasyonu geri alır — kotadan düşmez', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502 })))
    await expect(serpapiGet({ q: 'x' })).rejects.toThrow(/502/)
    expect(getSerpApiUsageThisMonth().used).toBe(0)
  })

  it('SerpAPI 429 döndürürse rezervasyon geri alınır ve hata 429 taşır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 })))
    await expect(serpapiGet({ q: 'x' })).rejects.toMatchObject({ status: 429 })
    expect(getSerpApiUsageThisMonth().used).toBe(0)
  })

  it('bütçe dolunca ağa ÇIKMADAN 429 fırlatır, sayacı şişirmez', async () => {
    const fetchMock = vi.fn(async () => okYanit({}))
    vi.stubGlobal('fetch', fetchMock)
    await serpapiGet({ q: '1' })
    await serpapiGet({ q: '2' })
    await expect(serpapiGet({ q: '3' })).rejects.toMatchObject({ status: 429 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getSerpApiUsageThisMonth().used).toBe(2)
  })

  it('SerpAPI gövdesinde error alanı varsa hata sayılır ve geri alınır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okYanit({ error: 'Google hasn\'t returned any results' })))
    await expect(serpapiGet({ q: 'x' })).rejects.toThrow(/İstek hatası/)
    expect(getSerpApiUsageThisMonth().used).toBe(0)
  })

  it('anahtar yoksa ağa çıkmadan açık hata', async () => {
    delete process.env.SERPAPI_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(serpapiGet({ q: 'x' })).rejects.toThrow(/SERPAPI_API_KEY/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
