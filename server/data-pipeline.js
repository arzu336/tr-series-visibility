import { getRawSeriesData } from './tmdb.js'
import { getCached, setCached } from './cache.js'
import { ensureClassified, getThemeStore } from './themes.js'
import { ensureDetected, getDestinationStore } from './destinations.js'
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

// LLM sınıflandırması (400 dizi × tema + destinasyon) ilk açılışta dakikalar sürebilir; LLM
// kapalıysa her dizi zaman aşımına düşer ve /api/visibility hiç yanıt vermezdi. Kullanıcı
// istekleri artık beklemez: sınıflandırma arka planda TEK bir iş olarak başlar (eş zamanlı
// istekler aynı işe bağlanır), harita o an elde olan etiketlerle döner — eksik olanlar
// buildVisibility'de zaten 'diğer' / güven 0 ile işlenir ve bir sonraki istekte güncel gelir.
// Zamanlanmış günlük tazeleme ise tamamlanmasını bekler (waitForClassification: true).
let enrichmentInFlight = null

function kickOffEnrichment(series) {
  if (enrichmentInFlight) return enrichmentInFlight
  enrichmentInFlight = (async () => {
    await ensureClassified(series)
    await ensureDetected(series)
  })()
    .catch((err) => {
      console.error('[visibility] arka plan sınıflandırma turu başarısız:', err.message)
    })
    .finally(() => {
      enrichmentInFlight = null
    })
  return enrichmentInFlight
}

export async function getEnrichedVisibility({ waitForClassification = false } = {}) {
  const raw = await getRawSeriesDataCached()
  const enrichment = kickOffEnrichment(raw.series)
  if (waitForClassification) await enrichment
  const data = buildVisibility(raw, getThemeStore(), getDestinationStore())
  const destinationStore = getDestinationStore()

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
