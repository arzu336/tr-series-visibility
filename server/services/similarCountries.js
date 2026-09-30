import { getCountryMeta, getGdpPerCapita } from '../control-matching.js'

// "Benzer ülke" — deneysel hibrit tanım (bkz. methodologyNotes.SIMILAR_COUNTRY_NOTE):
//   aday havuzu : aynı Dünya Bankası bölgesi VEYA aynı gelir grubu (meta yoksa herkes aday)
//   sıralama    : tema dağılımı payları arası kosinüs benzerliği × güven çarpanı
//   güven       : min(1, seriesCount / CONFIDENCE_FULL_AT) — küçük katalogda tema payı gürültülü
// Türkiye (kaynak ülke) ve proxy (yayın verisi olmayan) ülkeler asla aday değildir.

export const SOURCE_COUNTRY = 'TR'
export const CONFIDENCE_FULL_AT = 20
export const MIN_SERIES_FOR_CANDIDATE = 3

export function themeShares(themeScores) {
  const entries = Object.entries(themeScores || {}).filter(([, v]) => Number.isFinite(v) && v > 0)
  const total = entries.reduce((s, [, v]) => s + v, 0)
  if (total <= 0) return {}
  return Object.fromEntries(entries.map(([k, v]) => [k, v / total]))
}

export function cosineSimilarity(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  let dot = 0
  let na = 0
  let nb = 0
  for (const k of keys) {
    const x = a[k] || 0
    const y = b[k] || 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function round3(n) {
  return Math.round(n * 1000) / 1000
}

function sortCandidates(list) {
  list.sort(
    (a, b) =>
      b.similarity - a.similarity ||
      (a.gdpDistance ?? Number.POSITIVE_INFINITY) - (b.gdpDistance ?? Number.POSITIVE_INFINITY) ||
      b.seriesCount - a.seriesCount ||
      a.iso2.localeCompare(b.iso2)
  )
  return list
}

/**
 * @param {string} iso2
 * @param {Array} countries  getEnrichedVisibility().data.countries
 * @param {object} [opts]    k, meta (World Bank ülke meta), gdp — testte enjekte edilir
 */
export async function findSimilarCountries(iso2, countries, opts = {}) {
  const k = opts.k ?? 5
  const target = countries.find((c) => c.iso2 === iso2)
  if (!target || target.dataSource === 'proxy') {
    return { target: iso2, candidates: [], pool: 'yok', note: 'hedef ülkenin yayın verisi yok' }
  }

  let meta = opts.meta
  let gdp = opts.gdp
  if (meta === undefined) {
    try {
      ;[meta, gdp] = await Promise.all([getCountryMeta(), getGdpPerCapita()])
    } catch {
      meta = null
      gdp = null
    }
  }
  const targetMeta = meta?.[iso2] || null
  const targetShares = themeShares(target.themeScores)
  const targetGdp = gdp?.[iso2]

  // Aday havuzu: ÖNCE aynı bölge. Aynı bölgede k'dan az aday varsa aynı gelir grubundan
  // tamamlanır. (Eski "bölge VEYA gelir" havuzu Brezilya için Makedonya/Bosna döndürüyordu —
  // GSYH yakınlığı bölgeden bağımsız eşleşme üretiyor.) Meta yoksa herkes aday.
  const puanla = (c) => {
    const reasons = []
    const cm = meta?.[c.iso2] || null
    if (targetMeta && cm) {
      if (cm.region && cm.region === targetMeta.region) reasons.push('aynı bölge')
      if (cm.incomeLevel && cm.incomeLevel === targetMeta.incomeLevel) reasons.push('aynı gelir grubu')
    }
    const cg = gdp?.[c.iso2]
    const gdpDistance = targetGdp && cg ? Math.abs(Math.log(targetGdp) - Math.log(cg)) : Number.POSITIVE_INFINITY
    if (Number.isFinite(gdpDistance) && gdpDistance < 0.5) reasons.push('benzer kişi başı GSYH')

    const themeSimilarity = cosineSimilarity(targetShares, themeShares(c.themeScores))
    const confidence = Math.min(1, (c.seriesCount || 0) / CONFIDENCE_FULL_AT)
    const similarity = themeSimilarity * confidence
    // Eşitlik kırıcı: tema dağılımı katalog büyüklüğüyle korelasyonlu olduğu için (r≈0,97) kosinüs
    // sık sık 1,0'a doyar; GSYH yakınlığı ve katalog büyüklüğü, benzerlik eşitken ayrım sağlar.
    if (themeSimilarity > 0.5) reasons.push(`tema benzerliği ${round3(themeSimilarity)}`)
    if (confidence < 1) reasons.push(`katalog küçük (${c.seriesCount} dizi), güven ${round3(confidence)}`)
    return {
      iso2: c.iso2,
      similarity: round3(similarity),
      themeSimilarity: round3(themeSimilarity),
      confidence: round3(confidence),
      gdpDistance: Number.isFinite(gdpDistance) ? round3(gdpDistance) : null,
      seriesCount: c.seriesCount || 0,
      reasons,
    }
  }

  const eligible = countries.filter(
    (c) =>
      c.iso2 !== iso2 &&
      c.iso2 !== SOURCE_COUNTRY &&
      c.dataSource !== 'proxy' &&
      (c.seriesCount || 0) >= MIN_SERIES_FOR_CANDIDATE
  )

  let pool = 'tumu'
  let scored
  if (targetMeta) {
    const sameRegion = eligible.filter((c) => meta?.[c.iso2]?.region && meta[c.iso2].region === targetMeta.region)
    const sameIncome = eligible.filter(
      (c) =>
        !sameRegion.includes(c) && meta?.[c.iso2]?.incomeLevel && meta[c.iso2].incomeLevel === targetMeta.incomeLevel
    )
    const regionScored = sameRegion.map(puanla)
    sortCandidates(regionScored)
    if (regionScored.length >= k) {
      scored = regionScored
      pool = 'bolge'
    } else {
      const incomeScored = sameIncome.map(puanla)
      sortCandidates(incomeScored)
      scored = [...regionScored, ...incomeScored.slice(0, k - regionScored.length)]
      pool = 'bolge+gelir'
    }
  } else {
    scored = eligible.map(puanla)
    sortCandidates(scored)
  }

  return {
    target: iso2,
    candidates: scored.slice(0, k),
    pool,
    note:
      pool === 'bolge'
        ? 'aday havuzu: aynı Dünya Bankası bölgesi; sıralama: tema benzerliği × katalog güveni'
        : pool === 'bolge+gelir'
          ? 'aynı bölgede yeterli aday yok; kalan yerler aynı gelir grubundan tamamlandı'
          : 'Dünya Bankası meta verisi yok — aday havuzu daraltılamadı, yalnızca tema benzerliği kullanıldı',
  }
}
