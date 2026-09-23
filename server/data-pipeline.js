import { getRawSeriesData } from './tmdb.js'
import { getCached, setCached } from './cache.js'
import { ensureClassified } from './themes.js'
import { ensureDetected } from './destinations.js'
import { buildVisibility, mergeProxyFallback, attachPerCapitaScores } from './aggregate.js'
import { getCountryDemographics } from './services/countryDemographics.js'
import { getTrend, maybeRecordSnapshot, loadHistoryStore } from './history.js'
import { getFallbackInterestScores } from './services/proxyScore.js'
import { maybeRecordSeriesSnapshot } from './series-period-history.js'

const RAW_CACHE_KEY = 'raw-series-providers'
const RAW_CACHE_TTL_MS = 24 * 60 * 60 * 1000

let rawFetchInFlight = null

export async function getRawSeriesDataCached() {
  const cached = getCached(RAW_CACHE_KEY)
  if (cached) return cached
  if (rawFetchInFlight) return rawFetchInFlight

  rawFetchInFlight = (async () => {
    const data = await getRawSeriesData()
    setCached(RAW_CACHE_KEY, data, RAW_CACHE_TTL_MS)
    return data
  })().finally(() => {
    rawFetchInFlight = null
  })

  return rawFetchInFlight
}

export async function getEnrichedVisibility() {
  const raw = await getRawSeriesDataCached()
  const themeStore = await ensureClassified(raw.series)
  const destinationStore = await ensureDetected(raw.series)
  const data = buildVisibility(raw, themeStore, destinationStore)

  try {
    const fallback = await getFallbackInterestScores()
    data.countries = mergeProxyFallback(data.countries, fallback)
  } catch (err) {
    console.error('[visibility] arama hacmi fallback verisi alınamadı:', err.message)
  }

  try {
    const demographics = await getCountryDemographics()
    data.countries = attachPerCapitaScores(data.countries, demographics)
  } catch (err) {
    console.error('[visibility] demografi verisi alınamadı, kişi başına skor hesaplanmadı:', err.message)
    data.countries = attachPerCapitaScores(data.countries, null)
  }

  const history = loadHistoryStore()
  data.countries = data.countries.map((c) =>
    c.dataSource === 'proxy'
      ? { ...c, trend: { direction: 'yetersiz-veri', changePct: null, windowDays: null }, history: [] }
      : { ...c, trend: getTrend(history, c.iso2, c.score), history: (history[c.iso2] || []).slice(-20) }
  )
  maybeRecordSnapshot(history, data.countries.filter((c) => c.dataSource !== 'proxy'))
  maybeRecordSeriesSnapshot(raw.series)

  return { data, raw, destinationStore }
}
