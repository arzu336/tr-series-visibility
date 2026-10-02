import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { votesGrowth, getImdbDataForTmdbSeries } from './imdb.js'

const h = (snapshot_date, num_votes) => ({ snapshot_date, num_votes })

describe('votesGrowth — oy artışı', () => {
  it('en az N gün önceki en yakın kayda göre fark', () => {
    const gecmis = [h('2026-09-01', 900), h('2026-09-24', 1000), h('2026-09-25', 1010), h('2026-10-02', 1100)]
    expect(votesGrowth(gecmis, 7)).toEqual({ votes: 90, days: 7, since: '2026-09-25' })
    expect(votesGrowth(gecmis, 30)).toEqual({ votes: 200, days: 31, since: '2026-09-01' })
  })

  it('ölçüm yeni başladıysa null (tahmin yok)', () => {
    expect(votesGrowth([h('2026-10-01', 10), h('2026-10-02', 12)], 7)).toBeNull()
    expect(votesGrowth([h('2026-10-02', 12)], 7)).toBeNull()
    expect(votesGrowth([], 7)).toBeNull()
  })
})

function pipelineDb() {
  const conn = new DatabaseSync(':memory:')
  conn.exec(`
    CREATE TABLE imdb_title_map (tmdb_id INTEGER PRIMARY KEY, tconst TEXT, resolved_at TEXT);
    CREATE TABLE series_mapping (tmdb_id INTEGER PRIMARY KEY, name TEXT, dizilah_slug TEXT, imdb_id TEXT);
    CREATE TABLE imdb_series (tconst TEXT PRIMARY KEY, average_rating REAL, num_votes INTEGER, fetched_at TEXT);
    CREATE TABLE imdb_rating_history (tconst TEXT, snapshot_date TEXT, average_rating REAL, num_votes INTEGER);
    INSERT INTO imdb_title_map VALUES (1, 'tt0000001', 'x'), (2, NULL, 'x');
    INSERT INTO series_mapping VALUES (3, 'Eski', 'eski', 'tt0000003');
    INSERT INTO imdb_series VALUES ('tt0000001', 8.4, 5200, '2026-10-02T13:00:00Z'), ('tt0000003', 7.1, 90, 'z');
    INSERT INTO imdb_rating_history VALUES ('tt0000001', '2026-09-25', 8.4, 5000), ('tt0000001', '2026-10-02', 8.4, 5200);
  `)
  return conn
}

describe('getImdbDataForTmdbSeries — pipeline.db okuması', () => {
  it('puan, oy ve 7 günlük artış; 30 günlük veri yoksa null', async () => {
    const r = await getImdbDataForTmdbSeries(1, { conn: pipelineDb() })
    expect(r).toMatchObject({ status: 'ready', imdbId: 'tt0000001', rating: 8.4, votes: 5200 })
    expect(r.votesGrowth).toEqual({ d7: { votes: 200, days: 7, since: '2026-09-25' }, d30: null })
  })

  it('IMDb kimliği yoksa ya da veritabanı yoksa unavailable; eski eşleme yedek', async () => {
    const conn = pipelineDb()
    expect(await getImdbDataForTmdbSeries(2, { conn })).toEqual({ status: 'unavailable' })
    expect(await getImdbDataForTmdbSeries(99, { conn })).toEqual({ status: 'unavailable' })
    expect(await getImdbDataForTmdbSeries(1, { conn: null })).toEqual({ status: 'unavailable' })
    expect(await getImdbDataForTmdbSeries(3, { conn })).toMatchObject({ status: 'ready', rating: 7.1 })
  })
})
