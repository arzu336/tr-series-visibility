import db from '../db.js'
import { resolveIso2FromLabel } from './countryLookup.js'

// Proje raporu §4.6 "Cache & Performans" — SerpAPI (Trends/Social) için TEK, disiplinli bir
// TTL katmanı. server/serpapi.js, server/regional-interest.js ve server/social-listening.js
// eskiden kendi SÜRESİZ (TTL'siz) tablolarına yazıyordu (trends_cache, regional_interest_cache,
// social_listening_cache — hâlâ db.js'te tanımlı ama artık yazılmıyor/okunmuyor, bkz. oradaki
// not) — "her dizi sadece ilk sorguda kota harcar" güvenliydi ama veri asla tazelenmiyordu.
// Burada onun yerine server/cache.js'in zaten kullandığı genel amaçlı, TTL'li cache_entries
// tablosu paylaşılıyor: aynı "süresi dolmuş mu" mantığı, tek yerde.
export const TRENDS_TTL_MS = 15 * 24 * 60 * 60 * 1000 // Google Trends ilgi verisi ~15 günde bir anlamlı değişir
export const SOCIAL_TTL_MS = 30 * 24 * 60 * 60 * 1000 // Bilgi Grafiği/YouTube fragman verisi daha yavaş değişir

function normalizeSeriesKey(seriesName) {
  return seriesName.trim().toLocaleLowerCase('tr')
}

export function trendsCacheKey(seriesName) {
  return `serp:trends:${normalizeSeriesKey(seriesName)}`
}
export function regionalCacheKey(seriesName, iso2) {
  return `serp:regional:${normalizeSeriesKey(seriesName)}::${iso2.toUpperCase()}`
}
export function socialCacheKey(seriesName) {
  return `serp:social:${normalizeSeriesKey(seriesName)}`
}

const getRawStmt = db.prepare('SELECT value, expires_at, updated_at FROM cache_entries WHERE key = ?')
const upsertStmt = db.prepare(`
  INSERT INTO cache_entries (key, value, expires_at, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at, updated_at = excluded.updated_at
`)

// server/cache.js'teki getCached() süresi dolmuş kaydı YOK SAYAR (null döner) — burada bilerek
// ham satırı okuyoruz: SerpAPI hata verdiğinde (429/ağ) süresi dolmuş bile olsa eski veriyi
// "stale: true" ile dönebilmek için satırın kendisine ihtiyaç var.
function readRaw(key) {
  const row = getRawStmt.get(key)
  if (!row) return null
  return {
    value: JSON.parse(row.value),
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    isFresh: Date.now() <= row.expires_at,
  }
}

function writeRaw(key, value, ttlMs, now = Date.now()) {
  upsertStmt.run(key, JSON.stringify(value), now + ttlMs, now)
}

/**
 * Cache-First Stratejisi:
 * 1. Taze (expires_at geçmemiş) kayıt varsa SerpAPI'ye hiç gitmeden onu döner.
 * 2. Yoksa/süresi dolmuşsa fetchFn() çağrılır; başarılıysa yeni TTL ile yazılır.
 * 3. fetchFn() başarısız olursa (429 kota, ağ hatası, timeout) — süresi dolmuş bile olsa bir
 *    kayıt varsa çökmeden onu `stale:true` ile döner. Hiç kayıt yoksa hatayı olduğu gibi
 *    yukarı fırlatır (çağıran route'un mevcut try/catch → 502 davranışı korunur).
 */
export async function cacheFirstSerpApi(key, ttlMs, fetchFn) {
  const cached = readRaw(key)
  if (cached && cached.isFresh) {
    return { ...cached.value, fromCache: true, stale: false }
  }

  try {
    const fresh = await fetchFn()
    writeRaw(key, fresh, ttlMs)
    return { ...fresh, fromCache: false, stale: false }
  } catch (err) {
    if (cached) {
      console.error(
        `[serpApiCache] "${key}" için canlı istek başarısız (${err.message}) — süresi dolmuş önbellek stale:true ile kullanılıyor.`
      )
      return { ...cached.value, fromCache: true, stale: true, staleReason: err.message }
    }
    throw err
  }
}

export function getCacheEntryMeta(key) {
  const cached = readRaw(key)
  if (!cached) return null
  return { updatedAt: cached.updatedAt, expiresAt: cached.expiresAt, isFresh: cached.isFresh }
}

// --- SerpAPI düşük seviye istek yardımcıları -----------------------------------------------
// server/serpapi.js, server/regional-interest.js, server/social-listening.js ve
// server/services/trendsShareOfSearch.js'in tekrarladığı 429/hata işleme mantığı burada TEK yerde.
export async function serpapiGet(params) {
  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) {
    throw new Error('SERPAPI_API_KEY tanımlı değil (.env dosyasını kontrol et)')
  }
  const url = new URL('https://serpapi.com/search.json')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('api_key', apiKey)

  const res = await fetch(url)
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('SerpAPI aylık kota dolmuş görünüyor (429).')
    }
    throw new Error(`SerpAPI isteği başarısız (${res.status})`)
  }
  const data = await res.json()
  if (data.error) {
    throw new Error(`SerpAPI hatası: ${data.error}`)
  }
  return data
}

// Ham (cache'siz) Google Trends çağrısı — queryTrends (serpapi.js) VE calculateRegionalScore
// AYNI cache anahtarını (trendsCacheKey) kullandığı için tek bir SerpAPI isteği ikisine de
// hizmet eder, kota iki kat harcanmaz.
export async function fetchTrendsByCountryRaw(seriesName) {
  const data = await serpapiGet({
    engine: 'google_trends',
    q: seriesName,
    data_type: 'GEO_MAP_0',
    hl: 'tr',
  })
  const byCountry = (data.interest_by_region || [])
    .map((r) => ({ country: r.location || r.geo, value: r.extracted_value ?? r.value }))
    .filter((r) => r.country != null && r.value != null)
    .sort((a, b) => b.value - a.value)

  return { seriesName, queriedAt: new Date().toISOString(), byCountry }
}

export async function fetchRegionalInterestRaw(seriesName, iso2) {
  const data = await serpapiGet({
    engine: 'google_trends',
    q: seriesName,
    data_type: 'GEO_MAP_0',
    geo: iso2.toUpperCase(),
    hl: 'tr',
  })
  const byRegion = (data.interest_by_region || [])
    .map((r) => ({ region: r.location || r.geo, value: r.extracted_value ?? r.value }))
    .filter((r) => r.region != null && typeof r.value === 'number')
    .sort((a, b) => b.value - a.value)

  return { queriedAt: new Date().toISOString(), byRegion }
}

async function fetchKnowledgeGraphRaw(seriesName) {
  const data = await serpapiGet({ engine: 'google', q: `${seriesName} dizi`, hl: 'tr', gl: 'tr' })
  const kg = data.knowledge_graph
  if (!kg || !kg.ratings || kg.ratings.length === 0) return null
  return {
    title: kg.title || seriesName,
    ratings: kg.ratings.map((r) => ({ source: r.source, rating: r.rating, link: r.link || null })),
  }
}

async function fetchYouTubeRaw(seriesName) {
  const data = await serpapiGet({ engine: 'youtube', search_query: `${seriesName} fragman` })
  const top = (data.video_results || [])[0]
  if (!top) return null
  return {
    title: top.title,
    channel: top.channel?.name || null,
    channelVerified: Boolean(top.channel?.verified),
    views: top.views ?? null,
    publishedDate: top.published_date || null,
    link: top.link,
    thumbnail: top.thumbnail?.static || null,
  }
}

export async function fetchSocialListeningRaw(seriesName) {
  const [knowledgeGraph, youtube] = await Promise.all([
    fetchKnowledgeGraphRaw(seriesName).catch((err) => ({ error: err.message })),
    fetchYouTubeRaw(seriesName).catch((err) => ({ error: err.message })),
  ])
  return { seriesName, queriedAt: new Date().toISOString(), knowledgeGraph, youtube }
}

// google_news SerpAPI motoru — server/services/newsSentiment.js tarafından kullanılır. Kendi
// cache'i media_sentiment tablosunda (LLM analiziyle birlikte) tutulduğu için burada
// cacheFirstSerpApi'den GEÇMİYOR, ham çağrı olarak dışa açılıyor.
export async function fetchNewsArticlesRaw(query, countryIso2) {
  const data = await serpapiGet({
    engine: 'google_news',
    q: query,
    gl: countryIso2.toLowerCase(),
  })
  return (data.news_results || []).map((r) => ({
    title: r.title,
    source: r.source?.name || (typeof r.source === 'string' ? r.source : null),
    date: r.date || null,
    url: r.link || null,
    snippet: r.snippet || null,
  }))
}

// --- Hibrit Yerel Skor Çarpanı ---------------------------------------------------------------
// TMDB'nin popülerlik alanı TEK bir küresel sayı (bkz. server/series-period-history.js'teki aynı
// prensip) — ülke bazlı gerçek bir "bu ülkede ne kadar popüler" sinyali yok. Burada, Google
// Trends'in o dizi için döndürdüğü ÜLKE BAZLI arama ilgisiyle (0-100, GEO_MAP_0) TMDB'nin global
// skorunu ağırlıklandırıp ülkeye özgü bir yaklaşık skor üretiyoruz. Bu KESİN bir "o ülkede gerçek
// izleyici sayısı" değil — arama ilgisi bazlı bir TÜREV skor (bkz. Netflix/ReytingTV
// modüllerindeki "rank_score gerçek reyting değildir" prensibiyle aynı dürüstlük).
export async function calculateRegionalScore(basePopularity, countryIso2, seriesName) {
  const key = trendsCacheKey(seriesName)
  const trends = await cacheFirstSerpApi(key, TRENDS_TTL_MS, () => fetchTrendsByCountryRaw(seriesName))

  const iso2 = countryIso2.toUpperCase()
  const match = (trends.byCountry || []).find((r) => resolveIso2FromLabel(r.country) === iso2)

  if (!match) {
    // Google Trends o ülke için hiç veri döndürmemiş — uydurma bir çarpan uygulamak yerine
    // dürüstçe nötr (1.0) çarpanla TMDB skorunu olduğu gibi döneriz.
    return {
      score: basePopularity,
      multiplier: 1,
      localInterest: null,
      basis: 'yetersiz-veri',
      fromCache: trends.fromCache,
      stale: trends.stale,
    }
  }

  // 0-100 arası Trends ilgisini 0.5–1.5 arası bir çarpana eşliyoruz: hiç ilgi yoksa (0) skor
  // yarıya iner, maksimum ilgide (100) %50 artar — TMDB'nin küresel skorunu tamamen geçersiz
  // kılmadan (o da gerçek bir sinyal) yerel ilgiyle dengeler.
  const multiplier = 0.5 + match.value / 100
  const score = Math.round(basePopularity * multiplier * 10) / 10

  return {
    score,
    multiplier: Math.round(multiplier * 100) / 100,
    localInterest: match.value,
    basis: 'google-trends',
    fromCache: trends.fromCache,
    stale: trends.stale,
  }
}

// --- Eski (TTL'siz) önbelleklerden tek seferlik geçiş -----------------------------------------
// Zaten harcanmış SerpAPI kotasıyla çekilmiş veriyi (trends_cache/regional_interest_cache/
// social_listening_cache) kaybetmemek için — bu üç tablo artık yazılmıyor ama içindeki veri
// cache_entries'e taşınır. queried_at bazlı gerçek "ne kadar eski" hesaplanır (expires_at
// geçmişte de çıkabilir — o durumda satır zaten stale sayılır, sorun değil, ilk istekte
// normal şekilde tazelenir). `meta` tablosundaki bayrakla SADECE BİR KEZ çalışır.
function migrateLegacySerpApiCaches() {
  const metaKey = 'serpApiCacheLegacyMigratedAt'
  const already = db.prepare('SELECT value FROM meta WHERE key = ?').get(metaKey)
  if (already) return

  let migrated = 0

  for (const row of db.prepare('SELECT key, series_name, queried_at, by_country FROM trends_cache').all()) {
    const ts = Date.parse(row.queried_at)
    if (Number.isNaN(ts) || !row.by_country) continue
    upsertStmt.run(
      `serp:trends:${row.key}`,
      JSON.stringify({ seriesName: row.series_name, queriedAt: row.queried_at, byCountry: JSON.parse(row.by_country) }),
      ts + TRENDS_TTL_MS,
      ts
    )
    migrated++
  }

  for (const row of db
    .prepare('SELECT key, series_name, iso2, queried_at, by_region FROM regional_interest_cache')
    .all()) {
    const ts = Date.parse(row.queried_at)
    if (Number.isNaN(ts) || !row.by_region) continue
    upsertStmt.run(
      `serp:regional:${row.key}`,
      JSON.stringify({ queriedAt: row.queried_at, byRegion: JSON.parse(row.by_region) }),
      ts + TRENDS_TTL_MS,
      ts
    )
    migrated++
  }

  for (const row of db
    .prepare('SELECT key, series_name, queried_at, knowledge_graph, youtube FROM social_listening_cache')
    .all()) {
    const ts = Date.parse(row.queried_at)
    if (Number.isNaN(ts)) continue
    upsertStmt.run(
      `serp:social:${row.key}`,
      JSON.stringify({
        seriesName: row.series_name,
        queriedAt: row.queried_at,
        knowledgeGraph: row.knowledge_graph ? JSON.parse(row.knowledge_graph) : null,
        youtube: row.youtube ? JSON.parse(row.youtube) : null,
      }),
      ts + SOCIAL_TTL_MS,
      ts
    )
    migrated++
  }

  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    metaKey,
    String(Date.now())
  )
  if (migrated > 0) {
    console.log(`[serpApiCache] ${migrated} eski SerpAPI önbellek kaydı cache_entries'e taşındı.`)
  }
}

migrateLegacySerpApiCaches()
