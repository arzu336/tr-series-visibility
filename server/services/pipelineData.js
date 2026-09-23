import { getPipelineDb } from './pipelineDb.js'

export function getSeriesEnrichment(tmdbId) {
  const conn = getPipelineDb()
  if (!conn) return null

  const mapping = conn
    .prepare('SELECT name, dizilah_slug, imdb_id FROM series_mapping WHERE tmdb_id = ?')
    .get(tmdbId)
  if (!mapping) return null

  let dizilah = null
  const dizilahRow = conn
    .prepare('SELECT title, channel, status, first_air_date, total_episodes, average_rating, vote_count, source_url FROM dizilah_series WHERE slug = ?')
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

  let imdb = null
  if (mapping.imdb_id) {
    const imdbRow = conn
      .prepare('SELECT tconst, primary_title, average_rating, num_votes FROM imdb_series WHERE tconst = ?')
      .get(mapping.imdb_id)
    if (imdbRow) {
      const localizedTitles = conn
        .prepare('SELECT region, title FROM imdb_localized_titles WHERE tconst = ? ORDER BY region')
        .all(mapping.imdb_id)
      imdb = {
        tconst: imdbRow.tconst,
        primaryTitle: imdbRow.primary_title,
        averageRating: imdbRow.average_rating,
        numVotes: imdbRow.num_votes,
        localizedTitles: localizedTitles.map((r) => ({ region: r.region, title: r.title })),
      }
    }
  }

  if (!dizilah && !imdb) return null
  return { dizilah, imdb }
}
