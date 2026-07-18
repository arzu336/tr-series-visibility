const TMDB_BASE = 'https://api.themoviedb.org/3'
const TOP_N_SERIES = 60
const PAGE_SIZE = 20
// "Yayında" kabul edilen erişim türleri: abonelik (flatrate), reklamlı (ads) ve ücretsiz (free).
// rent/buy hariç tutulur çünkü tek seferlik satın alma, yaygın kültürel erişimi göstermez.
export const STREAMABLE_KEYS = ['flatrate', 'ads', 'free']
const RETRYABLE_STATUSES = [502, 503, 504]
const RETRY_DELAYS_MS = [500, 1500]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

  let lastError
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(url)
    if (res.ok) return res.json()

    lastError = new Error(`TMDB isteği başarısız: ${path} (${res.status})`)
    const canRetry = RETRYABLE_STATUSES.includes(res.status) && attempt < RETRY_DELAYS_MS.length
    if (!canRetry) throw lastError
    await sleep(RETRY_DELAYS_MS[attempt])
  }
  throw lastError
}

async function getTopTurkishSeries(n = TOP_N_SERIES) {
  const pagesNeeded = Math.ceil(n / PAGE_SIZE)
  const pages = await Promise.all(
    Array.from({ length: pagesNeeded }, (_, i) =>
      tmdbGet('/discover/tv', {
        with_origin_country: 'TR',
        sort_by: 'popularity.desc',
        language: 'tr-TR',
        page: i + 1,
      })
    )
  )
  const seen = new Set()
  const results = pages.flatMap((p) => p.results || []).filter((show) => {
    // Sayfalar paralel çekildiği için popülerlik sıralaması sayfa sınırında kayabilir
    // ve aynı dizi iki sayfada birden görünebilir — id bazlı dedup gerekiyor.
    if (seen.has(show.id)) return false
    seen.add(show.id)
    return true
  })
  return results.slice(0, n).map((show) => ({
    id: show.id,
    name: show.name,
    popularity: show.popularity,
    posterPath: show.poster_path,
    firstAirDate: show.first_air_date || null,
    overview: show.overview || '',
  }))
}

async function getWatchProviders(seriesId) {
  const data = await tmdbGet(`/tv/${seriesId}/watch/providers`)
  return data.results || {}
}

export async function getRawSeriesData() {
  const series = await getTopTurkishSeries()

  const providersById = {}
  const providerResults = await Promise.all(
    series.map((s) => getWatchProviders(s.id).catch(() => ({})))
  )
  series.forEach((s, idx) => {
    providersById[s.id] = providerResults[idx]
  })

  return { series, providersById }
}
