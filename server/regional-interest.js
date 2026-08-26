import { getCached } from './cache.js'
import {
  cacheFirstSerpApi,
  fetchRegionalInterestRaw,
  regionalCacheKey,
  TRENDS_TTL_MS,
  calculateRegionalScore,
} from './services/serpApiCache.js'

// Ham SerpAPI çağrısı ve TTL/stale mantığı artık server/services/serpApiCache.js'te (bkz.
// proje raporu §4.6 Cache & Performans). Bazı ülke/dizi kombinasyonlarında Google Trends hiç
// veri döndürmeyebilir — bu durumda dürüstçe boş byRegion döner, uydurma bir liste üretilmez
// (bkz. serpApiCache.js'teki fetchRegionalInterestRaw).
export async function getRegionalInterest(seriesName, iso2) {
  const key = regionalCacheKey(seriesName, iso2)
  const result = await cacheFirstSerpApi(key, TRENDS_TTL_MS, () => fetchRegionalInterestRaw(seriesName, iso2))

  // Hibrit Yerel Skor: TMDB'nin (raw-series-providers cache'i, data-pipeline.js tarafından
  // dolduruluyor) tek global popülerlik sayısını bu ülkedeki Google Trends ilgisiyle
  // ağırlıklandırır. TMDB önbelleği o an taze değilse (süresi dolmuş/hiç çekilmemiş) dürüstçe
  // atlanır — bu route'un işi TMDB'yi tazelemek değil, var olan veriyle bir ek bakış sunmak.
  let hybridScore = null
  const rawSeries = getCached('raw-series-providers')
  const matchedSeries = rawSeries?.series?.find(
    (s) => s.name.trim().toLocaleLowerCase('tr') === seriesName.trim().toLocaleLowerCase('tr')
  )
  if (matchedSeries) {
    try {
      hybridScore = await calculateRegionalScore(matchedSeries.popularity, iso2, seriesName)
    } catch (err) {
      console.error('[regional-interest] hibrit skor hesaplanamadı:', err.message)
    }
  }

  return { ...result, hybridScore }
}
