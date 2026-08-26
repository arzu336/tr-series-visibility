import { cacheFirstSerpApi, fetchTrendsByCountryRaw, trendsCacheKey, TRENDS_TTL_MS } from './services/serpApiCache.js'

// Google Trends (ülke bazlı ilgi) — ham SerpAPI çağrısı ve TTL/stale mantığı artık
// server/services/serpApiCache.js'te tek yerde (bkz. proje raporu §4.6 Cache & Performans).
// calculateRegionalScore da AYNI cache anahtarını kullanır, bu yüzden bir dizi için Trends
// verisi bir kez çekilince ikisi de onu paylaşır.
export async function queryTrends(seriesName) {
  const key = trendsCacheKey(seriesName)
  return cacheFirstSerpApi(key, TRENDS_TTL_MS, () => fetchTrendsByCountryRaw(seriesName))
}
