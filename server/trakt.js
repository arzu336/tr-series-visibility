import db from './db.js'

const TRAKT_BASE = 'https://api.trakt.tv'

function normalizeKey(seriesName) {
  return seriesName.trim().toLocaleLowerCase('tr')
}

const getStmt = db.prepare('SELECT * FROM trakt_cache WHERE key = ?')
const insertStmt = db.prepare(`
  INSERT INTO trakt_cache (
    key, series_name, queried_at, matched_title, matched_year,
    rating, votes, watchers, plays, collectors, trakt_url
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

function rowToResult(row) {
  return {
    seriesName: row.series_name,
    queriedAt: row.queried_at,
    matchedTitle: row.matched_title,
    matchedYear: row.matched_year,
    rating: row.rating,
    votes: row.votes,
    watchers: row.watchers,
    plays: row.plays,
    collectors: row.collectors,
    traktUrl: row.trakt_url,
  }
}

async function traktGet(path) {
  const clientId = process.env.TRAKT_CLIENT_ID
  if (!clientId) {
    throw new Error('TRAKT_CLIENT_ID tanımlı değil (.env dosyasını kontrol et)')
  }
  const res = await fetch(TRAKT_BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': clientId,
      // Cloudflare (trakt.tv önünde), Node'un varsayılan/boş User-Agent'ını bot
      // sanıp 403 ile engelliyor — tarayıcı benzeri bir UA bunu aşıyor.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  })
  if (!res.ok) {
    if (res.status === 404) return null
    throw new Error(`Trakt isteği başarısız: ${path} (${res.status})`)
  }
  return res.json()
}

// Trakt, TMDB gibi ayrı bir katalog kullanıyor — dizi id eşleşmesi garanti değil,
// bu yüzden diğer talep-üzerine sorgulanan kaynaklar (SerpAPI trends/social) gibi
// isimden arama yapıp en iyi eşleşmeyi (ilk sonuç, Trakt zaten relevance'a göre
// sıralıyor) alıyoruz.
async function searchShow(seriesName) {
  const results = await traktGet(`/search/show?query=${encodeURIComponent(seriesName)}&limit=1`)
  return results?.[0]?.show || null
}

async function fetchStats(slug) {
  const stats = await traktGet(`/shows/${slug}/stats`)
  return stats || {}
}

async function fetchRating(slug) {
  const ratings = await traktGet(`/shows/${slug}/ratings`)
  return ratings || {}
}

// Trakt'ta kullanıcı bazlı izleme/puanlama verisini çeker — kimlik doğrulama
// gerektirmeyen public uçlar, düşük hacimde tamamen ücretsiz (bkz. bütçe raporu
// §3, "Trakt.tv API"). Google Trends/sosyal dinleme ile aynı felsefe: her dizi
// yalnızca ilk sorguda API'ye gider, sonrasında süresiz cache'lenir.
export async function queryTraktStats(seriesName) {
  const key = normalizeKey(seriesName)
  const row = getStmt.get(key)
  if (row) return { ...rowToResult(row), fromCache: true }

  const show = await searchShow(seriesName)
  if (!show) {
    const entry = {
      seriesName,
      queriedAt: new Date().toISOString(),
      matchedTitle: null,
      matchedYear: null,
      rating: null,
      votes: null,
      watchers: null,
      plays: null,
      collectors: null,
      traktUrl: null,
    }
    insertStmt.run(
      key, entry.seriesName, entry.queriedAt, entry.matchedTitle, entry.matchedYear,
      entry.rating, entry.votes, entry.watchers, entry.plays, entry.collectors, entry.traktUrl
    )
    return { ...entry, fromCache: false }
  }

  const slug = show.ids?.slug || show.ids?.trakt
  const [stats, rating] = await Promise.all([fetchStats(slug), fetchRating(slug)])

  const entry = {
    seriesName,
    queriedAt: new Date().toISOString(),
    matchedTitle: show.title,
    matchedYear: show.year ?? null,
    rating: rating.rating ?? null,
    votes: rating.votes ?? null,
    watchers: stats.watchers ?? null,
    plays: stats.plays ?? null,
    collectors: stats.collectors ?? null,
    traktUrl: show.ids?.slug ? `https://trakt.tv/shows/${show.ids.slug}` : null,
  }

  insertStmt.run(
    key, entry.seriesName, entry.queriedAt, entry.matchedTitle, entry.matchedYear,
    entry.rating, entry.votes, entry.watchers, entry.plays, entry.collectors, entry.traktUrl
  )

  return { ...entry, fromCache: false }
}
