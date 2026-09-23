import { STREAMABLE_KEYS } from './tmdb.js'
import { effectiveTheme, effectiveConfidence } from './themes.js'
import { DESTINATIONS, effectiveDestinations } from './destinations.js'
import { resolveIso2FromLabel } from './services/countryLookup.js'

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
        overview: show.overview || '',
        theme,
        destinations,
        cast: show.cast || [],
      })
      if (!bucket.topSeries || show.popularity > bucket.topSeries.popularity) {
        bucket.topSeries = {
          id: show.id,
          name: show.name,
          popularity: show.popularity,
          posterPath: show.posterPath || null,
          cast: show.cast || [],
        }
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
      dataSource: 'tmdb',
    }
  })

  return {
    updatedAt: new Date().toISOString(),
    seriesCount: series.length,
    countries,
  }
}

export function getGlobalThemeDistribution(rawData, themeStore) {
  const { series, providersById } = rawData
  const byTheme = new Map()

  for (const show of series) {
    const themeEntry = themeStore[String(show.id)]
    const theme = themeEntry ? effectiveTheme(themeEntry) : 'diğer'
    if (!byTheme.has(theme)) {
      byTheme.set(theme, { theme, seriesCount: 0, totalPopularity: 0, countriesReached: 0 })
    }
    const bucket = byTheme.get(theme)
    bucket.seriesCount += 1
    bucket.totalPopularity += show.popularity

    const providers = providersById[show.id] || {}
    const reach = Object.values(providers).filter((entry) =>
      STREAMABLE_KEYS.some((key) => Array.isArray(entry[key]) && entry[key].length > 0)
    ).length
    bucket.countriesReached += reach
  }

  return Array.from(byTheme.values())
    .map((b) => ({ ...b, totalPopularity: Math.round(b.totalPopularity * 10) / 10 }))
    .sort((a, b) => b.totalPopularity - a.totalPopularity)
}

export function mergeProxyFallback(countries, fallback) {
  if (!fallback?.byCountry?.length) return countries

  const existingIso2 = new Set(countries.map((c) => c.iso2))
  const proxyCountries = []

  for (const entry of fallback.byCountry) {
    const iso2 = resolveIso2FromLabel(entry.country)
    if (!iso2 || existingIso2.has(iso2)) continue
    existingIso2.add(iso2)
    proxyCountries.push({
      iso2,
      score: 0,
      seriesCount: 0,
      topSeries: null,
      seriesList: [],
      dominantTheme: null,
      themeConfidence: 0,
      isThemeUncertain: true,
      destinationSummary: [],
      dataSource: 'proxy',
      searchInterestScore: entry.value,
      proxyQueryTerm: fallback.queryTerm,
      proxyQueriedAt: fallback.queriedAt,
    })
  }

  return [...countries, ...proxyCountries]
}

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

const PER_CAPITA_UNIT = 1_000_000

export const MIN_PER_CAPITA_DENOMINATOR = 1_000_000

export const PER_CAPITA_BASIS = {
  INTERNET: 'internet-kullanicisi',
  POPULATION: 'nufus',
}

/**
 * Her ülkeye `scorePerCapita` (milyon kişi başına), `perCapitaBasis` ve `perCapitaYear` ekler.
 * Demografi verisi olmayan ülkede alan NULL kalır — tahmini bir nüfusla doldurulmaz.
 * `demographics` hiç verilmezse (dış servis düştüyse) tüm ülkeler null ile döner ve harita
 * ham skora geri düşer; sessizce yanlış bir sayı üretmekten iyidir.
 */
export function attachPerCapitaScores(countries, demographics) {
  return countries.map((c) => {
    const demo = demographics?.[c.iso2]
    if (!demo) {
      return { ...c, scorePerCapita: null, perCapitaBasis: null, perCapitaYear: null, perCapitaReliable: false }
    }

    const useInternet = demo.internetUsers != null && demo.internetUsers > 0
    const denominator = useInternet ? demo.internetUsers : demo.population
    if (!(denominator > 0)) {
      return { ...c, scorePerCapita: null, perCapitaBasis: null, perCapitaYear: null, perCapitaReliable: false }
    }

    return {
      ...c,
      scorePerCapita: Math.round((c.score / (denominator / PER_CAPITA_UNIT)) * 100) / 100,
      perCapitaBasis: useInternet ? PER_CAPITA_BASIS.INTERNET : PER_CAPITA_BASIS.POPULATION,
      perCapitaYear: useInternet ? demo.internetYear : demo.populationYear,
      perCapitaReliable: denominator >= MIN_PER_CAPITA_DENOMINATOR,
    }
  })
}
