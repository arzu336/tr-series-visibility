import { getPipelineDb } from './services/pipelineDb.js'

// IMDb puanı, oy sayısı ve oy artışı — IMDb'nin resmî Non-Commercial Datasets dosyalarından
// (data-pipeline-python/imdb_sync.py günlük yazar, burada salt okunur okunur). Önceden OMDb'den
// sayfa açıldıkça tek tek çekiliyordu (anahtar + günlük kota; katalogdaki dizilerin ~%20'sinde puan
// vardı). Kimlik eşlemesi (TMDB → tconst) yalnızca TMDB external_ids'ten gelir, isimden tahmin yok.

const GROWTH_WINDOWS = { d7: 7, d30: 30 }
const DAY_MS = 24 * 60 * 60 * 1000

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS)
}

/**
 * Oy artışı: en son anlık görüntü ile en az `windowDays` gün önceki en yakın anlık görüntü arasındaki
 * fark. Yeterince eski kayıt yoksa (ölçüm yeni başladıysa) null — tahmin edilmez.
 * `history`: tarihe göre artan [{ snapshot_date, num_votes }].
 */
export function votesGrowth(history, windowDays) {
  const valid = (history || []).filter((h) => h.num_votes != null)
  if (valid.length < 2) return null
  const latest = valid[valid.length - 1]
  const base = [...valid].reverse().find((h) => daysBetween(h.snapshot_date, latest.snapshot_date) >= windowDays)
  if (!base) return null
  return {
    votes: latest.num_votes - base.num_votes,
    days: daysBetween(base.snapshot_date, latest.snapshot_date),
    since: base.snapshot_date,
  }
}

function lookupTconst(conn, tmdbId) {
  try {
    const row = conn.prepare('SELECT tconst FROM imdb_title_map WHERE tmdb_id = ?').get(tmdbId)
    if (row) return row.tconst
  } catch {
    // imdb_sync.py henüz hiç çalışmadı (tablo yok) — eski eşlemeye düş
  }
  try {
    return conn.prepare('SELECT imdb_id FROM series_mapping WHERE tmdb_id = ?').get(tmdbId)?.imdb_id ?? null
  } catch {
    return null
  }
}

function readHistory(conn, tconst) {
  try {
    return conn
      .prepare(
        `SELECT snapshot_date, num_votes FROM imdb_rating_history
         WHERE tconst = ? AND snapshot_date >= date((SELECT MAX(snapshot_date) FROM imdb_rating_history WHERE tconst = ?), '-45 days')
         ORDER BY snapshot_date`
      )
      .all(tconst, tconst)
  } catch {
    return []
  }
}

/** { status: 'ready', imdbId, rating, votes, votesGrowth: { d7, d30 }, updatedAt } | { status: 'unavailable' } */
export async function getImdbDataForTmdbSeries(tmdbId, { conn = getPipelineDb() } = {}) {
  if (!conn) return { status: 'unavailable' }
  const imdbId = lookupTconst(conn, Number(tmdbId))
  if (!imdbId) return { status: 'unavailable' }

  let row
  try {
    row = conn.prepare('SELECT average_rating, num_votes, fetched_at FROM imdb_series WHERE tconst = ?').get(imdbId)
  } catch {
    row = null
  }
  if (!row || row.average_rating == null) return { status: 'unavailable', imdbId }

  const history = readHistory(conn, imdbId)
  return {
    status: 'ready',
    imdbId,
    rating: row.average_rating,
    votes: row.num_votes,
    votesGrowth: Object.fromEntries(Object.entries(GROWTH_WINDOWS).map(([k, d]) => [k, votesGrowth(history, d)])),
    updatedAt: row.fetched_at,
  }
}
