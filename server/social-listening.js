import { cacheFirstSerpApi, fetchSocialListeningRaw, socialCacheKey, SOCIAL_TTL_MS } from './services/serpApiCache.js'

export async function querySocialListening(seriesName) {
  const key = socialCacheKey(seriesName)
  return cacheFirstSerpApi(key, SOCIAL_TTL_MS, () => fetchSocialListeningRaw(seriesName))
}
