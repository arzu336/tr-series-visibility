import { getCached } from './cache.js'
import {
  cacheFirstSerpApi,
  fetchRegionalInterestRaw,
  regionalCacheKey,
  readStoredSerpApi,
  calculateRegionalScore,
} from './services/serpApiCache.js'
import { getLocalTitle } from './services/localTitles.js'

// Bölge kırılımı yavaş değişir; gece ön doldurmayla (nightlyPrefill.js) ayda bir tazelenir (2026-10-09; önceden 7 gün).
export const REGIONAL_TTL_MS = 30 * 24 * 60 * 60 * 1000

export async function getRegionalInterest(seriesName, iso2, query = seriesName) {
  const key = regionalCacheKey(seriesName, iso2)
  const result = await cacheFirstSerpApi(key, REGIONAL_TTL_MS, () => fetchRegionalInterestRaw(seriesName, iso2, query))

  let hybridScore = null
  const rawSeries = getCached('raw-series-providers')
  const matchedSeries = rawSeries?.series?.find(
    (s) => s.name.trim().toLocaleLowerCase('tr') === seriesName.trim().toLocaleLowerCase('tr')
  )
  if (matchedSeries) {
    try {
      hybridScore = await calculateRegionalScore(matchedSeries.popularity, iso2, seriesName)
    } catch (err) {
      console.error('[regional-interest] hibrit skor hesaplanamadı:', err.message)
    }
  }

  return { ...result, hybridScore }
}

// Bir bölge kırılımı en az bu kadar bölge içermeli; tek bölge ("Meksiko: 100") dağılım göstermez.
const MIN_REGIONS = 2

/**
 * Ülkenin bölgesel ilgi adayları: bu haftaki sıralamadaki diziler, sonra ülkede yayında olanlar; en fazla 3, yerel adla.
 */
export function regionalCandidates(iso2, { data, raw, rankings }) {
  const byId = new Map(raw.series.map((s) => [s.id, s]))
  const ids = []
  for (const it of rankings.get(iso2)?.current || []) if (it.seriesId != null) ids.push(it.seriesId)
  for (const s of data.countries.find((c) => c.iso2 === iso2)?.seriesList || []) ids.push(s.id)
  return [...new Set(ids)]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, 3)
    .map((s) => ({ name: s.name, query: getLocalTitle(s.id, iso2, s.name) || s.name }))
}

/**
 * Yalnızca kayıttan okur (ücretli sorgu yok): adaylardan kaydı olan ilk anlamlı kırılım. `freshOnly`: süresi
 * dolmuş kayıt sayılmaz (gece işi tazeleme kararı için). Hiç kayıt yoksa null.
 */
export function readCountryRegionalInterest(iso2, candidates, { freshOnly = false } = {}) {
  let sawAny = false
  for (const c of candidates) {
    const r = readStoredSerpApi(regionalCacheKey(c.name, iso2))
    if (!r || (freshOnly && r.stale)) continue
    sawAny = true
    const rows = (r.byRegion || []).filter((x) => x.value > 0)
    if (rows.length >= MIN_REGIONS) return { ...r, seriesName: c.name, byRegion: rows }
  }
  return sawAny ? { byRegion: [], seriesName: null } : null
}

/**
 * Ülke panelindeki bölgesel ilgi: ülkenin öne çıkan dizileri sırayla denenir (en fazla `candidates.length`, her biri
 * 7 gün önbellekte), ilk anlamlı kırılım döner. `candidates`: [{ name, query }] — query yerel ad olabilir.
 */
export async function getCountryRegionalInterest(iso2, candidates, get = getRegionalInterest) {
  let last = null
  for (const c of candidates) {
    const r = await get(c.name, iso2, c.query || c.name)
    const rows = (r.byRegion || []).filter((x) => x.value > 0)
    last = { ...r, seriesName: c.name, byRegion: rows }
    if (rows.length >= MIN_REGIONS) return last
  }
  return last ? { ...last, byRegion: [] } : { byRegion: [], seriesName: null }
}
