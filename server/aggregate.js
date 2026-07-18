import { STREAMABLE_KEYS } from './tmdb.js'
import { effectiveTheme, effectiveConfidence } from './themes.js'

const UNCERTAIN_THRESHOLD = 70

export function buildVisibility(rawData, themeStore) {
  const { series, providersById } = rawData
  const byCountry = new Map()

  series.forEach((show) => {
    const themeEntry = themeStore[String(show.id)]
    const theme = themeEntry ? effectiveTheme(themeEntry) : 'diğer'
    const themeConfidence = themeEntry ? effectiveConfidence(themeEntry) : 0

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
    }
  })

  const countries = Array.from(byCountry.values()).map((c) => {
    const [dominantTheme] = Object.entries(c.themeScores).sort((a, b) => b[1] - a[1])[0]
    const themeConfidence = c._themeConfidenceByTheme[dominantTheme]
    return {
      iso2: c.iso2,
      score: c.score,
      seriesCount: c.seriesCount,
      topSeries: c.topSeries,
      seriesList: c.seriesList.sort((a, b) => b.popularity - a.popularity),
      dominantTheme,
      themeConfidence,
      isThemeUncertain: themeConfidence < UNCERTAIN_THRESHOLD,
    }
  })

  return {
    updatedAt: new Date().toISOString(),
    seriesCount: series.length,
    countries,
  }
}
