import { STREAMABLE_KEYS } from './tmdb.js'
import { effectiveTheme, effectiveConfidence } from './themes.js'
import { DESTINATIONS, effectiveDestinations } from './destinations.js'

const UNCERTAIN_THRESHOLD = 70
const DESTINATION_NAMES = Object.fromEntries(DESTINATIONS.map((d) => [d.id, d.name]))

export function buildVisibility(rawData, themeStore, destinationStore = {}) {
  const { series, providersById } = rawData
  const byCountry = new Map()

  series.forEach((show) => {
    const themeEntry = themeStore[String(show.id)]
    const theme = themeEntry ? effectiveTheme(themeEntry) : 'diğer'
    const themeConfidence = themeEntry ? effectiveConfidence(themeEntry) : 0

    const destinationEntry = destinationStore[String(show.id)]
    const destinations = destinationEntry ? effectiveDestinations(destinationEntry) : []

    const countries = providersById[show.id] || {}
    for (const [iso2, entry] of Object.entries(countries)) {
      const isStreamable = STREAMABLE_KEYS.some(
        (key) => Array.isArray(entry[key]) && entry[key].length > 0
      )
      if (!isStreamable) continue

      if (!byCountry.has(iso2)) {
        byCountry.set(iso2, {
          iso2,
          score: 0,
          seriesCount: 0,
          topSeries: null,
          seriesList: [],
          themeScores: {},
          destinationScores: {},
        })
      }
      const bucket = byCountry.get(iso2)
      bucket.score += show.popularity
      bucket.seriesCount += 1
      bucket.seriesList.push({
        id: show.id,
        name: show.name,
        popularity: show.popularity,
        posterPath: show.posterPath || null,
        firstAirDate: show.firstAirDate || null,
        theme,
        destinations,
      })
      if (!bucket.topSeries || show.popularity > bucket.topSeries.popularity) {
        bucket.topSeries = { name: show.name, popularity: show.popularity }
      }

      bucket.themeScores[theme] = (bucket.themeScores[theme] || 0) + show.popularity
      const prevBestConfidence = bucket._themeConfidenceByTheme?.[theme] ?? -1
      bucket._themeConfidenceByTheme = bucket._themeConfidenceByTheme || {}
      if (themeConfidence > prevBestConfidence) {
        bucket._themeConfidenceByTheme[theme] = themeConfidence
      }

      destinations.forEach((destId) => {
        if (!bucket.destinationScores[destId]) {
          bucket.destinationScores[destId] = { seriesCount: 0, score: 0 }
        }
        bucket.destinationScores[destId].seriesCount += 1
        bucket.destinationScores[destId].score += show.popularity
      })
    }
  })

  const countries = Array.from(byCountry.values()).map((c) => {
    const [dominantTheme] = Object.entries(c.themeScores).sort((a, b) => b[1] - a[1])[0]
    const themeConfidence = c._themeConfidenceByTheme[dominantTheme]
    const destinationSummary = Object.entries(c.destinationScores)
      .map(([id, stats]) => ({ id, name: DESTINATION_NAMES[id] || id, ...stats }))
      .sort((a, b) => b.score - a.score)
    return {
      iso2: c.iso2,
      score: c.score,
      seriesCount: c.seriesCount,
      topSeries: c.topSeries,
      seriesList: c.seriesList.sort((a, b) => b.popularity - a.popularity),
      dominantTheme,
      themeConfidence,
      isThemeUncertain: themeConfidence < UNCERTAIN_THRESHOLD,
      destinationSummary,
    }
  })

  return {
    updatedAt: new Date().toISOString(),
    seriesCount: series.length,
    countries,
  }
}

// Ülke agregasyonlarından bağımsız, global destinasyon sıralaması: hangi
// destinasyon toplamda kaç ülkede görünüyor, toplam skoru ne (countries'ten) ve
// kaç farklı dizide etiketli (series+destinationStore'dan — yayın erişiminden bağımsız gerçek sayı).
export function buildDestinationRanking(countries, series, destinationStore) {
  const byDestination = new Map()
  const ensure = (id) => {
    if (!byDestination.has(id)) {
      byDestination.set(id, {
        id,
        name: DESTINATION_NAMES[id] || id,
        seriesCount: 0,
        countryCount: 0,
        totalScore: 0,
      })
    }
    return byDestination.get(id)
  }

  series.forEach((show) => {
    const entry = destinationStore[String(show.id)]
    const destinations = entry ? effectiveDestinations(entry) : []
    destinations.forEach((destId) => {
      ensure(destId).seriesCount += 1
    })
  })

  countries.forEach((country) => {
    country.destinationSummary.forEach((d) => {
      const acc = ensure(d.id)
      acc.countryCount += 1
      acc.totalScore += d.score
    })
  })

  return Array.from(byDestination.values())
    .filter((d) => d.seriesCount > 0)
    .sort((a, b) => b.totalScore - a.totalScore)
}
