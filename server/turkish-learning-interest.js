import db from './db.js'
import { serpapiGet } from './services/serpApiCache.js'

const CACHE_KEY = 'turkish-learning-index'
const TTL_MS = 30 * 24 * 60 * 60 * 1000
const SEARCH_TERMS = ['learn Turkish', 'Türkçe kursu', 'Turkish language course']

const getStmt = db.prepare('SELECT queried_at, by_country FROM turkish_learning_cache WHERE key = ?')
const upsertStmt = db.prepare(`
  INSERT INTO turkish_learning_cache (key, queried_at, by_country) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET queried_at = excluded.queried_at, by_country = excluded.by_country
`)

async function fetchRegionInterest(term) {
  const data = await serpapiGet({
    engine: 'google_trends',
    q: term,
    data_type: 'GEO_MAP_0',
    hl: 'tr',
  })

  const byCountry = new Map()
  for (const r of data.interest_by_region || []) {
    const country = r.geo || r.location
    const value = r.extracted_value ?? r.value
    if (country != null && typeof value === 'number') byCountry.set(country, value)
  }
  return byCountry
}

export async function getTurkishLearningIndex() {
  const row = getStmt.get(CACHE_KEY)
  const ageMs = row?.queried_at ? Date.now() - new Date(row.queried_at).getTime() : null
  if (row && ageMs != null && ageMs < TTL_MS) {
    return { queriedAt: row.queried_at, byCountry: JSON.parse(row.by_country), fromCache: true }
  }

  let perTermResults
  try {
    perTermResults = await Promise.all(SEARCH_TERMS.map((term) => fetchRegionInterest(term)))
  } catch (err) {
    if (row) {
      console.error(`[turkish-learning] tazeleme başarısız (${err.message}), eski önbellek dönülüyor.`)
      return {
        queriedAt: row.queried_at,
        byCountry: JSON.parse(row.by_country),
        fromCache: true,
        stale: true,
      }
    }
    throw err
  }

  const allCountries = new Set(perTermResults.flatMap((m) => [...m.keys()]))
  const byCountry = [...allCountries]
    .map((country) => {
      const values = perTermResults.map((m) => m.get(country)).filter((v) => typeof v === 'number')
      const value = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
      return { country, value, matchedTermCount: values.length }
    })
    .sort((a, b) => b.value - a.value)

  const entry = {
    queriedAt: new Date().toISOString(),
    byCountry,
  }

  upsertStmt.run(CACHE_KEY, entry.queriedAt, JSON.stringify(byCountry))

  return { ...entry, fromCache: false }
}
