import db from '../db.js'
import { getCached, setCached } from '../cache.js'
import { getEnrichedVisibility } from '../data-pipeline.js'
import { getCountryDemographics } from './countryDemographics.js'
import { getPipelineDb } from './pipelineDb.js'
import { resolveIso2FromLabel } from './countryLookup.js'
import { LANG_COUNTRIES, languagesOfCountry } from '../../src/lib/langCountries.js'

// "İzlenme sinyali" (0–100): ülke bazında gerçek izlenme sayısı kamuya açık değil; bu endeks eldeki
// gerçek ilgi/izlenme izlerini birleştirir ve neye dayandığını her ülke için yazar.
//   netflix : son 52 haftada Netflix Top 10 (TV) — Σ(11 − sıra); pazar olan ülkede 0 da bir değerdir
//   wiki    : dizi Wikipedia makalelerinin son 12 ay okunması, dil → ülke (langCountries), milyon
//             internet kullanıcısı başına; çok ülkeli dil "bölgesel" (ağırlık ×0,5)
//   search  : Google Trends ülke kırılımı (yalnızca önbellek: trends_cache Türkçe ad + search_signal_cache
//             yerel ad); değer = ilgisi ölçülen dizi payı (göreli ölçek yanlılığına dayanıklı)
//   press   : haber hacmi — yalnızca açıklayıcı (ağırlık 0): tarama kapsamı erişimle korele
// Her bileşen kendi kapsamında yüzdelik sıra; ağırlıklı ortalama; sonuç sinyali olan ülkeler arasında
// yüzdelik. En az 2 bileşen; Türkiye (kaynak ülke) evren dışı. Uydurma/sentetik veri yok.

export const SOURCE_COUNTRY = 'TR'
export const WEIGHTS = { netflix: 0.5, wiki: 0.3, search: 0.2, press: 0 }
export const REGIONAL_FACTOR = 0.5
export const MIN_COMPONENTS = 2
export const OPPORTUNITY_THRESHOLD = 50
export const NETFLIX_WINDOW_WEEKS = 52
export const WIKI_WINDOW_MONTHS = 12
// Lineer TV uyarısı (veriden türetilir, elle ülke listesi yok): IMDb yerel başlık dağıtımı güçlü
// (yüzdelik ≥60) ve Netflix'ten en az 30 yüzdelik puan önde (ya da Netflix pazarı değil) ve ülkede
// en az bir ilgi sinyali (Wikipedia ya da arama yüzdeliği ≥40) varsa: dizi dağıtılmış ve ilgi var ama
// Netflix'te görünmüyor → izlenme lineer TV/diğer kanallarda olabilir. İlgi koşulu, yalnızca IMDb
// kaydı olan pazarları (JP, KR gibi) uyarıdan ayırır.
export const LINEAR_TV_DISTRIBUTION_MIN_P = 60
export const LINEAR_TV_GAP_MIN_P = 30
export const LINEAR_TV_INTEREST_MIN_P = 40
export const CACHE_KEY = 'watch-signal:v2'
export const CACHE_TTL_MS = 60 * 60 * 1000
// IMDb "yerel başlık" sayımında dışlanan İngilizce pazarlar: buradaki AKA'lar çeviri değil İngilizce ad.
export const ENGLISH_AKA_REGIONS = new Set([
  'US',
  'GB',
  'CA',
  'AU',
  'IE',
  'NZ',
  'XWW',
  'IN',
  'ZA',
  'PH',
  'SG',
  'NG',
  'KE',
])

export const LEVELS = [
  [80, 'Çok yüksek'],
  [60, 'Yüksek'],
  [40, 'Orta'],
  [20, 'Düşük'],
  [0, 'Çok düşük'],
]

const round1 = (n) => Math.round(n * 10) / 10

/** Eşit değerler ortalama sıra alır; tek eleman 50. [[key, value]] → Map key → 0..100 */
export function percentileRank(entries) {
  const sorted = [...entries].sort((a, b) => a[1] - b[1])
  const n = sorted.length
  const out = new Map()
  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && sorted[j + 1][1] === sorted[i][1]) j++
    const p = n === 1 ? 50 : ((i + j) / 2 / (n - 1)) * 100
    for (let k = i; k <= j; k++) out.set(sorted[k][0], p)
    i = j + 1
  }
  return out
}

export function levelOf(index) {
  if (index == null) return null
  for (const [min, label] of LEVELS) if (index >= min) return label
  return 'Çok düşük'
}

/** yüksek: ≥3 bileşen ve içinde Netflix ya da tek dilli Wikipedia; orta: 2 bileşen; düşük: tek bileşen. */
export function confidenceOf(comps) {
  const n = comps.length
  if (n === 0) return null
  const guclu = comps.some((c) => c.key === 'netflix' || (c.key === 'wiki' && !c.regional))
  if (n >= 3 && guclu) return 'yüksek'
  if (n >= 2) return 'orta'
  return 'düşük'
}

export function opportunityOf(index, accessP, hasAccessData) {
  if (index == null) return hasAccessData ? 'İzlenme sinyali yok (yalnızca erişim verisi)' : 'İzlenme sinyali yok'
  if (!hasAccessData)
    return index >= OPPORTUNITY_THRESHOLD ? 'Fırsat (yayın verisi yok)' : 'Girilmemiş (yayın verisi yok)'
  const yuksekSinyal = index >= OPPORTUNITY_THRESHOLD
  const yuksekErisim = accessP >= OPPORTUNITY_THRESHOLD
  if (yuksekSinyal && yuksekErisim) return 'Oturmuş pazar'
  if (yuksekSinyal) return 'Fırsat'
  if (yuksekErisim) return 'Doymuş'
  return 'Girilmemiş'
}

function medianOf(values) {
  const s = [...values].sort((a, b) => a - b)
  if (s.length === 0) return null
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

// ----------------------------------------------------------------------------------------------
// Saf hesap: girdiler Map/Set olarak gelir (testler doğrudan bunu çağırır)
// inputs = { countries, netflix, markets, wiki, search, press, distribution }
export function computeWatchSignals(inputs, opts = {}) {
  const weights = { ...WEIGHTS, ...(opts.weights || {}) }
  const minComponents = opts.minComponents ?? MIN_COMPONENTS
  const regionalFactor = opts.regionalFactor ?? REGIONAL_FACTOR
  const {
    countries,
    netflix = new Map(),
    markets = new Set(),
    wiki = new Map(),
    search = new Map(),
    press = new Map(),
    distribution = new Map(),
  } = inputs

  const universe = countries.filter((c) => c.iso2 !== SOURCE_COUNTRY)
  const isos = universe.map((c) => c.iso2)
  const byIso = new Map(universe.map((c) => [c.iso2, c]))

  const netflixP = percentileRank(isos.filter((i) => markets.has(i)).map((i) => [i, netflix.get(i)?.points || 0]))
  const wikiP = percentileRank(isos.filter((i) => wiki.has(i)).map((i) => [i, wiki.get(i).value]))
  const searchP = percentileRank(
    isos
      .filter((i) => search.has(i))
      .map((i) => [i, search.get(i).hitShare * 100 + (search.get(i).meanValue || 0) / 100])
  )
  const pressP = percentileRank(isos.filter((i) => press.has(i)).map((i) => [i, press.get(i).news]))
  const distP = percentileRank(isos.filter((i) => distribution.has(i)).map((i) => [i, distribution.get(i).titles]))
  const accessP = percentileRank(
    isos.filter((i) => byIso.get(i).dataSource !== 'proxy').map((i) => [i, byIso.get(i).seriesCount || 0])
  )
  const wikiMedian = medianOf([...wikiP.keys()].map((i) => wiki.get(i).value))

  const scored = []
  const rows = new Map()
  for (const iso of isos) {
    const comps = []
    if (netflixP.has(iso)) comps.push({ key: 'netflix', p: netflixP.get(iso), w: weights.netflix })
    if (wikiP.has(iso)) {
      const w = wiki.get(iso)
      comps.push({
        key: 'wiki',
        p: wikiP.get(iso),
        w: weights.wiki * (w.regional ? regionalFactor : 1),
        regional: w.regional,
      })
    }
    if (searchP.has(iso)) comps.push({ key: 'search', p: searchP.get(iso), w: weights.search })
    if (pressP.has(iso) && weights.press > 0) comps.push({ key: 'press', p: pressP.get(iso), w: weights.press })
    const wsum = comps.reduce((s, c) => s + c.w, 0)
    const score = comps.length >= minComponents && wsum > 0 ? comps.reduce((s, c) => s + c.p * c.w, 0) / wsum : null
    if (score != null) scored.push([iso, score])
    rows.set(iso, { comps, score })
  }
  const indexP = percentileRank(scored)

  const byIso2 = {}
  for (const iso of isos) {
    const c = byIso.get(iso)
    const { comps, score } = rows.get(iso)
    const index = indexP.has(iso) ? Math.round(indexP.get(iso)) : null
    const n = netflix.get(iso)
    const w = wiki.get(iso)
    const s = search.get(iso)
    const pr = press.get(iso)
    const d = distribution.get(iso)
    const hasAccess = c.dataSource !== 'proxy'
    const components = {
      netflix: netflixP.has(iso)
        ? {
            present: true,
            p: Math.round(netflixP.get(iso)),
            series: n?.series ?? 0,
            weeks: n?.weeks ?? 0,
            points: n?.points ?? 0,
            bestRank: n?.bestRank ?? null,
          }
        : { present: false, reason: 'Netflix bu ülke için Top 10 yayımlamıyor' },
      wiki: wikiP.has(iso)
        ? {
            present: true,
            p: Math.round(wikiP.get(iso)),
            perMillionInternetUsers: round1(w.value),
            regional: w.regional,
            langs: w.langs,
            vsMedian: wikiMedian ? round1(w.value / wikiMedian) : null,
          }
        : { present: false, reason: 'bu ülkeye eşlenen dilde Wikipedia okunma verisi yok' },
      search: searchP.has(iso)
        ? {
            present: true,
            p: Math.round(searchP.get(iso)),
            seriesWithInterest: s.seriesWithInterest,
            seriesQueried: s.seriesQueried,
            meanValue: round1(s.meanValue),
            localTitleHits: s.localTitleHits ?? 0,
          }
        : { present: false, reason: 'önbellekte bu ülke için arama ilgisi yok' },
      press: pr
        ? { present: true, descriptive: true, p: Math.round(pressP.get(iso)), news: pr.news, scans: pr.scans }
        : { present: false, descriptive: true, reason: 'basın taraması yapılmadı' },
    }
    const dist = d ? { titles: d.titles, p: Math.round(distP.get(iso)) } : null
    const warnings = []
    const netflixGap = !components.netflix.present || dist?.p - components.netflix.p >= LINEAR_TV_GAP_MIN_P
    const ilgiVar =
      (components.wiki.present && components.wiki.p >= LINEAR_TV_INTEREST_MIN_P) ||
      (components.search.present && components.search.p >= LINEAR_TV_INTEREST_MIN_P)
    if (dist && dist.p >= LINEAR_TV_DISTRIBUTION_MIN_P && netflixGap && ilgiVar) {
      warnings.push({
        code: 'linear-tv',
        text: `Bu ülkede ${dist.titles} Türk dizisi yerel adla dağıtılmış (IMDb yerel başlık; yüzdelik konum ${dist.p}/100) ama Netflix Top 10'da ${components.netflix.present ? 'zayıf' : 'ölçülemiyor'}: izlenme ağırlıkla lineer TV ya da diğer kanallarda olabilir; endeks bunu görmez.`,
      })
    }
    if (components.wiki.present && components.wiki.regional) {
      warnings.push({
        code: 'regional-wiki',
        text: `Wikipedia sinyali ortak dile dayanır (${w.langs.join(', ')}); okunma bu ülkeye ayrılamaz.`,
      })
    }
    if (index == null && comps.length === 1) {
      warnings.push({
        code: 'single-source',
        text: `Tek kaynak (${comps[0].key}); endeks için en az ${minComponents} bileşen gerekir.`,
      })
    }
    // Tek kaynaklı ülke (2026-10-06): endeks yok (en az iki kaynak kuralı değişmedi), ama o tek kaynağın yüzdelik
    // konumundan ayrı işaretli bir tahmini düzey verilir — harita taralı/soluk gösterir. Sıralamaya, dağılıma ve
    // brifinge girmez; yalnızca `provisional` alanında taşınır.
    const tekKaynak = index == null && comps.length === 1 ? Math.round(comps[0].p) : null
    byIso2[iso] = {
      index,
      level: levelOf(index),
      provisional: tekKaynak == null ? null : { index: tekKaynak, level: levelOf(tekKaynak), source: comps[0].key },
      confidence: index == null ? null : confidenceOf(comps),
      componentCount: comps.length,
      components,
      distribution: dist,
      access: hasAccess ? { p: Math.round(accessP.get(iso)), seriesCount: c.seriesCount || 0 } : null,
      opportunity: opportunityOf(index, hasAccess ? accessP.get(iso) : null, hasAccess),
      reason: reasonLine({
        netflix: components.netflix,
        wiki: components.wiki,
        search: components.search,
        press: components.press,
      }),
      warnings,
      score: score == null ? null : round1(score),
    }
  }
  return {
    byIso2,
    meta: {
      universe: isos.length,
      indexed: scored.length,
      weights,
      minComponents,
      regionalFactor,
      coverage: {
        netflix: netflixP.size,
        wiki: wikiP.size,
        wikiRegional: [...wikiP.keys()].filter((i) => wiki.get(i).regional).length,
        search: searchP.size,
        press: pressP.size,
        distribution: distP.size,
        access: accessP.size,
      },
      sourceCountry: SOURCE_COUNTRY,
    },
  }
}

export function reasonLine({ netflix, wiki, search, press }) {
  const parts = []
  if (netflix?.present) {
    parts.push(
      netflix.weeks > 0
        ? `Netflix Top 10: ${netflix.series} dizi, ${netflix.weeks} hafta, en iyi sıra ${netflix.bestRank}`
        : 'Netflix Top 10: son 52 haftada Türk dizisi yok'
    )
  }
  if (wiki?.present) {
    parts.push(
      `Wikipedia okunması (${wiki.langs.join(', ')}${wiki.regional ? ', ortak dil' : ''}) medyanın ${wiki.vsMedian ?? '?'} katı`
    )
  }
  if (search?.present)
    parts.push(`arama ilgisi ${search.seriesQueried} diziden ${search.seriesWithInterest}'inde ölçülebilir`)
  if (press?.present) parts.push(`basın: ${press.news} haber`)
  return parts.join('; ')
}

// ----------------------------------------------------------------------------------------------
// Girdi dönüştürücüler (saf; ham satır listesi alır)

/** netflix_weekly_ranks satırları → ülke × pencere özeti. rows: {country_iso2, week, tmdb_id, rank} */
export function netflixFromRows(rows, cutoffWeek) {
  const out = new Map()
  for (const r of rows) {
    if (r.week < cutoffWeek) continue
    const c = out.get(r.country_iso2) || { seriesIds: new Set(), weeks: 0, points: 0, bestRank: 11 }
    c.seriesIds.add(r.tmdb_id)
    c.weeks += 1
    c.points += 11 - r.rank
    c.bestRank = Math.min(c.bestRank, r.rank)
    out.set(r.country_iso2, c)
  }
  for (const c of out.values()) {
    c.series = c.seriesIds.size
    delete c.seriesIds
  }
  return out
}

/** ISO haftası (Pazar) — bugünden N hafta önce, YYYY-MM-DD */
export function cutoffWeekBefore(now, weeks) {
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() - weeks * 7)
  return d.toISOString().slice(0, 10)
}

/** series_language_interest satırları {lang, views} (pencere içi toplam) → ülke değeri (okunma / milyon internet kullanıcısı). */
export function wikiFromRows(langRows, demographics, langMap = LANG_COUNTRIES) {
  const out = new Map()
  const denom = (iso) => {
    const d = demographics?.[iso]
    return d?.internetUsers ?? d?.population ?? null
  }
  for (const r of langRows) {
    const spec = langMap[r.lang]
    if (!spec || !r.views) continue
    const totalUsers = spec.iso.reduce((s, i) => s + (denom(i) || 0), 0)
    if (!totalUsers) continue
    const perMillion = r.views / (totalUsers / 1e6)
    for (const iso of spec.iso) {
      if (!denom(iso)) continue
      const cur = out.get(iso) || { value: 0, regional: true, langs: [] }
      cur.value += perMillion
      cur.regional = cur.regional && spec.regional
      cur.langs.push(r.lang + (spec.regional ? '*' : ''))
      out.set(iso, cur)
    }
  }
  return out
}

/**
 * Arama satırları [{seriesKey, byCountry:[{country|iso, value}], local:boolean}] → ülke: ilgisi ölçülen dizi payı.
 * Aynı dizinin birden çok sorgusu (Türkçe ad + yerel adlar) tek dizi sayılır; ülke için en yüksek değer alınır.
 */
export function searchFromRows(rows, resolveIso = resolveIso2FromLabel) {
  const perSeries = new Map() // seriesKey → Map iso → { value, local }
  for (const r of rows) {
    const m = perSeries.get(r.seriesKey) || new Map()
    for (const it of r.byCountry || []) {
      const iso = it.iso || resolveIso(it.country)
      if (!iso) continue
      const v = Number(it.value) || 0
      const cur = m.get(iso)
      if (!cur || v > cur.value) m.set(iso, { value: v, local: Boolean(r.local) })
    }
    perSeries.set(r.seriesKey, m)
  }
  const seriesQueried = perSeries.size
  const acc = new Map()
  for (const m of perSeries.values()) {
    for (const [iso, { value, local }] of m) {
      const a = acc.get(iso) || { sum: 0, hits: 0, localHits: 0 }
      a.sum += value
      if (value > 0) {
        a.hits += 1
        if (local) a.localHits += 1
      }
      acc.set(iso, a)
    }
  }
  const out = new Map()
  for (const [iso, a] of acc) {
    out.set(iso, {
      hitShare: seriesQueried ? a.hits / seriesQueried : 0,
      meanValue: seriesQueried ? a.sum / seriesQueried : 0,
      seriesWithInterest: a.hits,
      seriesQueried,
      localTitleHits: a.localHits,
    })
  }
  return out
}

/** imdb_localized_titles × series_mapping satırları {region, tmdb_id} → ülke: yerel adla kayıtlı dizi sayısı (İngilizce pazarlar hariç). */
export function distributionFromRows(rows, englishRegions = ENGLISH_AKA_REGIONS) {
  const sets = new Map()
  for (const r of rows) {
    const region = String(r.region || '').toUpperCase()
    if (!region || englishRegions.has(region)) continue
    if (!sets.has(region)) sets.set(region, new Set())
    sets.get(region).add(r.tmdb_id)
  }
  return new Map([...sets].map(([iso, s]) => [iso, { titles: s.size }]))
}

// ----------------------------------------------------------------------------------------------
// Canlı veri toplayıcılar

/**
 * Netflix bileşeninin evreni: son 52 haftada kaynak dosyada satırı olan pazarlar (Python
 * `netflix_active_countries_52w`). Netflix'in çekildiği ülke (Rusya, son satır 2022-02-27) bu
 * pencerede yoktur → bileşen 0 değil YOK sayılır. Aktif liste yoksa (eski hat) tam pazar listesine düşer.
 */
export function pickNetflixMarkets(meta = {}) {
  const parse = (v) => {
    try {
      const list = JSON.parse(v || 'null')
      return Array.isArray(list) ? new Set(list) : null
    } catch {
      return null
    }
  }
  return parse(meta.netflix_active_countries_52w) || parse(meta.netflix_market_countries) || new Set()
}

function readNetflix(conn, now) {
  if (!conn) return { netflix: new Map(), markets: new Set(), available: false }
  let rows = []
  let markets = new Set()
  try {
    rows = conn.prepare('SELECT country_iso2, week, tmdb_id, rank FROM netflix_weekly_ranks').all()
    const meta = Object.fromEntries(
      conn
        .prepare(
          "SELECT key, value FROM pipeline_meta WHERE key IN ('netflix_market_countries','netflix_active_countries_52w')"
        )
        .all()
        .map((r) => [r.key, r.value])
    )
    markets = pickNetflixMarkets(meta)
  } catch {
    return { netflix: new Map(), markets: new Set(), available: false }
  }
  return {
    netflix: netflixFromRows(rows, cutoffWeekBefore(now, NETFLIX_WINDOW_WEEKS)),
    markets,
    available: rows.length > 0,
  }
}

function readWiki(demographics, now) {
  const d = new Date(now)
  d.setUTCMonth(d.getUTCMonth() - WIKI_WINDOW_MONTHS)
  const cutoff = d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1)
  const rows = db
    .prepare('SELECT lang, SUM(views) views FROM series_language_interest WHERE (year*100+month) > ? GROUP BY lang')
    .all(cutoff)
  return wikiFromRows(rows, demographics)
}

function readSearch(seriesIdByName) {
  const rows = []
  for (const r of db.prepare('SELECT series_name, by_country FROM trends_cache').all()) {
    try {
      rows.push({
        seriesKey: seriesIdByName.get(r.series_name) ?? `name:${r.series_name}`,
        byCountry: JSON.parse(r.by_country),
        local: false,
      })
    } catch {
      /* bozuk satır atlanır */
    }
  }
  for (const r of db.prepare('SELECT query, tmdb_id, series_name, by_country FROM search_signal_cache').all()) {
    try {
      rows.push({
        seriesKey: r.tmdb_id ?? seriesIdByName.get(r.series_name) ?? `name:${r.series_name}`,
        byCountry: JSON.parse(r.by_country),
        local: true,
      })
    } catch {
      /* bozuk satır atlanır */
    }
  }
  return searchFromRows(rows)
}

function readPress() {
  return new Map(
    db
      .prepare('SELECT country_iso2 iso, SUM(total_news_count) news, COUNT(*) scans FROM media_sentiment GROUP BY 1')
      .all()
      .map((r) => [r.iso, { news: r.news, scans: r.scans }])
  )
}

function readDistribution(conn) {
  if (!conn) return new Map()
  try {
    const rows = conn
      .prepare(
        'SELECT l.region, m.tmdb_id FROM imdb_localized_titles l JOIN series_mapping m ON m.imdb_id = l.tconst WHERE l.is_original = 0'
      )
      .all()
    return distributionFromRows(rows)
  } catch {
    return new Map()
  }
}

export async function getWatchSignals({ fresh = false, now = new Date() } = {}) {
  if (!fresh) {
    const cached = getCached(CACHE_KEY)
    if (cached) return cached
  }
  const [{ data, raw }, demographics] = await Promise.all([
    getEnrichedVisibility(),
    getCountryDemographics().catch(() => ({})),
  ])
  const conn = getPipelineDb()
  const seriesIdByName = new Map(raw.series.map((s) => [s.name, s.id]))
  const { netflix, markets, available } = readNetflix(conn, now)
  const result = computeWatchSignals({
    countries: data.countries,
    netflix,
    markets,
    wiki: readWiki(demographics, now),
    search: readSearch(seriesIdByName),
    press: readPress(),
    distribution: readDistribution(conn),
  })
  const out = {
    ...result,
    generatedAt: now.toISOString(),
    netflixWindow: { weeks: NETFLIX_WINDOW_WEEKS, from: cutoffWeekBefore(now, NETFLIX_WINDOW_WEEKS), available },
    wikiWindowMonths: WIKI_WINDOW_MONTHS,
    contract: 'izlenme-sinyali-v1',
  }
  setCached(CACHE_KEY, out, CACHE_TTL_MS)
  return out
}

/** Küresel dizi tablosu: haftalık tablodan dizi başına ülke sayısı, toplam hafta, son 52 hafta, en güçlü pazarlar. */
export async function getSeriesGlobal({ now = new Date(), top = 5 } = {}) {
  const conn = getPipelineDb()
  if (!conn) return { status: 'hesaplanamaz', reason: 'pipeline.db açılamadı', items: [] }
  let rows
  try {
    rows = conn.prepare('SELECT country_iso2, week, tmdb_id, show_title, rank FROM netflix_weekly_ranks').all()
  } catch {
    return {
      status: 'hesaplanamaz',
      reason: 'netflix_weekly_ranks tablosu yok (netflix_pipeline.py --all çalıştırılmalı)',
      items: [],
    }
  }
  const { raw } = await getEnrichedVisibility()
  const nameById = new Map(raw.series.map((s) => [s.id, s.name]))
  const cutoff = cutoffWeekBefore(now, NETFLIX_WINDOW_WEEKS)
  const agg = new Map()
  for (const r of rows) {
    const g = agg.get(r.tmdb_id) || {
      tmdbId: r.tmdb_id,
      netflixTitles: new Set(),
      countries: new Set(),
      weeks: 0,
      weeksRecent: 0,
      bestRank: 11,
      byCountry: new Map(),
      lastWeek: null,
    }
    g.netflixTitles.add(r.show_title)
    g.countries.add(r.country_iso2)
    g.weeks += 1
    if (r.week >= cutoff) g.weeksRecent += 1
    g.bestRank = Math.min(g.bestRank, r.rank)
    g.byCountry.set(r.country_iso2, (g.byCountry.get(r.country_iso2) || 0) + 1)
    if (!g.lastWeek || r.week > g.lastWeek) g.lastWeek = r.week
    agg.set(r.tmdb_id, g)
  }
  const items = [...agg.values()]
    .map((g) => ({
      tmdbId: g.tmdbId,
      name: nameById.get(g.tmdbId) || [...g.netflixTitles][0],
      netflixTitles: [...g.netflixTitles],
      countries: g.countries.size,
      weeks: g.weeks,
      weeksRecent: g.weeksRecent,
      bestRank: g.bestRank,
      lastWeek: g.lastWeek,
      topCountries: [...g.byCountry.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, top)
        .map(([iso2, weeks]) => ({ iso2, weeks })),
    }))
    .sort((a, b) => b.weeks - a.weeks)
  return {
    status: 'hesaplandi',
    source: 'Netflix Top 10 (TV), haftalık',
    recentWindow: { weeks: NETFLIX_WINDOW_WEEKS, from: cutoff },
    items,
  }
}

/** Ülke içi dizi sıralaması: son 52 hafta Netflix puanı + ülkenin dil(ler)inde Wikipedia okunması + arama isabeti. */
export async function getCountrySeries(iso2, { now = new Date() } = {}) {
  const conn = getPipelineDb()
  const { raw } = await getEnrichedVisibility()
  const nameById = new Map(raw.series.map((s) => [s.id, s.name]))
  const cutoff = cutoffWeekBefore(now, NETFLIX_WINDOW_WEEKS)
  const perSeries = new Map()
  let netflixAvailable = false
  if (conn) {
    try {
      for (const r of conn
        .prepare(
          'SELECT week, tmdb_id, show_title, rank FROM netflix_weekly_ranks WHERE country_iso2 = ? AND week >= ?'
        )
        .all(iso2, cutoff)) {
        netflixAvailable = true
        const s = perSeries.get(r.tmdb_id) || {
          tmdbId: r.tmdb_id,
          netflixTitle: r.show_title,
          weeks: 0,
          points: 0,
          bestRank: 11,
          lastWeek: null,
          wikiViews: 0,
          wikiLangs: [],
        }
        s.weeks += 1
        s.points += 11 - r.rank
        s.bestRank = Math.min(s.bestRank, r.rank)
        if (!s.lastWeek || r.week > s.lastWeek) s.lastWeek = r.week
        perSeries.set(r.tmdb_id, s)
      }
    } catch {
      /* tablo yok */
    }
  }
  const langs = languagesOfCountry(iso2)
  const d = new Date(now)
  d.setUTCMonth(d.getUTCMonth() - WIKI_WINDOW_MONTHS)
  const cutoffYm = d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1)
  for (const { lang, regional } of langs) {
    for (const r of db
      .prepare(
        'SELECT tmdb_id, SUM(views) views FROM series_language_interest WHERE lang = ? AND (year*100+month) > ? GROUP BY tmdb_id'
      )
      .all(lang, cutoffYm)) {
      const s = perSeries.get(r.tmdb_id) || {
        tmdbId: r.tmdb_id,
        netflixTitle: null,
        weeks: 0,
        points: 0,
        bestRank: null,
        lastWeek: null,
        wikiViews: 0,
        wikiLangs: [],
      }
      s.wikiViews += r.views
      s.wikiLangs.push(lang + (regional ? '*' : ''))
      perSeries.set(r.tmdb_id, s)
    }
  }
  const items = [...perSeries.values()]
    .filter((s) => nameById.has(s.tmdbId))
    .map((s) => ({ ...s, name: nameById.get(s.tmdbId), bestRank: s.bestRank === 11 ? null : s.bestRank }))
    .sort((a, b) => b.points - a.points || b.wikiViews - a.wikiViews)
  return {
    status: items.length ? 'hesaplandi' : 'hesaplanamaz',
    reason: items.length ? null : 'bu ülke için Netflix Top 10 kaydı ve eşlenen dilde Wikipedia okunması yok',
    iso2,
    netflixWindow: { weeks: NETFLIX_WINDOW_WEEKS, from: cutoff, available: netflixAvailable },
    wikiLangs: langs,
    items,
  }
}
