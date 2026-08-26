import { cacheFirstSerpApi, fetchSocialListeningRaw, socialCacheKey, SOCIAL_TTL_MS } from './services/serpApiCache.js'

// Knowledge Graph + YouTube — ham SerpAPI çağrıları ve TTL/stale mantığı artık
// server/services/serpApiCache.js'te (bkz. proje raporu §4.6 Cache & Performans).
export async function querySocialListening(seriesName) {
  const key = socialCacheKey(seriesName)
  return cacheFirstSerpApi(key, SOCIAL_TTL_MS, () => fetchSocialListeningRaw(seriesName))
}
