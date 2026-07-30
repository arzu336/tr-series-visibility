import db from './db.js'

const CACHE_KEY = 'turkish-learning-index'
// Türkçe dizilerinin kültürel etkisini "Türkçe öğrenme ilgisi" üzerinden ölçmek için gerçek
// Google Trends arama hacmi çekilen terimler — server/serpapi.js'teki queryTrends ile aynı
// desen (google_trends engine, GEO_MAP_0, tek terim), tek fark burada dizi adı değil sabit
// 3 terim ayrı ayrı sorgulanıp birleştiriliyor (bkz. aşağıdaki not).
const SEARCH_TERMS = ['learn Turkish', 'Türkçe kursu', 'Turkish language course']

const getStmt = db.prepare('SELECT queried_at, by_country FROM turkish_learning_cache WHERE key = ?')
const insertStmt = db.prepare(`
  INSERT INTO turkish_learning_cache (key, queried_at, by_country) VALUES (?, ?, ?)
`)

async function fetchRegionInterest(term, apiKey) {
  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine', 'google_trends')
  url.searchParams.set('q', term)
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

  const byCountry = new Map()
  for (const r of data.interest_by_region || []) {
    const country = r.geo || r.location
    const value = r.extracted_value ?? r.value
    if (country != null && typeof value === 'number') byCountry.set(country, value)
  }
  return byCountry
}

// Not: SerpAPI'nin çoklu terim karşılaştırması (data_type=GEO_MAP, q="a,b,c") her bölgede
// terimler arasındaki GÖRELİ PAYI döner (bölge başına toplam ~100) — bu, ülkeler arası bir
// "hangi ülke daha çok ilgileniyor" kıyaslaması için kullanılamaz (her ülke ortalamada aynı
// ~33.3'e yakınsar). Bunun yerine 3 terimi server/serpapi.js'teki gibi AYRI AYRI sorgulayıp
// (her biri kendi 0-100 küresel skalasında), ortak çıkan ülkelerde ortalamasını alıyoruz —
// tek bir sayı üreten dürüst bir birleştirme, uydurma bir normalizasyon değil.
export async function getTurkishLearningIndex() {
  const row = getStmt.get(CACHE_KEY)
  if (row) {
    return { queriedAt: row.queried_at, byCountry: JSON.parse(row.by_country), fromCache: true }
  }

  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) {
    throw new Error('SERPAPI_API_KEY tanımlı değil (.env dosyasını kontrol et)')
  }

  const perTermResults = await Promise.all(SEARCH_TERMS.map((term) => fetchRegionInterest(term, apiKey)))

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

  insertStmt.run(CACHE_KEY, entry.queriedAt, JSON.stringify(byCountry))

  return { ...entry, fromCache: false }
}
