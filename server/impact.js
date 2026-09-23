import { suggestControlCountry } from './control-matching.js'
import { getMediaSentimentSummary, getMediaSentimentByCountry } from './services/newsSentiment.js'
import { getSocialEnrichmentSummary } from './services/socialEnricher.js'
import { getTourismLeadingSignalSummary } from './services/tourismTrendsCollector.js'
import { getPipelineDb } from './services/pipelineDb.js'
import { computeTourismCorrelation, PENDING_ANALYSIS } from './services/tourismCorrelation.js'
import { getCached, setCached } from './cache.js'

export { pearsonCorrelation, confidenceInterval95, differenceInDifferences } from './services/tourismCorrelation.js'

function round1(n) {
  return Math.round(n * 10) / 10
}

function topByScoreWithRemainder(countries, n) {
  const sorted = [...countries].sort((a, b) => b.score - a.score)
  const top = sorted.slice(0, n).map((c) => ({
    iso2: c.iso2,
    score: round1(c.score),
    seriesCount: c.seriesCount,
    dominantTheme: c.dominantTheme,
    trend: c.trend || null,
  }))
  const totalScore = sorted.reduce((sum, c) => sum + c.score, 0)
  const topScore = top.reduce((sum, c) => sum + c.score, 0)
  return { top, otherScore: round1(Math.max(0, totalScore - topScore)) }
}

function topDestinationsWithRemainder(destinationRanking, n) {
  const top = destinationRanking.slice(0, n)
  const totalScore = destinationRanking.reduce((sum, d) => sum + d.totalScore, 0)
  const topScore = top.reduce((sum, d) => sum + d.totalScore, 0)
  return { top, otherScore: round1(Math.max(0, totalScore - topScore)) }
}

function rising(countries, n) {
  return countries
    .filter((c) => c.trend?.direction === 'yükseliyor')
    .sort((a, b) => b.trend.changePct - a.trend.changePct)
    .slice(0, n)
    .map((c) => ({ iso2: c.iso2, changePct: c.trend.changePct, windowDays: c.trend.windowDays }))
}

async function withSuggestedControls(risingList, risingIso2Set) {
  return Promise.all(
    risingList.map(async (c) => {
      let suggestedControl = null
      try {
        suggestedControl = await suggestControlCountry(c.iso2, risingIso2Set)
      } catch (err) {
        console.error(`[impact] kontrol ülkesi önerisi alınamadı (${c.iso2}):`, err.message)
      }
      return { ...c, suggestedControl }
    })
  )
}

const RISING_CONTROLS_CACHE_KEY = 'impact:rising-with-controls'
const RISING_CONTROLS_TTL_MS = 15 * 60 * 1000

async function getRisingCountriesWithControls(countries, n = 5) {
  const cached = getCached(RISING_CONTROLS_CACHE_KEY)
  if (cached) return cached
  const risingList = rising(countries, n)
  const risingIso2Set = new Set(countries.filter((c) => c.trend?.direction === 'yükseliyor').map((c) => c.iso2))
  const result = await withSuggestedControls(risingList, risingIso2Set)
  setCached(RISING_CONTROLS_CACHE_KEY, result, RISING_CONTROLS_TTL_MS)
  return result
}

async function getTourismCorrelation(countries) {
  try {
    return await computeTourismCorrelation(countries)
  } catch (err) {
    console.error('[impact] turizm korelasyonu hesaplanamadı:', err.message)
    return null
  }
}

const CONCENTRATION_WARNING_THRESHOLD_PCT = 50

function buildConcentrationWarning(top, otherScore) {
  if (top.length === 0) return null
  const totalScore = top.reduce((sum, d) => sum + d.totalScore, 0) + otherScore
  if (totalScore === 0) return null
  const leader = top[0]
  const leaderSharePct = round1((leader.totalScore / totalScore) * 100)
  if (leaderSharePct < CONCENTRATION_WARNING_THRESHOLD_PCT) return null
  return {
    destinationId: leader.id,
    destinationName: leader.name,
    sharePct: leaderSharePct,
    note: `${leader.name}, destinasyon görünürlüğünün %${leaderSharePct}'ini tek başına taşıyor — bu, ${leader.name}'ın ${leader.seriesCount} dizide sahne olarak geçmesinden kaynaklanan doğal bir yoğunlaşma, uydurma bir ağırlıklandırma değil.`,
  }
}

function getNetflixCoveredIso2s() {
  const conn = getPipelineDb()
  if (!conn) return new Set()
  try {
    const rows = conn.prepare('SELECT DISTINCT country_iso2 FROM netflix_country_rankings').all()
    return new Set(rows.map((r) => r.country_iso2))
  } catch {
    return new Set()
  }
}

export function buildCulturalImpact() {
  return {
    generatedAt: new Date().toISOString(),
    mediaSentimentSummary: getMediaSentimentSummary(),
    mediaSentimentByCountry: getMediaSentimentByCountry(),
    socialEnrichmentSummary: getSocialEnrichmentSummary(),
  }
}

const TOURISM_IMPACT_CACHE_KEY = 'impact:tourism-tab'
const TOURISM_IMPACT_TTL_MS = 10 * 60 * 1000

export async function buildTourismImpact(countries, destinationRanking = []) {
  const cached = getCached(TOURISM_IMPACT_CACHE_KEY)
  if (cached) return cached

  const destinationBreakdown = topDestinationsWithRemainder(destinationRanking, 5)
  const tourismCorrelation = await getTourismCorrelation(countries)

  const result = {
    generatedAt: new Date().toISOString(),
    topDestinations: destinationBreakdown.top,
    otherDestinationsScore: destinationBreakdown.otherScore,
    concentrationWarning: buildConcentrationWarning(destinationBreakdown.top, destinationBreakdown.otherScore),
    pendingAnalysis: tourismCorrelation || PENDING_ANALYSIS,
    leadingSignal: getTourismLeadingSignalSummary(),
  }
  setCached(TOURISM_IMPACT_CACHE_KEY, result, TOURISM_IMPACT_TTL_MS)
  return result
}

export async function buildExportImpact(countries) {
  const countryBreakdown = topByScoreWithRemainder(countries, 5)
  const risingCountriesRaw = await getRisingCountriesWithControls(countries, 5)
  const netflixCovered = getNetflixCoveredIso2s()
  const risingCountries = risingCountriesRaw.map((c) => ({ ...c, hasOfficialPlatformData: netflixCovered.has(c.iso2) }))

  return {
    generatedAt: new Date().toISOString(),
    totalCountries: countries.length,
    topCountriesByVisibility: countryBreakdown.top,
    otherCountriesScore: countryBreakdown.otherScore,
    risingCountries,
  }
}

export async function buildImpactReport(countries, destinationRanking = []) {
  const hasEnoughHistoryForTrends = countries.some((c) => c.trend?.direction !== 'yetersiz-veri')
  const countryBreakdown = topByScoreWithRemainder(countries, 5)
  const destinationBreakdown = topDestinationsWithRemainder(destinationRanking, 5)

  const risingCountries = await getRisingCountriesWithControls(countries, 5)
  const tourismCorrelation = await getTourismCorrelation(countries)

  return {
    generatedAt: new Date().toISOString(),
    totalCountries: countries.length,
    risingCount: countries.filter((c) => c.trend?.direction === 'yükseliyor').length,
    fallingCount: countries.filter((c) => c.trend?.direction === 'düşüyor').length,
    topCountriesByVisibility: countryBreakdown.top,
    otherCountriesScore: countryBreakdown.otherScore,
    risingCountries,
    hasEnoughHistoryForTrends,
    topDestinations: destinationBreakdown.top,
    otherDestinationsScore: destinationBreakdown.otherScore,
    pendingAnalysis: tourismCorrelation || PENDING_ANALYSIS,
  }
}
