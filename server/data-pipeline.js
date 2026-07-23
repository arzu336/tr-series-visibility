import { getRawSeriesData } from './tmdb.js'
import { getCached, setCached } from './cache.js'
import { ensureClassified } from './themes.js'
import { ensureDetected } from './destinations.js'
import { buildVisibility } from './aggregate.js'
import { getTrend, maybeRecordSnapshot, loadHistoryStore } from './history.js'

const RAW_CACHE_KEY = 'raw-series-providers'
const RAW_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 saat

// index.js'teki route'lar ve scheduler.js'teki zamanlanmış tazeleme aynı
// hattı paylaşır — burada tek yerde tanımlı, ikisi de import eder.
export async function getRawSeriesDataCached() {
  const cached = getCached(RAW_CACHE_KEY)
  if (cached) return cached
  const data = await getRawSeriesData()
  setCached(RAW_CACHE_KEY, data, RAW_CACHE_TTL_MS)
  return data
}

// /api/visibility ve /api/impact aynı gerçek, canlı veriyi paylaşır — tema/destinasyon
// sınıflandırması ve trend/history zenginleştirmesi burada bir kez yapılır.
export async function getEnrichedVisibility() {
  const raw = await getRawSeriesDataCached()
  const themeStore = await ensureClassified(raw.series)
  const destinationStore = ensureDetected(raw.series)
  const data = buildVisibility(raw, themeStore, destinationStore)

  const history = loadHistoryStore()
  data.countries = data.countries.map((c) => ({
    ...c,
    trend: getTrend(history, c.iso2, c.score),
    history: (history[c.iso2] || []).slice(-20),
  }))
  maybeRecordSnapshot(history, data.countries)

  return { data, raw, destinationStore }
}
