import { getCached, setCached } from './cache.js'

const EXTERNAL_TIMEOUT_MS = 15000

const WB_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const META_CACHE_KEY = 'worldbank-country-meta'
const GDP_CACHE_KEY = 'worldbank-gdp-per-capita'

async function fetchWorldBankJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`World Bank isteği başarısız (${res.status})`)
  return res.json()
}

async function fetchCountryMetaFresh() {
  const data = await fetchWorldBankJson('https://api.worldbank.org/v2/country?format=json&per_page=400')
  const rows = data[1] || []
  const meta = {}
  for (const row of rows) {
    if (!row.iso2Code || row.region?.id === 'NA') continue
    meta[row.iso2Code] = {
      name: row.name,
      region: row.region?.value || null,
      incomeLevel: row.incomeLevel?.value || null,
    }
  }
  return meta
}

async function fetchGdpPerCapitaFresh() {
  const data = await fetchWorldBankJson(
    'https://api.worldbank.org/v2/country/all/indicator/NY.GDP.PCAP.CD?format=json&per_page=20000&mrv=1'
  )
  const rows = data[1] || []
  const gdp = {}
  for (const row of rows) {
    if (row.value == null || !row.country?.id) continue
    gdp[row.country.id] = row.value
  }
  return gdp
}

let countryMetaInFlight = null
async function getCountryMeta() {
  const cached = getCached(META_CACHE_KEY)
  if (cached) return cached
  if (!countryMetaInFlight) {
    countryMetaInFlight = fetchCountryMetaFresh()
      .then((meta) => {
        setCached(META_CACHE_KEY, meta, WB_CACHE_TTL_MS)
        return meta
      })
      .finally(() => {
        countryMetaInFlight = null
      })
  }
  return countryMetaInFlight
}

let gdpInFlight = null
async function getGdpPerCapita() {
  const cached = getCached(GDP_CACHE_KEY)
  if (cached) return cached
  if (!gdpInFlight) {
    gdpInFlight = fetchGdpPerCapitaFresh()
      .then((gdp) => {
        setCached(GDP_CACHE_KEY, gdp, WB_CACHE_TTL_MS)
        return gdp
      })
      .finally(() => {
        gdpInFlight = null
      })
  }
  return gdpInFlight
}

export async function suggestControlCountry(targetIso2, excludeIso2Set) {
  const [meta, gdp] = await Promise.all([getCountryMeta(), getGdpPerCapita()])
  const target = meta[targetIso2]
  const targetGdp = gdp[targetIso2]
  if (!target) return null

  let best = null
  for (const [iso2, candidate] of Object.entries(meta)) {
    if (iso2 === targetIso2 || excludeIso2Set.has(iso2)) continue

    const reasons = []
    let score = 0
    if (candidate.region === target.region) {
      score += 2
      reasons.push('aynı bölge')
    }
    if (candidate.incomeLevel === target.incomeLevel) {
      score += 2
      reasons.push('aynı gelir grubu')
    }
    const candidateGdp = gdp[iso2]
    if (targetGdp && candidateGdp) {
      const logDiff = Math.abs(Math.log(targetGdp) - Math.log(candidateGdp))
      const gdpScore = Math.max(0, 2 - logDiff)
      if (gdpScore > 1) reasons.push('benzer kişi başı GSYH')
      score += gdpScore
      score += 0.01
    }

    if (!best || score > best.score) {
      best = { iso2, name: candidate.name, score, reasons }
    }
  }

  if (!best || best.reasons.length === 0) return null
  return { iso2: best.iso2, name: best.name, reason: best.reasons.join(', ') }
}
