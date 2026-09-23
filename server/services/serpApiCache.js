import db from '../db.js'
import { chargeCurrentUserForLiveCall } from './liveCallQuota.js'
import { resolveIso2FromLabel } from './countryLookup.js'

const EXTERNAL_TIMEOUT_MS = 15000

export const TRENDS_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const SOCIAL_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const TIMESERIES_TTL_MS = 30 * 24 * 60 * 60 * 1000

function normalizeSeriesKey(seriesName) {
  return seriesName.trim().toLocaleLowerCase('tr')
}

export function trendsCacheKey(seriesName) {
  return `serp:trends:${normalizeSeriesKey(seriesName)}`
}
export function actorTrendsCacheKey(actorName) {
  return `serp:actor-trends:${normalizeSeriesKey(actorName)}`
}
export function regionalCacheKey(seriesName, iso2) {
  return `serp:regional:${normalizeSeriesKey(seriesName)}::${iso2.toUpperCase()}`
}
export function socialCacheKey(seriesName) {
  return `serp:social:${normalizeSeriesKey(seriesName)}`
}
export function timeSeriesCacheKey(query, iso2, timeframe) {
  return `serp:timeseries:${iso2 ? iso2.toUpperCase() : 'WW'}:${normalizeSeriesKey(query)}:${timeframe}`
}

const getRawStmt = db.prepare('SELECT value, expires_at, updated_at FROM cache_entries WHERE key = ?')
const upsertStmt = db.prepare(`
  INSERT INTO cache_entries (key, value, expires_at, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at, updated_at = excluded.updated_at
`)

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

function getSerpApiMonthlyBudget() {
  return Number(process.env.SERPAPI_MONTHLY_BUDGET) || 5000
}

function currentUsageMonthKey(now = new Date()) {
  return `serpApiUsage:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')

const reserveUsageStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, '1')
  ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1
  RETURNING CAST(value AS INTEGER) AS value
`)
const releaseUsageStmt = db.prepare(`UPDATE meta SET value = CAST(value AS INTEGER) - 1 WHERE key = ?`)

export function getSerpApiUsageThisMonth(now = new Date()) {
  const monthKey = currentUsageMonthKey(now)
  const row = getMetaStmt.get(monthKey)
  return { used: row ? Number(row.value) : 0, budget: getSerpApiMonthlyBudget() }
}

export async function serpapiGet(params) {
  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) {
    throw new Error('SERPAPI_API_KEY tanımlı değil (.env dosyasını kontrol et)')
  }

  const monthKey = currentUsageMonthKey()
  const budget = getSerpApiMonthlyBudget()
  const reserved = reserveUsageStmt.get(monthKey).value
  if (reserved > budget) {
    releaseUsageStmt.run(monthKey)
    const kotaHatasi = new Error(`Aylık kota dolmuş görünüyor (429). (${reserved - 1}/${budget})`)
    kotaHatasi.status = 429
    throw kotaHatasi
  }

  let releaseUserCall
  try {
    releaseUserCall = chargeCurrentUserForLiveCall()
  } catch (err) {
    releaseUsageStmt.run(monthKey)
    throw err
  }

  try {
    const url = new URL('https://serpapi.com/search.json')
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    url.searchParams.set('api_key', apiKey)

    const res = await fetch(url, { signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS) })
    if (!res.ok) {
      if (res.status === 429) {
        const kotaHatasi = new Error('Aylık kota dolmuş görünüyor (429).')
        kotaHatasi.status = 429
        throw kotaHatasi
      }
      throw new Error(`İstek başarısız (${res.status})`)
    }
    const data = await res.json()
    if (data.error) {
      throw new Error(`İstek hatası: ${data.error}`)
    }
    return data
  } catch (err) {
    releaseUsageStmt.run(monthKey)
    releaseUserCall()
    throw err
  }
}

export async function fetchTrendsByCountryRaw(seriesName) {
  const data = await serpapiGet({
    engine: 'google_trends',
    q: seriesName,
    data_type: 'GEO_MAP_0',
    hl: 'tr',
  })
  const byCountry = (data.interest_by_region || [])
    .map((r) => ({ country: r.geo || r.location, value: r.extracted_value ?? r.value }))
    .filter((r) => r.country != null && r.value != null)
    .sort((a, b) => b.value - a.value)

  return { seriesName, queriedAt: new Date().toISOString(), byCountry }
}

export async function fetchTrendsTimeSeriesRaw(query, iso2, timeframe = 'today 12-m') {
  const params = { engine: 'google_trends', q: query, date: timeframe, data_type: 'TIMESERIES', hl: 'tr' }
  if (iso2) params.geo = iso2.toUpperCase()
  const data = await serpapiGet(params)
  const timeline = (data.interest_over_time?.timeline_data || [])
    .filter((point) => !point.partial_data)
    .map((point) => ({
      timestamp: point.timestamp ? Number(point.timestamp) : null,
      value: point.values?.[0]?.extracted_value ?? 0,
    }))
    .filter((point) => point.timestamp != null)

  return { query, iso2: iso2 ? iso2.toUpperCase() : null, timeframe, queriedAt: new Date().toISOString(), timeline }
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

function extractRatingsFromKg(kg) {
  const ratingsEntry = (kg.web_results || []).find((w) => Array.isArray(w.ratings) && w.ratings.length > 0)
  return ratingsEntry ? ratingsEntry.ratings.map((r) => ({ source: r.source, rating: r.rating, link: r.link || null })) : []
}

function extractWatchPlatforms(kg) {
  if (Array.isArray(kg.watch_now) && kg.watch_now.length > 0) {
    return kg.watch_now.map((w) => ({ name: w.name, link: w.link || null }))
  }
  const whereToWatch = (kg.web_results || []).find((w) => /where to watch/i.test(w.title || ''))
  if (whereToWatch?.link) {
    return [{ name: whereToWatch.source || whereToWatch.title, link: whereToWatch.link }]
  }
  return []
}

async function fetchKnowledgeGraphRaw(seriesName) {
  const data = await serpapiGet({ engine: 'google', q: `${seriesName} dizi`, hl: 'tr', gl: 'tr' })
  const kg = data.knowledge_graph
  if (!kg) return null
  const ratings = extractRatingsFromKg(kg)
  const userReviewsPct = kg.user_reviews?.percentage ?? null
  if (ratings.length === 0 && userReviewsPct == null) return null
  return { title: kg.title || seriesName, ratings, userReviewsPct }
}

export async function fetchLocalizedKnowledgeGraphRaw(seriesName, iso2) {
  const data = await serpapiGet({ engine: 'google', q: `${seriesName} tv series`, gl: iso2.toLowerCase() })
  const kg = data.knowledge_graph
  if (!kg) return null
  return {
    title: kg.title || seriesName,
    watchPlatforms: extractWatchPlatforms(kg),
    ratings: extractRatingsFromKg(kg),
    userReviewsPct: kg.user_reviews?.percentage ?? null,
  }
}

export async function fetchLocalizedYouTubeRaw(seriesName, iso2) {
  const data = await serpapiGet({ engine: 'youtube', search_query: `${seriesName} trailer`, gl: iso2.toLowerCase() })
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

export function localizedSocialCacheKey(seriesName, iso2) {
  return `serp:social-local:${normalizeSeriesKey(seriesName)}::${iso2.toUpperCase()}`
}

function settleHalf(result) {
  if (result.status === 'fulfilled') return { value: result.value, error: null }
  return { value: null, error: result.reason?.message || String(result.reason) }
}

function combineSocialHalves(base, kgResult, ytResult) {
  const kg = settleHalf(kgResult)
  const yt = settleHalf(ytResult)
  if (kg.error && yt.error) {
    throw new Error(`Sosyal dinleme çağrılarının ikisi de başarısız: ${kg.error} / ${yt.error}`)
  }
  return { ...base, queriedAt: new Date().toISOString(), knowledgeGraph: kg.value, youtube: yt.value }
}

export async function fetchLocalizedSocialListeningRaw(seriesName, iso2) {
  const [kgResult, ytResult] = await Promise.allSettled([
    fetchLocalizedKnowledgeGraphRaw(seriesName, iso2),
    fetchLocalizedYouTubeRaw(seriesName, iso2),
  ])
  return combineSocialHalves({ seriesName, iso2: iso2.toUpperCase() }, kgResult, ytResult)
}

const EPISODE_SPECIFIC_TITLE_RE = /\d+\.\s*bölüm/i

async function fetchYouTubeRaw(seriesName) {
  const data = await serpapiGet({ engine: 'youtube', search_query: `${seriesName} dizi tanıtım` })
  const results = data.video_results || []
  const top = results.find((v) => !EPISODE_SPECIFIC_TITLE_RE.test(v.title || '')) || results[0]
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
  const [kgResult, ytResult] = await Promise.allSettled([
    fetchKnowledgeGraphRaw(seriesName),
    fetchYouTubeRaw(seriesName),
  ])
  return combineSocialHalves({ seriesName }, kgResult, ytResult)
}

export async function calculateRegionalScore(basePopularity, countryIso2, seriesName) {
  const key = trendsCacheKey(seriesName)
  const trends = await cacheFirstSerpApi(key, TRENDS_TTL_MS, () => fetchTrendsByCountryRaw(seriesName))

  const iso2 = countryIso2.toUpperCase()
  const match = (trends.byCountry || []).find((r) => resolveIso2FromLabel(r.country) === iso2)

  if (!match) {
    return {
      score: basePopularity,
      multiplier: 1,
      localInterest: null,
      basis: 'yetersiz-veri',
      fromCache: trends.fromCache,
      stale: trends.stale,
    }
  }

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
