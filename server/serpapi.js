import { cacheFirstSerpApi, fetchTrendsByCountryRaw, trendsCacheKey, TRENDS_TTL_MS } from './services/serpApiCache.js'

export async function queryTrends(seriesName) {
  const key = trendsCacheKey(seriesName)
  return cacheFirstSerpApi(key, TRENDS_TTL_MS, () => fetchTrendsByCountryRaw(seriesName))
}
