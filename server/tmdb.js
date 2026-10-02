import { mapWithConcurrency } from './utils/concurrency.js'

const EXTERNAL_TIMEOUT_MS = 15000

const TMDB_BASE = 'https://api.themoviedb.org/3'
const TOP_N_SERIES = 400
const PAGE_SIZE = 20
export const STREAMABLE_KEYS = ['flatrate', 'free']
const RETRYABLE_STATUSES = [429, 502, 503, 504]
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
    const res = await fetch(url, { signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS) })
    if (res.ok) return res.json()

    lastError = new Error(`Veri isteği başarısız: ${path} (${res.status})`)
    const canRetry = RETRYABLE_STATUSES.includes(res.status) && attempt < RETRY_DELAYS_MS.length
    if (!canRetry) throw lastError
    await sleep(RETRY_DELAYS_MS[attempt])
  }
  throw lastError
}

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
  const results = pages
    .flatMap((p) => p.results || [])
    .filter((show) => {
      if (seen.has(show.id)) return false
      seen.add(show.id)
      return true
    })
  return results.slice(0, n).map((show) => ({
    id: show.id,
    name: show.original_name || show.name,
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

// Kadro kaynağı: /aggregate_credits (TÜM sezonlar, oyuncu başına bölüm sayısıyla). /credits yalnızca son
// sezonu veriyordu — uzun süren dizilerde ana kadro eksik kalıyordu (ör. Kuruluş Osman'da 194 bölümlük
// Yiğit Uçan yoktu). Sıra: bölüm sayısı çok olan önce; eşitlikte TMDB sırası (başroller önde).
export const CAST_SOURCE = 'aggregate'
export const FULL_CAST_MAX = 60
const MAIN_CAST_SHARE = 0.15 // dizinin bölümlerinin en az %15'inde oynayan = ana kadro
const MAIN_CAST_MIN = 8

export function rankCast(cast = []) {
  return [...cast].sort(
    (a, b) => (b.total_episode_count || 0) - (a.total_episode_count || 0) || (a.order ?? 999) - (b.order ?? 999)
  )
}

export function toCastMember(c) {
  const role = [...(c.roles || [])].sort((a, b) => (b.episode_count || 0) - (a.episode_count || 0))[0]
  return {
    id: c.id,
    name: c.name,
    character: role?.character || c.character || '',
    profilePath: c.profile_path || null,
    episodes: c.total_episode_count ?? null,
  }
}

/** Ana kadro: en az %15 bölümde oynayanlar (en az 8 kişi, en fazla FULL_CAST_MAX), sıralı. */
export function mainCast(cast = []) {
  const ranked = rankCast(cast)
  const max = ranked[0]?.total_episode_count || 0
  const threshold = Math.max(2, Math.round(max * MAIN_CAST_SHARE))
  const regulars = ranked.filter((c) => (c.total_episode_count || 0) >= threshold)
  const list = regulars.length >= MAIN_CAST_MIN ? regulars : ranked.slice(0, MAIN_CAST_MIN)
  return list.slice(0, FULL_CAST_MAX).map(toCastMember)
}

/** Katalog kaydındaki kısa kadro (harita yükünde ülke başına kopyalandığı için CAST_LIMIT kişi). */
export async function getCredits(seriesId) {
  const data = await tmdbGet(`/tv/${seriesId}/aggregate_credits`, { language: 'tr-TR' })
  return rankCast(data.cast || [])
    .slice(0, CAST_LIMIT)
    .map(toCastMember)
}

/** Dizi sayfası için ana kadronun tamamı. */
export async function getFullCast(seriesId) {
  const data = await tmdbGet(`/tv/${seriesId}/aggregate_credits`, { language: 'tr-TR' })
  return { cast: mainCast(data.cast || []), total: (data.cast || []).length }
}

export async function getExternalIds(seriesId) {
  const data = await tmdbGet(`/tv/${seriesId}/external_ids`)
  return { imdbId: data.imdb_id || null, wikidataId: data.wikidata_id || null }
}

const FETCH_CONCURRENCY = 8

const NETFLIX_NETWORK_ID = 213
const NETFLIX_DISCOVERY_PAGES = 3

/**
 * Netflix ağında yayımlanan Türk yapımları (with_networks=213 + origin TR). Popülerlik sıralı
 * ilk N listesinin dışında kalan Netflix orijinalleri (Kübra, Yakamoz S-245, Asaf…) Netflix Top 10
 * eşleştirmesinde en çok hafta toplayan başlıklardı; keşif sorgusu onları kataloğa katar.
 */
async function getNetflixSeriesByOrigin(originCountry, pages = NETFLIX_DISCOVERY_PAGES) {
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      tmdbGet('/discover/tv', {
        with_networks: String(NETFLIX_NETWORK_ID),
        with_origin_country: originCountry,
        sort_by: 'popularity.desc',
        language: 'tr-TR',
        page: i + 1,
      }).catch(() => ({ results: [] }))
    )
  )
  return results
    .flatMap((p) => p.results || [])
    .map((show) => ({
      id: show.id,
      name: show.original_name || show.name,
      popularity: show.popularity,
      posterPath: show.poster_path,
      firstAirDate: show.first_air_date || null,
      overview: show.overview || '',
      netflixOriginal: true,
    }))
}

/** İki keşif listesini id'ye göre birleştirir; ilk listenin sırası korunur, yeni Netflix yapımları sona eklenir. */
export function mergeSeriesLists(primary, extra) {
  const seen = new Set(primary.map((s) => s.id))
  const out = [...primary]
  for (const s of extra) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    out.push(s)
  }
  return out
}

/** Tek dizinin katalog kaydı (keşif sonuçlarıyla aynı biçim) — katalog tamamlama için. */
export async function getSeriesDetails(seriesId) {
  const show = await tmdbGet(`/tv/${seriesId}`, { language: 'tr-TR' })
  return {
    id: show.id,
    name: show.original_name || show.name,
    popularity: show.popularity,
    posterPath: show.poster_path,
    firstAirDate: show.first_air_date || null,
    overview: show.overview || '',
    catalogSupplement: true,
  }
}

/**
 * Katalog: popülerliğe göre ilk N + Netflix Türk yapımları + `supplementIds` (listelere girmiş ama ilk N'in
 * dışında kalan diziler; bkz. data-pipeline-python/catalog_supplement.py). Ek dizi TMDB'de bulunamazsa atlanır.
 */
export async function getRawSeriesDataForOrigin(
  originCountry,
  originalLanguage,
  n = TOP_N_SERIES,
  { supplementIds = [] } = {}
) {
  const [top, netflix] = await Promise.all([
    getTopSeriesByOrigin(originCountry, originalLanguage, n),
    originCountry === 'TR' ? getNetflixSeriesByOrigin(originCountry) : Promise.resolve([]),
  ])
  const discovered = mergeSeriesLists(top, netflix)
  const have = new Set(discovered.map((s) => s.id))
  const missing = supplementIds.filter((id) => !have.has(id))
  const extra = (
    await mapWithConcurrency(missing, FETCH_CONCURRENCY, (id) => getSeriesDetails(id).catch(() => null))
  ).filter(Boolean)
  const series = mergeSeriesLists(discovered, extra)

  const [providerResults, castResults] = await Promise.all([
    mapWithConcurrency(series, FETCH_CONCURRENCY, (s) => getWatchProviders(s.id).catch(() => ({}))),
    mapWithConcurrency(series, FETCH_CONCURRENCY, (s) => getCredits(s.id).catch(() => [])),
  ])

  const providersById = {}
  series.forEach((s, idx) => {
    providersById[s.id] = providerResults[idx]
    s.cast = castResults[idx]
  })

  return { series, providersById, supplementIds: [...supplementIds].sort((a, b) => a - b), castSource: CAST_SOURCE }
}

export async function getRawSeriesData({ supplementIds = [] } = {}) {
  return getRawSeriesDataForOrigin('TR', 'tr', TOP_N_SERIES, { supplementIds })
}
