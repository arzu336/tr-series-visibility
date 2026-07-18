import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORE_PATH = path.join(__dirname, 'data', 'trends-store.json')

function normalizeKey(seriesName) {
  return seriesName.trim().toLocaleLowerCase('tr')
}

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8')
}

export async function queryTrends(seriesName) {
  const key = normalizeKey(seriesName)
  const store = loadStore()

  if (store[key]) {
    return { ...store[key], fromCache: true }
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

  store[key] = entry
  saveStore(store)

  return { ...entry, fromCache: false }
}
