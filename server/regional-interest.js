import { getCached } from './cache.js'
import {
  cacheFirstSerpApi,
  fetchRegionalInterestRaw,
  regionalCacheKey,
  TRENDS_TTL_MS,
  calculateRegionalScore,
} from './services/serpApiCache.js'

export async function getRegionalInterest(seriesName, iso2) {
  const key = regionalCacheKey(seriesName, iso2)
  const result = await cacheFirstSerpApi(key, TRENDS_TTL_MS, () => fetchRegionalInterestRaw(seriesName, iso2))

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
