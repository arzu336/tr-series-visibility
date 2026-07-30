const TMDB_BASE = 'https://api.themoviedb.org/3'
const TOP_N_SERIES = 200
const PAGE_SIZE = 20
// "Yayında" kabul edilen erişim türleri: abonelik (flatrate) ve ücretsiz (free).
// rent/buy hariç tutulur çünkü tek seferlik satın alma, yaygın kültürel erişimi göstermez.
// reklamlı (ads) da hariç tutulur — reklam destekli kataloglar ülkeden ülkeye çok
// tutarsız ve genelde ana abonelik kataloğunun küçük bir alt kümesidir.
export const STREAMABLE_KEYS = ['flatrate', 'free']
// 429 (rate limit) da retry edilebilir — TMDB, çok sayıda eşzamanlı istek altında bunu
// döndürebiliyor; bkz. mapWithConcurrency (200 dizilik toplu çekimlerde eşzamanlılığı
// sınırlayan asıl önlem, bu sadece ikinci savunma katmanı).
const RETRYABLE_STATUSES = [429, 502, 503, 504]
const RETRY_DELAYS_MS = [500, 1500]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 200 dizi için tek seferde 200 eşzamanlı istek atmak (özellikle watch-providers +
// credits birlikte 400'e çıkınca) TMDB'yi rate-limit'e (429) sokuyor ve isteklerin büyük
// kısmı sessizce boş dönüyor — gerçek veriyle doğruladım (ölçüm: 400 eşzamanlı istekte
// credits'in %94'ü 429/hata döndü). Bunun yerine sınırlı sayıda (CONCURRENCY) istek aynı
// anda uçuşur, biri bitince sıradaki başlar.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++
      results[current] = await fn(items[current], current)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
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

// TR/US/KR/ES gibi herhangi bir menşe ülkenin en popüler dizilerini çeker — Küresel
// Kıyaslama Modülü (server/benchmark.js) ve ana TR hattı (getRawSeriesData) aynı fonksiyonu
// paylaşır, davranış farkı sadece origin/dil parametreleri.
async function getTopSeriesByOrigin(originCountry, originalLanguage, n = TOP_N_SERIES) {
  const pagesNeeded = Math.ceil(n / PAGE_SIZE)
  const pages = await Promise.all(
    Array.from({ length: pagesNeeded }, (_, i) =>
      tmdbGet('/discover/tv', {
        with_origin_country: originCountry,
        with_original_language: originalLanguage,
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

export async function getWatchProviders(seriesId) {
  const data = await tmdbGet(`/tv/${seriesId}/watch/providers`)
  return data.results || {}
}

const CAST_LIMIT = 5

// Oyuncu & Karakter Bazlı Küresel Etki Modülü: her dizinin ilk 5 oyuncusunu (billing
// sırasına göre, TMDB'nin "order" alanı) çeker — Cast Bar, harita içi karakter pini ve
// server/cast.js'teki oyuncu-etki sorgusu bu veriyi paylaşır. getWatchProviders ile aynı
// payload disiplini: 200 dizi × sınırlı alan sayısı, tüm oyuncu kadrosu değil.
export async function getCredits(seriesId) {
  const data = await tmdbGet(`/tv/${seriesId}/credits`, { language: 'tr-TR' })
  const cast = (data.cast || []).sort((a, b) => a.order - b.order).slice(0, CAST_LIMIT)
  return cast.map((c) => ({
    id: c.id,
    name: c.name,
    character: c.character || '',
    profilePath: c.profile_path || null,
  }))
}

// TMDB'nin TV detay/discover uçları imdb_id vermiyor — ayrı bir uç (external_ids) gerekiyor.
// server/imdb.js bunu OMDb API'ye gitmeden önce dizinin gerçek IMDb kimliğini bulmak için kullanır.
export async function getExternalIds(seriesId) {
  const data = await tmdbGet(`/tv/${seriesId}/external_ids`)
  return { imdbId: data.imdb_id || null }
}

const FETCH_CONCURRENCY = 8

export async function getRawSeriesDataForOrigin(originCountry, originalLanguage, n = TOP_N_SERIES) {
  const series = await getTopSeriesByOrigin(originCountry, originalLanguage, n)

  const [providerResults, castResults] = await Promise.all([
    mapWithConcurrency(series, FETCH_CONCURRENCY, (s) => getWatchProviders(s.id).catch(() => ({}))),
    mapWithConcurrency(series, FETCH_CONCURRENCY, (s) => getCredits(s.id).catch(() => [])),
  ])

  const providersById = {}
  series.forEach((s, idx) => {
    providersById[s.id] = providerResults[idx]
    s.cast = castResults[idx]
  })

  return { series, providersById }
}

export async function getRawSeriesData() {
  return getRawSeriesDataForOrigin('TR', 'tr')
}
