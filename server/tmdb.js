const TMDB_BASE = 'https://api.themoviedb.org/3'
const TOP_N_SERIES = 20
// "Yayında" kabul edilen erişim türleri: abonelik (flatrate), reklamlı (ads) ve ücretsiz (free).
// rent/buy hariç tutulur çünkü tek seferlik satın alma, yaygın kültürel erişimi göstermez.
const STREAMABLE_KEYS = ['flatrate', 'ads', 'free']

async function tmdbGet(path, params = {}) {
  const apiKey = process.env.TMDB_API_KEY
  if (!apiKey) {
    throw new Error('TMDB_API_KEY tanımlı değil (.env dosyasını kontrol et)')
  }
  const url = new URL(TMDB_BASE + path)
  url.searchParams.set('api_key', apiKey)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`TMDB isteği başarısız: ${path} (${res.status})`)
  }
  return res.json()
}

async function getTopTurkishSeries(n = TOP_N_SERIES) {
  const data = await tmdbGet('/discover/tv', {
    with_origin_country: 'TR',
    sort_by: 'popularity.desc',
    language: 'tr-TR',
  })
  return (data.results || []).slice(0, n).map((show) => ({
    id: show.id,
    name: show.name,
    popularity: show.popularity,
    posterPath: show.poster_path,
  }))
}

async function getWatchProviders(seriesId) {
  const data = await tmdbGet(`/tv/${seriesId}/watch/providers`)
  return data.results || {}
}

export async function buildVisibilityData() {
  const series = await getTopTurkishSeries()

  const providerResults = await Promise.all(
    series.map((s) => getWatchProviders(s.id).catch(() => ({})))
  )

  const byCountry = new Map()

  series.forEach((show, idx) => {
    const countries = providerResults[idx]
    for (const [iso2, entry] of Object.entries(countries)) {
      const isStreamable = STREAMABLE_KEYS.some((key) => Array.isArray(entry[key]) && entry[key].length > 0)
      if (!isStreamable) continue

      if (!byCountry.has(iso2)) {
        byCountry.set(iso2, { iso2, score: 0, seriesCount: 0, topSeries: null, seriesList: [] })
      }
      const bucket = byCountry.get(iso2)
      bucket.score += show.popularity
      bucket.seriesCount += 1
      bucket.seriesList.push({ name: show.name, popularity: show.popularity })
      if (!bucket.topSeries || show.popularity > bucket.topSeries.popularity) {
        bucket.topSeries = { name: show.name, popularity: show.popularity }
      }
    }
  })

  const countries = Array.from(byCountry.values()).map((c) => ({
    ...c,
    seriesList: c.seriesList.sort((a, b) => b.popularity - a.popularity),
  }))

  return {
    updatedAt: new Date().toISOString(),
    seriesCount: series.length,
    countries,
  }
}
