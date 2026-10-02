import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { getSeriesEnrichment, groupEpisodes, groupCrew } from './pipelineData.js'

describe('groupEpisodes', () => {
  it('sezon ve bölüme göre sıralı; sezon/bölüm no yoksa atlanır', () => {
    const rows = [
      { season: 2, episode: 1, average_rating: 8.1, num_votes: 30 },
      { season: 1, episode: 2, average_rating: null, num_votes: null },
      { season: 1, episode: 1, average_rating: 7.5, num_votes: 50 },
      { season: null, episode: 3, average_rating: 6, num_votes: 5 },
    ]
    expect(groupEpisodes(rows)).toEqual([
      {
        season: 1,
        episodes: [
          { episode: 1, rating: 7.5, votes: 50 },
          { episode: 2, rating: null, votes: null },
        ],
      },
      { season: 2, episodes: [{ episode: 1, rating: 8.1, votes: 30 }] },
    ])
  })
})

describe('groupCrew', () => {
  it('en çok bölümde çalışan önce, en fazla 4 kişi; adı olmayan atlanır', () => {
    const rows = [
      { role: 'director', name: 'B', episode_count: 10 },
      { role: 'director', name: 'A', episode_count: 120 },
      { role: 'director', name: null, episode_count: 500 },
      ...['W1', 'W2', 'W3', 'W4', 'W5'].map((name, i) => ({ role: 'writer', name, episode_count: 50 - i })),
    ]
    const crew = groupCrew(rows)
    expect(crew.directors).toEqual([
      { name: 'A', episodes: 120 },
      { name: 'B', episodes: 10 },
    ])
    expect(crew.writers.map((w) => w.name)).toEqual(['W1', 'W2', 'W3', 'W4'])
  })
})

describe('getSeriesEnrichment — IMDb ayrıntıları', () => {
  function db() {
    const conn = new DatabaseSync(':memory:')
    conn.exec(`
      CREATE TABLE series_mapping (tmdb_id INTEGER PRIMARY KEY, name TEXT, dizilah_slug TEXT, imdb_id TEXT);
      CREATE TABLE dizilah_series (slug TEXT, title TEXT, channel TEXT, status TEXT, first_air_date TEXT,
        total_episodes INTEGER, average_rating REAL, vote_count INTEGER, source_url TEXT);
      CREATE TABLE imdb_title_map (tmdb_id INTEGER PRIMARY KEY, tconst TEXT, resolved_at TEXT);
      CREATE TABLE imdb_series (tconst TEXT PRIMARY KEY, primary_title TEXT, average_rating REAL, num_votes INTEGER);
      CREATE TABLE imdb_localized_titles (tconst TEXT, region TEXT, title TEXT, is_original INTEGER);
      CREATE TABLE imdb_episodes (tconst TEXT, parent_tconst TEXT, season INTEGER, episode INTEGER,
        average_rating REAL, num_votes INTEGER);
      CREATE TABLE imdb_crew (parent_tconst TEXT, role TEXT, nconst TEXT, name TEXT, episode_count INTEGER);
      INSERT INTO imdb_title_map VALUES (7, 'tt7', 'x');
      INSERT INTO imdb_series VALUES ('tt7', 'Yedi', 8.0, 900);
      INSERT INTO imdb_localized_titles VALUES ('tt7', 'US', 'Seven', 0);
      INSERT INTO imdb_episodes VALUES ('e1', 'tt7', 1, 1, 8.2, 40), ('e2', 'tt7', 1, 2, 7.9, 35);
      INSERT INTO imdb_crew VALUES ('tt7', 'director', 'nm1', 'Yönetmen', 2);
    `)
    return conn
  }

  it('eski eşleme (series_mapping) olmasa da IMDb eşlemesinden bölüm, ekip ve yerel adlar gelir', () => {
    const e = getSeriesEnrichment(7, { conn: db() })
    expect(e.dizilah).toBeNull()
    expect(e.imdb).toMatchObject({
      tconst: 'tt7',
      averageRating: 8,
      episodeCount: 2,
      localizedTitles: [{ region: 'US', title: 'Seven' }],
      crew: { directors: [{ name: 'Yönetmen', episodes: 2 }], writers: [] },
    })
    expect(e.imdb.seasons[0].episodes).toHaveLength(2)
  })

  it('hiçbir kaynakta yoksa null', () => {
    expect(getSeriesEnrichment(99, { conn: db() })).toBeNull()
    expect(getSeriesEnrichment(7, { conn: null })).toBeNull()
  })
})
