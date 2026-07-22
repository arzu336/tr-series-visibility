import db from './db.js'

function normalizeKey(seriesName) {
  return seriesName.trim().toLocaleLowerCase('tr')
}

const getStmt = db.prepare('SELECT series_name, queried_at, by_country FROM trends_cache WHERE key = ?')
const insertStmt = db.prepare(`
  INSERT INTO trends_cache (key, series_name, queried_at, by_country) VALUES (?, ?, ?, ?)
`)

export async function queryTrends(seriesName) {
  const key = normalizeKey(seriesName)
  const row = getStmt.get(key)

  if (row) {
    return { seriesName: row.series_name, queriedAt: row.queried_at, byCountry: JSON.parse(row.by_country), fromCache: true }
  }

  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) {
    throw new Error('SERPAPI_API_KEY tanımlı değil (.env dosyasını kontrol et)')
  }

  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine', 'google_trends')
  url.searchParams.set('q', seriesName)
  url.searchParams.set('data_type', 'GEO_MAP_0')
  url.searchParams.set('hl', 'tr')
  url.searchParams.set('api_key', apiKey)

  const res = await fetch(url)
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('SerpAPI aylık ücretsiz kota dolmuş görünüyor (429).')
    }
    throw new Error(`SerpAPI isteği başarısız (${res.status})`)
  }
  const data = await res.json()
  if (data.error) {
    throw new Error(`SerpAPI hatası: ${data.error}`)
  }

  const byCountry = (data.interest_by_region || [])
    .map((r) => ({ country: r.location || r.geo, value: r.extracted_value ?? r.value }))
    .filter((r) => r.country != null && r.value != null)
    .sort((a, b) => b.value - a.value)

  const entry = {
    seriesName,
    queriedAt: new Date().toISOString(),
    byCountry,
  }

  insertStmt.run(key, seriesName, entry.queriedAt, JSON.stringify(byCountry))

  return { ...entry, fromCache: false }
}
