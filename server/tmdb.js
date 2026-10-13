import { mapWithConcurrency } from './utils/concurrency.js'
import { getCached, setCached } from './cache.js'
import { wikidataTrtSeries } from './services/wikidataLabels.js'

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
    backdropPath: show.backdrop_path || null,
    firstAirDate: show.first_air_date || null,
    overview: show.overview || '',
  }))
}

/** Sezonların yayın başlangıç tarihleri: [{ seasonNumber, airDate, episodeCount }]. */
export async function getSeasonDates(seriesId) {
  const show = await tmdbGet(`/tv/${seriesId}`, { language: 'tr-TR' })
  return (show.seasons || []).map((s) => ({
    seasonNumber: s.season_number,
    airDate: s.air_date || null,
    episodeCount: s.episode_count ?? null,
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
// TRT 1 yapımları (2026-10-09): TRT dizileri Netflix/FlixPatrol listelerinde az görünüyor ve popülerlik sıralı ilk N
// listesinin dışında kalıyordu (Barbaros, Yunus Emre…). TMDB'de TRT 1 ağındaki bütün Türk yapımları kataloğa katılır
// (kurgusal olmayanlar CATALOG_FILTER ile yine elenir) ve `broadcaster: 'TRT 1'` ile işaretlenir.
export const TRT1_NETWORK_ID = 869
// tabii'nin kendi yapımları (Gassal, Çırak…) TMDB'de ayrı ağ olarak kayıtlı.
export const TABII_NETWORK_ID = 6854
const TRT_DISCOVERY_PAGES = 15

async function getTrtSeriesByOrigin(
  originCountry,
  pages = TRT_DISCOVERY_PAGES,
  networkId = TRT1_NETWORK_ID,
  label = 'TRT 1'
) {
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      tmdbGet('/discover/tv', {
        with_networks: String(networkId),
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
      backdropPath: show.backdrop_path || null,
      firstAirDate: show.first_air_date || null,
      overview: show.overview || '',
      broadcaster: label,
    }))
}

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
      backdropPath: show.backdrop_path || null,
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
    backdropPath: show.backdrop_path || null,
    firstAirDate: show.first_air_date || null,
    overview: show.overview || '',
    catalogSupplement: true,
  }
}

// Katalog yalnızca DİZİLERİ içerir: talk-show, haber, yarışma/realite ve skeç şovları (Konuşanlar, MasterChef,
// Aşkın Gücü, Güldür Güldür Show…) TMDB'nin Türk yapımı sorgusundan gelse de çıkarılır (kullanıcı kararı,
// 2026-10-05). TMDB tipi bazen yanlış ("Yalnız Kurt" Reality görünür ama türü Drama); türünde Drama olan
// yapım her zaman kalır. Sürüm değişince önbellekteki katalog yeniden kurulur (data-pipeline.js).
export const CATALOG_FILTER = 'scripted-v3-trt-tabii'
const GENRE = { DRAMA: 18, NEWS: 10763, REALITY: 10764, TALK: 10767 }
const NON_SCRIPTED_TYPES = new Set(['Reality', 'Talk Show', 'News'])
const SERIES_KIND_TTL_MS = 90 * 24 * 60 * 60 * 1000

export function isScriptedSeries({ genreIds = [], type = null } = {}) {
  const g = new Set(genreIds)
  if (g.has(GENRE.DRAMA)) return true
  if (g.has(GENRE.TALK) || g.has(GENRE.NEWS) || g.has(GENRE.REALITY)) return false
  return !NON_SCRIPTED_TYPES.has(type)
}

/** Dizinin TMDB tipi ve türleri (yavaş değişir, 90 gün önbellek). Alınamazsa null → dizi sayılır. */
async function getSeriesKind(seriesId) {
  const key = `tmdb-series-kind:v2:${seriesId}`
  const cached = getCached(key)
  if (cached) return cached
  const show = await tmdbGet(`/tv/${seriesId}`)
  const kind = {
    type: show.type || null,
    genreIds: (show.genres || []).map((g) => g.id),
    networks: (show.networks || []).map((n) => n.name),
    companies: (show.production_companies || []).map((c) => c.name),
  }
  setCached(key, kind, SERIES_KIND_TTL_MS)
  return kind
}

const TRT_NETWORK = /^(TRT\b|tabii$)/i
const TRT_COMPANY = /^TRT\b|Türkiye Radyo/i

/**
 * Asıl yayıncısı TRT olan dizi (2026-10-13, kullanıcı: "TRT dizilerini doğru verilerle vermek istiyorum"). TMDB'nin
 * TRT 1 ağı keşfi, TRT'de tekrar yayınlanan başka kanal dizilerini de getiriyordu (Adını Sen Koy — Star TV,
 * Zengin Kız Fakir Oğlan — FOX). Kural: dizi yalnızca TRT/tabii ağlarında yayınlandıysa ya da başka kanallarda da
 * yayınlandıysa yapımcısı TRT ise TRT dizisidir. Dönen: 'tabii' | 'TRT 1' | null.
 */
export function trtBroadcaster({ networks = [], companies = [] } = {}, { wikidataTrt = false } = {}) {
  if (!networks.length) return null
  const trtNets = networks.filter((n) => TRT_NETWORK.test(n))
  if (!trtNets.length) return null
  const onlyTrt = trtNets.length === networks.length
  // Wikidata ilk yayıncıyı TRT gösteriyor ve TMDB'de ilk ağ TRT ise (Leyla ile Mecnun: TRT 1, sonra Exxen) iki
  // kaynak örtüşüyor; çelişen ya da tek kaynağa dayanan durumlar işaretlenmez.
  const agreed = wikidataTrt && TRT_NETWORK.test(networks[0])
  if (!onlyTrt && !agreed && !companies.some((c) => TRT_COMPANY.test(c))) return null
  return trtNets.every((n) => /^tabii$/i.test(n)) ? 'tabii' : 'TRT 1'
}

/**
 * Katalog: popülerliğe göre ilk N + Netflix Türk yapımları + `supplementIds` (listelere girmiş ama ilk N'in
 * dışında kalan diziler; bkz. data-pipeline-python/catalog_supplement.py). Ek dizi TMDB'de bulunamazsa atlanır.
 */
export async function getRawSeriesDataForOrigin(
  originCountry,
  originalLanguage,
  n = TOP_N_SERIES,
  { supplementIds = [], wikidataTrt = new Set() } = {}
) {
  const [top, netflix, trt, tabii] = await Promise.all([
    getTopSeriesByOrigin(originCountry, originalLanguage, n),
    originCountry === 'TR' ? getNetflixSeriesByOrigin(originCountry) : Promise.resolve([]),
    originCountry === 'TR' ? getTrtSeriesByOrigin(originCountry) : Promise.resolve([]),
    originCountry === 'TR' ? getTrtSeriesByOrigin(originCountry, 3, TABII_NETWORK_ID, 'tabii') : Promise.resolve([]),
  ])
  // İlk N listesinde zaten olan TRT/tabii yapımları da işaretlenir.
  const yayinci = new Map([...tabii, ...trt].map((s) => [s.id, s.broadcaster]))
  for (const s of [...top, ...netflix]) if (yayinci.has(s.id)) s.broadcaster = yayinci.get(s.id)
  const discovered = mergeSeriesLists(mergeSeriesLists(mergeSeriesLists(top, netflix), trt), tabii)
  const have = new Set(discovered.map((s) => s.id))
  const missing = supplementIds.filter((id) => !have.has(id))
  const extra = (
    await mapWithConcurrency(missing, FETCH_CONCURRENCY, (id) => getSeriesDetails(id).catch(() => null))
  ).filter(Boolean)
  const candidates = mergeSeriesLists(discovered, extra)
  const kinds = await mapWithConcurrency(candidates, FETCH_CONCURRENCY, (s) => getSeriesKind(s.id).catch(() => null))
  // TRT işareti TMDB ağ/yapımcı bilgisinden yeniden belirlenir (keşifteki işaret tekrar yayınları da kapsıyordu).
  candidates.forEach((s, i) => {
    if (!kinds[i]?.networks) return
    const b = trtBroadcaster(kinds[i], { wikidataTrt: wikidataTrt.has(s.id) })
    if (b) s.broadcaster = b
    else delete s.broadcaster
  })
  const series = candidates.filter((s, i) => !kinds[i] || isScriptedSeries(kinds[i]))
  const excludedNonScripted = candidates.filter((s, i) => kinds[i] && !isScriptedSeries(kinds[i])).map((s) => s.id)

  const [providerResults, castResults] = await Promise.all([
    mapWithConcurrency(series, FETCH_CONCURRENCY, (s) => getWatchProviders(s.id).catch(() => ({}))),
    mapWithConcurrency(series, FETCH_CONCURRENCY, (s) => getCredits(s.id).catch(() => [])),
  ])

  const providersById = {}
  series.forEach((s, idx) => {
    providersById[s.id] = providerResults[idx]
    s.cast = castResults[idx]
  })

  return {
    series,
    providersById,
    supplementIds: [...supplementIds].sort((a, b) => a - b),
    castSource: CAST_SOURCE,
    catalogFilter: CATALOG_FILTER,
    excludedNonScripted,
  }
}

export async function getRawSeriesData({ supplementIds = [] } = {}) {
  return getRawSeriesDataForOrigin('TR', 'tr', TOP_N_SERIES, { supplementIds, wikidataTrt: wikidataTrtSeries() })
}
