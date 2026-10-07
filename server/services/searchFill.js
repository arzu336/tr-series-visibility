import db from '../db.js'
import { getEnrichedVisibility } from '../data-pipeline.js'
import { getTurkishLearningIndex } from '../turkish-learning-interest.js'
import { cacheFirstSerpApi, fetchTrendsTimeSeriesRaw, timeSeriesCacheKey, TIMESERIES_TTL_MS } from './serpApiCache.js'
import { queryTrends } from '../serpapi.js'
import { calculateCountryCompositeScore } from './countryScoringEngine.js'
import { searchTrendCandidates } from './countryReport.js'

// Aylık arama verisi doldurma (2026-10-06; SerpApi Developer planı dahilinde kullanıcı onayıyla). Raporlar tasarım
// gereği ücretli sorgu yapmaz, yalnızca önbellekten okur; bu iş o önbelleği arka planda doldurur:
//   - ülke başına "öne çıkan diziler"in arama payı (tek karşılaştırma sorgusu),
//   - ülke başına brifingdeki 3 dizinin 12 aylık arama ilgisi serisi,
//   - Türkçe öğrenme ilgisi (3 sorgu, küresel görünüm),
//   - en popüler 100 dizinin dünya geneli ülke kırılımı (haritanın arama ilgisi bileşeni; düşük hacimli ülkeler dahil).
// Süresi dolmamış kayıt yeniden sorgulanmaz (cache-first). Aylık kota dolarsa iş durur, kalan ertesi aya kalır.

const META_KEY = 'searchFillMonth'
const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
const metaSet = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)

const WORLDWIDE_SERIES = 100

const isQuotaError = (err) => /kota|quota|429/i.test(String(err?.message || ''))

let running = false

export async function fillSearchData({
  visibility = getEnrichedVisibility,
  composite = calculateCountryCompositeScore,
  timeSeries = (name, iso2) =>
    cacheFirstSerpApi(timeSeriesCacheKey(name, iso2, 'today 12-m'), TIMESERIES_TTL_MS, () =>
      fetchTrendsTimeSeriesRaw(name, iso2, 'today 12-m')
    ),
  turkishLearning = () => getTurkishLearningIndex({ force: true }),
  worldwide = queryTrends,
  worldwideSeries = WORLDWIDE_SERIES,
  onProgress,
} = {}) {
  const { data, raw } = await visibility()
  const countries = data.countries.filter((c) => c.dataSource !== 'proxy' && c.iso2 !== 'TR')
  const result = {
    countries: countries.length,
    worldwide: 0,
    shareOfSearch: 0,
    timeSeries: 0,
    live: 0,
    errors: 0,
    quotaExhausted: false,
  }
  try {
    const tl = await turkishLearning()
    if (!tl.fromCache) result.live += 3
    const populer = [...(raw?.series || [])].sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    for (const s of populer.slice(0, worldwideSeries)) {
      try {
        const w = await worldwide(s.name)
        result.worldwide++
        if (!w.fromCache) result.live++
      } catch (err) {
        if (isQuotaError(err)) throw err
        result.errors++
      }
    }
    for (const [i, c] of countries.entries()) {
      onProgress?.({ done: i, total: countries.length, current: c.iso2 })
      try {
        const sc = await composite(c.iso2, { cachedOnly: false })
        if (sc?.shareOfSearchMeta && !sc.shareOfSearchMeta.skipped) {
          result.shareOfSearch++
          if (sc.shareOfSearchMeta.fromCache === false) result.live++
        }
      } catch (err) {
        if (isQuotaError(err)) throw err
        result.errors++
      }
      for (const s of searchTrendCandidates(c)) {
        try {
          const ts = await timeSeries(s.name, c.iso2)
          result.timeSeries++
          if (!ts.fromCache) result.live++
        } catch (err) {
          if (isQuotaError(err)) throw err
          result.errors++
        }
      }
    }
  } catch (err) {
    if (!isQuotaError(err)) throw err
    result.quotaExhausted = true
    console.warn('[search-fill] SerpApi aylık kotası doldu; kalan iş sonraki aya kaldı')
  }
  return result
}

/** Zamanlayıcı: ayda bir kez. */
export async function runSearchFillIfNeeded({ now = new Date(), fill = fillSearchData } = {}) {
  if (!process.env.SERPAPI_API_KEY || running) return null
  const month = now.toISOString().slice(0, 7)
  if (metaGet.get(META_KEY)?.value === month) return null
  running = true
  try {
    console.log('[search-fill] aylık arama verisi doldurma başladı')
    const r = await fill()
    if (!r.quotaExhausted) metaSet.run(META_KEY, month)
    console.log(`[search-fill] tamamlandı: ${JSON.stringify(r)}`)
    return r
  } finally {
    running = false
  }
}
