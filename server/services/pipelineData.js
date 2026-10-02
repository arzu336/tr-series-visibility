import { getPipelineDb } from './pipelineDb.js'

/**
 * Katalog tamamlama (data-pipeline-python/catalog_supplement.py): listelere girmiş ama popülerlik kataloğunda
 * olmayan Türk dizileri. Kataloğa sabit eklenir (server/tmdb.js). Tablo yoksa ya da pipeline.db açılamıyorsa [].
 */
export function getCatalogSupplementIds() {
  const conn = getPipelineDb()
  if (!conn) return []
  try {
    return conn
      .prepare('SELECT tmdb_id FROM catalog_supplement WHERE already_in_catalog = 0 ORDER BY tmdb_id')
      .all()
      .map((r) => r.tmdb_id)
  } catch {
    return []
  }
}

function lookupTconst(conn, tmdbId, mappingImdbId) {
  try {
    const row = conn.prepare('SELECT tconst FROM imdb_title_map WHERE tmdb_id = ?').get(tmdbId)
    if (row) return row.tconst
  } catch {
    // imdb_sync.py henüz çalışmadı
  }
  return mappingImdbId || null
}

function safeAll(conn, sql, ...params) {
  try {
    return conn.prepare(sql).all(...params)
  } catch {
    return []
  }
}

/** Sezonlara göre bölüm puanları: [{ season, episodes: [{ episode, rating, votes }] }] (sezon/bölüm no'su olmayanlar atlanır). */
export function groupEpisodes(rows) {
  const bySeason = new Map()
  for (const r of rows) {
    if (r.season == null || r.episode == null) continue
    if (!bySeason.has(r.season)) bySeason.set(r.season, [])
    bySeason.get(r.season).push({ episode: r.episode, rating: r.average_rating, votes: r.num_votes })
  }
  return [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, episodes]) => ({ season, episodes: episodes.sort((a, b) => a.episode - b.episode) }))
}

const CREW_LIMIT = 4

/** Yönetmen/senarist: en çok bölümde çalışan önce; adı bilinmeyenler atlanır. */
export function groupCrew(rows) {
  const pick = (role) =>
    rows
      .filter((r) => r.role === role && r.name)
      .sort((a, b) => b.episode_count - a.episode_count || a.name.localeCompare(b.name, 'tr'))
      .slice(0, CREW_LIMIT)
      .map((r) => ({ name: r.name, episodes: r.episode_count }))
  return { directors: pick('director'), writers: pick('writer') }
}

export function getSeriesEnrichment(tmdbId, { conn = getPipelineDb() } = {}) {
  if (!conn) return null

  let mapping = null
  try {
    mapping = conn.prepare('SELECT name, dizilah_slug, imdb_id FROM series_mapping WHERE tmdb_id = ?').get(tmdbId)
  } catch {
    mapping = null
  }

  let dizilah = null
  if (mapping?.dizilah_slug) {
    const dizilahRow = conn
      .prepare(
        'SELECT title, channel, status, first_air_date, total_episodes, average_rating, vote_count, source_url FROM dizilah_series WHERE slug = ?'
      )
      .get(mapping.dizilah_slug)
    if (dizilahRow && dizilahRow.title) {
      dizilah = {
        title: dizilahRow.title,
        channel: dizilahRow.channel,
        status: dizilahRow.status,
        firstAirDate: dizilahRow.first_air_date,
        totalEpisodes: dizilahRow.total_episodes,
        communityRating: dizilahRow.average_rating,
        voteCount: dizilahRow.vote_count,
        sourceUrl: dizilahRow.source_url,
      }
    }
  }

  // IMDb kimliği önce imdb_sync.py'nin TMDB eşlemesinden (tüm katalog), yoksa eski series_mapping'den.
  let imdb = null
  const tconst = lookupTconst(conn, tmdbId, mapping?.imdb_id)
  if (tconst) {
    const imdbRow = conn
      .prepare('SELECT tconst, primary_title, average_rating, num_votes FROM imdb_series WHERE tconst = ?')
      .get(tconst)
    const localizedTitles = safeAll(
      conn,
      'SELECT region, title FROM imdb_localized_titles WHERE tconst = ? ORDER BY region',
      tconst
    )
    const episodeRows = safeAll(
      conn,
      'SELECT season, episode, average_rating, num_votes FROM imdb_episodes WHERE parent_tconst = ?',
      tconst
    )
    const crewRows = safeAll(conn, 'SELECT role, name, episode_count FROM imdb_crew WHERE parent_tconst = ?', tconst)
    if (imdbRow || localizedTitles.length || episodeRows.length) {
      imdb = {
        tconst,
        primaryTitle: imdbRow?.primary_title ?? null,
        averageRating: imdbRow?.average_rating ?? null,
        numVotes: imdbRow?.num_votes ?? null,
        localizedTitles: localizedTitles.map((r) => ({ region: r.region, title: r.title })),
        episodeCount: episodeRows.length || null,
        seasons: groupEpisodes(episodeRows),
        crew: groupCrew(crewRows),
      }
    }
  }

  if (!dizilah && !imdb) return null
  return { dizilah, imdb }
}
