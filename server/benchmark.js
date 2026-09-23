import { getRawSeriesDataForOrigin, STREAMABLE_KEYS } from './tmdb.js'
import { getCached, setCached } from './cache.js'
import { loadBenchmarkHistoryStore, getBenchmarkTrend, maybeRecordBenchmarkSnapshot } from './benchmark-history.js'

const RAW_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const SERIES_PER_COUNTRY = 50

export const BENCHMARK_COUNTRIES = [
  { code: 'TR', name: 'Türkiye', originalLanguage: 'tr' },
  { code: 'US', name: 'ABD (Hollywood)', originalLanguage: 'en' },
  { code: 'KR', name: 'Güney Kore (K-Drama)', originalLanguage: 'ko' },
  { code: 'ES', name: 'İspanya', originalLanguage: 'es' },
]

function round1(n) {
  return Math.round(n * 10) / 10
}

async function getCountryRaw(country) {
  const key = `benchmark-raw-${country.code}`
  const cached = getCached(key)
  if (cached) return cached
  const data = await getRawSeriesDataForOrigin(country.code, country.originalLanguage, SERIES_PER_COUNTRY)
  setCached(key, data, RAW_CACHE_TTL_MS)
  return data
}

function computeCountryMetrics(country, raw) {
  const { series, providersById } = raw
  let totalScore = 0
  const exportCountries = new Set()

  series.forEach((show) => {
    totalScore += show.popularity
    const providers = providersById[show.id] || {}
    for (const [iso2, entry] of Object.entries(providers)) {
      const isStreamable = STREAMABLE_KEYS.some((key) => Array.isArray(entry[key]) && entry[key].length > 0)
      if (isStreamable) exportCountries.add(iso2)
    }
  })

  return {
    code: country.code,
    name: country.name,
    seriesCount: series.length,
    totalScore: round1(totalScore),
    exportCountryCount: exportCountries.size,
  }
}

export async function buildBenchmark() {
  const rawByCountry = await Promise.all(BENCHMARK_COUNTRIES.map(getCountryRaw))
  const metrics = BENCHMARK_COUNTRIES.map((country, idx) => computeCountryMetrics(country, rawByCountry[idx]))

  const grandTotal = metrics.reduce((sum, m) => sum + m.totalScore, 0)
  const history = loadBenchmarkHistoryStore()
  const countries = metrics.map((m) => ({
    ...m,
    marketSharePct: grandTotal > 0 ? round1((m.totalScore / grandTotal) * 100) : 0,
    trend: getBenchmarkTrend(history, m.code, m.totalScore),
  }))
  maybeRecordBenchmarkSnapshot(
    history,
    metrics.map((m) => ({ code: m.code, totalScore: m.totalScore }))
  )

  return {
    generatedAt: new Date().toISOString(),
    countries,
    methodology: 'Popülerlik verisine dayalı proxy gösterge.',
  }
}
