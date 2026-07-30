import db from './db.js'
import { getExternalIds } from './tmdb.js'
import { getCached, setCached } from './cache.js'

const EXTERNAL_IDS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 gün — imdb_id neredeyse hiç değişmez
const IMDB_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 gün — puan/oy/oyuncu listesi yavaş değişir

// IMDb kendi sayfalarını AWS WAF JavaScript challenge ile koruyor (doğrulandı: HTTP 202,
// x-amzn-waf-action: challenge, boş gövde) — basit fetch+parse ile kazınamıyor. Bunun yerine
// gerçek IMDb verisini (puan, oy sayısı, oyuncular) resmi/ücretsiz OMDb API üzerinden alıyoruz.
const OMDB_BASE = 'https://www.omdbapi.com/'

const getImdbCacheStmt = db.prepare('SELECT * FROM imdb_cache WHERE imdb_id = ?')
const upsertImdbCacheStmt = db.prepare(`
  INSERT INTO imdb_cache (imdb_id, rating, votes, top_cast, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(imdb_id) DO UPDATE SET
    rating = excluded.rating,
    votes = excluded.votes,
    top_cast = excluded.top_cast,
    updated_at = excluded.updated_at
`)

function rowToResult(row) {
  return {
    status: 'ready',
    imdbId: row.imdb_id,
    rating: row.rating,
    votes: row.votes,
    topCast: JSON.parse(row.top_cast || '[]'),
    updatedAt: row.updated_at,
  }
}

function isFresh(updatedAt) {
  return Date.now() - new Date(updatedAt).getTime() < IMDB_CACHE_TTL_MS
}

async function resolveImdbId(tmdbId) {
  const cacheKey = `external-ids-${tmdbId}`
  const cached = getCached(cacheKey)
  if (cached) return cached.imdbId
  const { imdbId } = await getExternalIds(tmdbId)
  setCached(cacheKey, { imdbId }, EXTERNAL_IDS_CACHE_TTL_MS)
  return imdbId
}

// "Actors": "A, B, C, D" biçimindeki OMDb alanını gerçek bir isim dizisine çevirir —
// OMDb ücretsiz katmanda bundan fazla oyuncu vermiyor, uydurma bir tamamlama yapılmaz.
function parseTopCast(actors) {
  if (!actors || actors === 'N/A') return []
  return actors.split(',').map((name) => name.trim()).filter(Boolean)
}

function parseVotes(votes) {
  if (!votes || votes === 'N/A') return null
  const n = Number(votes.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function parseRating(rating) {
  if (!rating || rating === 'N/A') return null
  const n = Number(rating)
  return Number.isFinite(n) ? n : null
}

async function fetchFromOmdb(imdbId) {
  const apiKey = process.env.OMDB_API_KEY
  if (!apiKey) {
    throw new Error('OMDB_API_KEY tanımlı değil (.env dosyasını kontrol et)')
  }
  const url = new URL(OMDB_BASE)
  url.searchParams.set('i', imdbId)
  url.searchParams.set('apikey', apiKey)

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`OMDb isteği başarısız (${res.status})`)
  }
  const data = await res.json()
  if (data.Response === 'False') {
    return null
  }
  return {
    rating: parseRating(data.imdbRating),
    votes: parseVotes(data.imdbVotes),
    topCast: parseTopCast(data.Actors),
  }
}

// server/trakt.js'in yerini alan modül — aynı felsefe: talep üzerine çek, gerçek veri
// gelmiyorsa/yoksa uydurma bir sayı üretme, dürüstçe 'unavailable' dön.
export async function getImdbDataForTmdbSeries(tmdbId) {
  const imdbId = await resolveImdbId(tmdbId)
  if (!imdbId) {
    return { status: 'unavailable' }
  }

  const row = getImdbCacheStmt.get(imdbId)
  if (row && isFresh(row.updated_at)) {
    return { ...rowToResult(row), fromCache: true }
  }

  const omdbData = await fetchFromOmdb(imdbId)
  if (!omdbData) {
    return { status: 'unavailable', imdbId }
  }

  const updatedAt = new Date().toISOString()
  upsertImdbCacheStmt.run(imdbId, omdbData.rating, omdbData.votes, JSON.stringify(omdbData.topCast), updatedAt)

  return {
    status: 'ready',
    imdbId,
    rating: omdbData.rating,
    votes: omdbData.votes,
    topCast: omdbData.topCast,
    updatedAt,
    fromCache: false,
  }
}
