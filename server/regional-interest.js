import db from './db.js'

function normalizeKey(seriesName, iso2) {
  return `${seriesName.trim().toLocaleLowerCase('tr')}::${iso2.toUpperCase()}`
}

const getStmt = db.prepare('SELECT queried_at, by_region FROM regional_interest_cache WHERE key = ?')
const insertStmt = db.prepare(`
  INSERT INTO regional_interest_cache (key, series_name, iso2, queried_at, by_region) VALUES (?, ?, ?, ?, ?)
`)

// Best-effort bölgesel ilgi kırılımı: server/serpapi.js'teki queryTrends ile birebir aynı
// desen (google_trends, GEO_MAP_0), tek fark burada `geo` parametresiyle tek bir ülkeye
// kısıtlanıyor — Google Trends bu durumda o ülkenin bölge/şehir kırılımını döner. Şehir
// koordinatı/geocoding veritabanımız olmadığı için haritada pin olarak DEĞİL, CountryPanel'de
// sıralı bir liste olarak gösterilir (bkz. src/components/CountryPanel.jsx). Bazı ülke/dizi
// kombinasyonlarında Google Trends hiç veri döndürmeyebilir — bu durumda dürüstçe
// 'unavailable' dönülür, uydurma bir şehir listesi üretilmez.
export async function getRegionalInterest(seriesName, iso2) {
  const key = normalizeKey(seriesName, iso2)
  const row = getStmt.get(key)
  if (row) {
    return { queriedAt: row.queried_at, byRegion: JSON.parse(row.by_region), fromCache: true }
  }

  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) {
    throw new Error('SERPAPI_API_KEY tanımlı değil (.env dosyasını kontrol et)')
  }

  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine', 'google_trends')
  url.searchParams.set('q', seriesName)
  url.searchParams.set('data_type', 'GEO_MAP_0')
  url.searchParams.set('geo', iso2.toUpperCase())
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

  const byRegion = (data.interest_by_region || [])
    .map((r) => ({ region: r.location || r.geo, value: r.extracted_value ?? r.value }))
    .filter((r) => r.region != null && typeof r.value === 'number')
    .sort((a, b) => b.value - a.value)

  const entry = {
    queriedAt: new Date().toISOString(),
    byRegion,
  }

  insertStmt.run(key, seriesName, iso2.toUpperCase(), entry.queriedAt, JSON.stringify(byRegion))

  return { ...entry, fromCache: false }
}
