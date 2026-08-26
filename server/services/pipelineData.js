import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// data-pipeline-python/'ın kendi, ana uygulamanın server/data/app.db'sinden AYRI
// SQLite dosyası — bkz. data-pipeline-python/db.py'deki aynı ayrım notu. Salt okunur
// açılır: bu süreç asla pipeline'ın verisini değiştirmemeli, sadece okumalı.
const PIPELINE_DB_PATH = path.join(__dirname, '..', '..', 'data-pipeline-python', 'data', 'pipeline.db')

let db = null
let triedOpen = false

// Python pipeline'ı hiç çalıştırılmamışsa (dosya yok) sunucunun tamamı çökmemeli —
// bu durumda tüm getX fonksiyonları dürüstçe null/boş döner (bkz. index.js
// /api/series-enrichment: pipeline verisi olmayan bir dizi için sessizce "zenginleştirme
// yok" der, hata fırlatmaz).
function getDb() {
  if (db || triedOpen) return db
  triedOpen = true
  if (!fs.existsSync(PIPELINE_DB_PATH)) {
    console.warn('[pipelineData] data-pipeline-python/data/pipeline.db bulunamadı — Python pipeline henüz çalıştırılmamış olabilir.')
    return null
  }
  try {
    db = new DatabaseSync(PIPELINE_DB_PATH, { readOnly: true })
  } catch (err) {
    console.error('[pipelineData] pipeline.db açılamadı:', err.message)
    db = null
  }
  return db
}

// data-pipeline-python/batch_run.py'nin ürettiği Dizilah (topluluk puanı, kanal,
// yayın durumu) + IMDb (ülke bazlı yerelleştirilmiş isimler) verisini TMDB kimliğine
// göre birleştirip döner. Hiçbiri yoksa null — uydurma bir sonuç üretilmez.
export function getSeriesEnrichment(tmdbId) {
  const conn = getDb()
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
