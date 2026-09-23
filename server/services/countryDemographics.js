import { getCached, setCached } from '../cache.js'

const EXTERNAL_TIMEOUT_MS = 15000
const WB_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CACHE_KEY = 'worldbank-demographics'

const MRV = 6

const INDICATORS = {
  population: 'SP.POP.TOTL',
  internetPct: 'IT.NET.USER.ZS',
}

async function fetchWorldBankJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`World Bank isteği başarısız (${res.status})`)
  return res.json()
}

/** Bir göstergenin ülke başına EN YENİ boş olmayan değerini çeker: { [iso2]: { value, year } } */
async function fetchLatestIndicator(indicator) {
  const data = await fetchWorldBankJson(
    `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&per_page=20000&mrv=${MRV}`
  )
  const latest = {}
  for (const row of data[1] || []) {
    if (row.value == null || !row.country?.id) continue
    const year = Number(row.date)
    if (!Number.isFinite(year)) continue
    if (!latest[row.country.id] || year > latest[row.country.id].year) {
      latest[row.country.id] = { value: row.value, year }
    }
  }
  return latest
}

async function fetchDemographicsFresh() {
  const [pop, net] = await Promise.all([
    fetchLatestIndicator(INDICATORS.population),
    fetchLatestIndicator(INDICATORS.internetPct),
  ])

  const out = {}
  for (const [iso2, popRow] of Object.entries(pop)) {
    if (!(popRow.value > 0)) continue
    const netRow = net[iso2]
    const internetPct = netRow && netRow.value > 0 ? netRow.value : null
    out[iso2] = {
      population: popRow.value,
      populationYear: popRow.year,
      internetPct,
      internetYear: internetPct != null ? netRow.year : null,
      internetUsers: internetPct != null ? (popRow.value * internetPct) / 100 : null,
    }
  }
  return out
}

let inFlight = null

/**
 * { [iso2]: { population, populationYear, internetPct, internetYear, internetUsers } }
 * Dış servis düşerse HATA FIRLATIR — çağıran (data-pipeline.js) bunu yakalayıp haritayı
 * normalizasyonsuz servis etmeye devam eder; skor hiç gösterilmemektense ham gösterilir.
 */
export async function getCountryDemographics() {
  const cached = getCached(CACHE_KEY)
  if (cached) return cached
  if (!inFlight) {
    inFlight = fetchDemographicsFresh()
      .then((demo) => {
        setCached(CACHE_KEY, demo, WB_CACHE_TTL_MS)
        return demo
      })
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}
