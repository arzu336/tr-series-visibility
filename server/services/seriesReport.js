import db from '../db.js'
import { getCached, setCached } from '../cache.js'
import { getEnrichedVisibility } from '../data-pipeline.js'
import { getImdbDataForTmdbSeries } from '../imdb.js'
import { direktifIceriyorMu } from '../llm.js'
import { countriesOfLanguage } from '../../src/lib/langCountries.js'
import { getAllOwnRankings } from './charts.js'
import { buildWikiInterest } from './countryReport.js'
import { getSeriesEnrichment } from './pipelineData.js'
import countryNames from '../../src/data/country-centroids.json' with { type: 'json' }

// Dizi raporu (sözleşme dizi-raporu-v1) — öncelikli okur dağıtımcılar ve yurt dışı temsilcilikler: dizi nerede
// izleniyor, ilgi olup yayında olmadığı pazarlar nerede, nerede yayında, ne kadar ilgi var, nasıl konuşuluyor.
// Ülke brifingiyle aynı biçim (özet kartı → başlıklar) ve aynı kurallar: kaynak adı yok, hesaplanamayan bölüm
// gösterilmez, cümleler kural tabanlı ve öneri içermez.

export const SERIES_REPORT_CONTRACT = 'dizi-raporu-v1'
const CACHE_TTL_MS = 60 * 60 * 1000
const STREAM_KEYS = ['flatrate', 'free', 'ads']
const OPPORTUNITY_MAX = 12
const LANGUAGES_SHOWN = 6

export const SERIES_CHAPTERS = [
  { key: 'izleniyor', title: 'Nerede izleniyor', sections: ['seriesMarkets'] },
  { key: 'firsat', title: 'Fırsat pazarları', sections: ['seriesOpportunity'] },
  { key: 'erisim', title: 'Nerede yayında', sections: ['seriesAvailability'] },
  { key: 'ilgi', title: 'Ne kadar ilgi var', sections: ['wikiInterest', 'seriesImdb'] },
  { key: 'gundem', title: 'Nasıl konuşuluyor', sections: ['seriesPress'] },
  { key: 'icerik', title: 'Dizi hakkında', sections: ['seriesContent'] },
]

export const SERIES_SECTION_TITLES = {
  seriesMarkets: 'Ülkelere göre sıralama',
  seriesOpportunity: 'İlgi olup yayında olmadığı ülkeler',
  seriesAvailability: 'Yayında olduğu ülkeler ve platformlar',
  wikiInterest: 'Dillere göre okunma ilgisi',
  seriesImdb: 'İzleyici puanı ve bölümler',
  seriesPress: 'Ülkelere göre basın tonu',
  seriesContent: 'Tema, destinasyonlar, ekip ve uluslararası adlar',
}

const OK = (data) => ({ status: 'hesaplandi', data })
const NONE = { status: 'hesaplanamaz' }
const ok = (s) => s?.status === 'hesaplandi'
const fmtInt = (n) => Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 0 })
const nameOf = (iso2) => countryNames[iso2]?.name || iso2
const isStreamable = (e) => STREAM_KEYS.some((k) => e?.[k]?.length)

// ---- bölümler (saf; testler veriyi doğrudan verir) ----------------------------------------------------------

/** Ülke ülke kendi sıralamamızdaki yeri: bu hafta (varsa), 52 haftada kaç hafta, en iyi sıra. */
export function buildSeriesMarkets(seriesId, rankings) {
  const rows = []
  for (const [iso2, own] of rankings) {
    const entry = (own.all || []).find((x) => x.seriesId === seriesId)
    if (!entry) continue
    const now = (own.current || []).find((x) => x.seriesId === seriesId) ?? null
    rows.push({
      iso2,
      position: now?.position ?? null,
      trend: now?.trend ?? null,
      weeks: entry.weeks,
      bestPosition: entry.bestPosition,
    })
  }
  if (!rows.length) return NONE
  rows.sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || b.weeks - a.weeks || a.bestPosition - b.bestPosition)
  return OK({ rows, countriesNow: rows.filter((r) => r.position != null).length, countries52: rows.length })
}

/**
 * Yayında olduğu ülkeler, platformlara göre gruplanmış. Platform kaydı bazı platformları tanımıyor (ör. Shahid);
 * dizinin sıralamaya girdiği ülkelerde izlenebildiği kesin olduğundan, kaydı olmayan bu ülkeler ayrı bir
 * grupta ("sıralamaya girdiği diğer ülkeler") eklenir.
 */
export function buildSeriesAvailability(providersForSeries = {}, listedIso2s = []) {
  const byPlatform = new Map()
  const countries = []
  for (const [iso2, entry] of Object.entries(providersForSeries)) {
    if (!isStreamable(entry)) continue
    countries.push(iso2)
    for (const k of STREAM_KEYS)
      for (const p of entry[k] || []) {
        const name = p.provider_name || String(p.provider_id)
        if (!byPlatform.has(name)) byPlatform.set(name, new Set())
        byPlatform.get(name).add(iso2)
      }
  }
  const byName = (a, b) => nameOf(a).localeCompare(nameOf(b), 'tr')
  const listedOnly = listedIso2s.filter((iso2) => !countries.includes(iso2)).sort(byName)
  if (!countries.length && !listedOnly.length) return NONE
  const platforms = [...byPlatform.entries()]
    .map(([name, set]) => ({ name, countries: [...set].sort(byName) }))
    .sort((a, b) => b.countries.length - a.countries.length || a.name.localeCompare(b.name, 'tr'))
  return OK({
    countryCount: countries.length + listedOnly.length,
    platforms,
    listedOnly,
    available: [...countries, ...listedOnly],
  })
}

/**
 * Fırsat: dizinin okunduğu dillerin konuşulduğu, ama dizinin izlenebildiği platform kaydı olmayan ülkeler.
 * `languageViews`: [{ lang, languageName, views }] (12 ay).
 */
export function buildSeriesOpportunity(languageViews, available, langCountries = countriesOfLanguage) {
  const availableSet = new Set(available)
  const rows = []
  for (const l of languageViews) {
    const spec = langCountries(l.lang)
    if (!spec) continue
    for (const iso2 of spec.iso) {
      if (availableSet.has(iso2) || iso2 === 'TR' || !countryNames[iso2]) continue
      rows.push({ iso2, lang: l.lang, languageName: l.languageName, views: l.views, shared: Boolean(spec.regional) })
    }
  }
  if (!rows.length) return NONE
  // Aynı ülke birden çok dilde çıkarsa en çok okunan dil kalır.
  const best = new Map()
  for (const r of rows) if (!best.has(r.iso2) || r.views > best.get(r.iso2).views) best.set(r.iso2, r)
  const all = [...best.values()]
  // Ülkeye özgü diller tek tek; ortak diller (aynı okunma sayısı her ülke için tekrar etmesin) dil başına tek satır.
  const own = all.filter((r) => !r.shared).sort((a, b) => b.views - a.views)
  const sharedByLang = new Map()
  for (const r of all.filter((x) => x.shared)) {
    if (!sharedByLang.has(r.lang))
      sharedByLang.set(r.lang, { lang: r.lang, languageName: r.languageName, views: r.views, countries: [] })
    sharedByLang.get(r.lang).countries.push(r.iso2)
  }
  const shared = [...sharedByLang.values()].sort((a, b) => b.views - a.views)
  return OK({ rows: own.slice(0, OPPORTUNITY_MAX), shared, total: all.length })
}

export function buildSeriesPress(rows) {
  const usable = rows.filter((r) => r.dominant_sentiment && r.dominant_sentiment !== 'yetersiz-veri')
  if (!usable.length) return NONE
  const items = usable
    .map((r) => ({
      iso2: r.country_iso2,
      tone: r.override_sentiment || r.dominant_sentiment,
      positive: r.positive_score,
      negative: r.negative_score,
      newsCount: r.total_news_count,
    }))
    .sort((a, b) => (b.newsCount ?? 0) - (a.newsCount ?? 0))
  return OK({ items, positiveCount: items.filter((i) => /olumlu|positive/i.test(i.tone)).length })
}

function groupAkas(localized = [], turkishName) {
  const fold = (t) =>
    String(t || '')
      .toLocaleLowerCase('tr')
      .replace(/[çğıöşüâîû]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' })[c])
      .replace(/[^\p{L}\p{N}]+/gu, '')
  const own = fold(turkishName)
  const by = new Map()
  for (const { region, title } of localized) {
    if (region === 'TR' || fold(title) === own) continue
    if (!by.has(title)) by.set(title, [])
    by.get(title).push(region)
  }
  return [...by.entries()]
    .map(([title, regions]) => ({ title, regions }))
    .sort((a, b) => b.regions.length - a.regions.length)
    .slice(0, 8)
}

export function buildSeriesContent({ theme, destinations, crew, localized, name }) {
  const akas = groupAkas(localized, name)
  const data = {
    theme: theme ?? null,
    destinations: destinations || [],
    directors: (crew?.directors || []).map((d) => d.name),
    writers: (crew?.writers || []).map((w) => w.name),
    akas,
  }
  const empty =
    !data.theme && !data.destinations.length && !data.directors.length && !data.writers.length && !akas.length
  return empty ? NONE : OK(data)
}

// ---- özet ------------------------------------------------------------------------------------------------

export function buildSeriesSummary(sections) {
  const {
    seriesMarkets: m,
    seriesAvailability: a,
    seriesImdb: i,
    seriesOpportunity: o,
    wikiInterest: w,
    seriesPress: p,
  } = sections
  const kpis = [
    {
      key: 'available',
      label: 'Yayında',
      value: ok(a) ? `${a.data.countryCount} ülke` : '—',
      detail: ok(a) ? `${a.data.platforms.length} platformda` : null,
      trend: null,
    },
    {
      key: 'rankedNow',
      label: 'Bu hafta sıralamada',
      value: ok(m) ? `${m.data.countriesNow} ülke` : '0 ülke',
      detail: ok(m) ? `son 52 haftada ${m.data.countries52} ülke` : null,
      trend: null,
    },
    {
      key: 'opportunity',
      label: 'Fırsat pazarı',
      value: ok(o) ? `${o.data.total} ülke` : '—',
      detail: ok(o) ? 'ilgi var, yayında değil' : null,
      trend: null,
    },
    {
      key: 'rating',
      label: 'İzleyici puanı',
      value: ok(i) && i.data.rating != null ? String(i.data.rating).replace('.', ',') : '—',
      detail: ok(i) && i.data.votes != null ? `${fmtInt(i.data.votes)} oy` : null,
      trend: ok(i) && i.data.growth7?.votes > 0 ? 'up' : null,
    },
  ]

  const cumleler = []
  if (ok(m)) {
    const now = m.data.rows.filter((r) => r.position != null)
    if (now.length) {
      const best = now[0]
      cumleler.push({
        basis: 'markets',
        text: `Bu hafta ${now.length} ülkede sıralamada; en iyi yeri ${nameOf(best.iso2)} (${best.position}.).`,
      })
    } else {
      const longest = [...m.data.rows].sort((x, y) => y.weeks - x.weeks)[0]
      cumleler.push({
        basis: 'markets',
        text: `Son 52 haftada ${m.data.countries52} ülkede sıralamaya girdi; en uzun ${nameOf(longest.iso2)} (${longest.weeks} hafta).`,
      })
    }
  }
  if (ok(o)) {
    const top = o.data.rows[0]
    cumleler.push({
      basis: 'opportunity',
      text: top
        ? `İlgi olup yayında olmadığı ${o.data.total} ülke var; ülkeye özgü dillerde en yüksek okunma ${nameOf(top.iso2)} (${top.languageName}).`
        : `İlgi olup yayında olmadığı ${o.data.total} ülke var (ortak dillerde).`,
    })
  }
  if (ok(w) && w.data.languages.length) {
    const top = [...w.data.languages].sort(
      (x, y) => y.months.reduce((s, v) => s + v.views, 0) - x.months.reduce((s, v) => s + v.views, 0)
    )[0]
    cumleler.push({ basis: 'wiki', text: `En çok okunduğu yabancı dil ${top.languageName} (son 12 ay).` })
  }
  if (ok(i) && i.data.rating != null) {
    const g = i.data.growth7
    cumleler.push({
      basis: 'imdb',
      text: `İzleyici puanı ${String(i.data.rating).replace('.', ',')} (${fmtInt(i.data.votes)} oy)${g?.votes > 0 ? `; son ${g.days} günde ${fmtInt(g.votes)} yeni oy` : ''}.`,
    })
  }
  if (ok(p)) {
    cumleler.push({
      basis: 'press',
      text: `Basın tonu ölçülen ${p.data.items.length} ülkenin ${p.data.positiveCount}'inde olumlu.`,
    })
  }
  return { kpis, sentences: cumleler.filter((c) => !direktifIceriyorMu(c.text)).slice(0, 4), caveat: null }
}

// ---- toplama ----------------------------------------------------------------------------------------------

function readLanguageRows(seriesId) {
  return db
    .prepare('SELECT lang, tmdb_id, year, month, views FROM series_language_interest WHERE tmdb_id = ?')
    .all(seriesId)
}

function readClassification(seriesId) {
  let theme = null
  let destinations = []
  try {
    theme = db.prepare('SELECT theme FROM theme_classifications WHERE id = ?').get(seriesId)?.theme ?? null
    const d = db
      .prepare('SELECT human_tags_destinations AS h, auto_detected AS a FROM destination_classifications WHERE id = ?')
      .get(seriesId)
    destinations = JSON.parse(d?.h || d?.a || '[]')
  } catch {
    // sınıflandırma tabloları yoksa boş
  }
  return { theme: theme === 'diğer' ? null : theme, destinations }
}

export async function buildSeriesReport(seriesId, { useCache = true, deps = {} } = {}) {
  const id = Number(seriesId)
  const cacheKey = `report:series:v2:${id}`
  if (useCache) {
    const cached = getCached(cacheKey)
    if (cached) return cached
  }
  const { raw } = await (deps.getEnrichedVisibility || getEnrichedVisibility)()
  const series = raw.series.find((s) => s.id === id)
  if (!series) return null

  const rankings = await (deps.getAllOwnRankings || getAllOwnRankings)()
  const seriesMarkets = buildSeriesMarkets(id, rankings)
  const seriesAvailability = buildSeriesAvailability(
    raw.providersById[id] || {},
    ok(seriesMarkets) ? seriesMarkets.data.rows.map((r) => r.iso2) : []
  )

  // Okunma: dizinin okunduğu yabancı diller (ortak diller işaretli), en çok okunan ilk 6. Türkçe yurt içi
  // ilgiyi gösterdiği için dağıtımcıya bilgi taşımaz; dışarıda bırakılır.
  const langRows = (deps.readLanguageRows || readLanguageRows)(id).filter((r) => r.lang !== 'tr')
  const langs = [...new Set(langRows.map((r) => r.lang))].map((lang) => ({
    lang,
    regional: Boolean(countriesOfLanguage(lang)?.regional),
  }))
  const wikiFull = buildWikiInterest(langs, langRows, () => series.name, { now: deps.now ? deps.now() : new Date() })
  let wikiInterest = NONE
  let languageViews = []
  if (ok(wikiFull)) {
    const languages = wikiFull.data.languages
      .map((l) => ({ ...l, top: [], total: l.months.reduce((s, v) => s + v.views, 0) }))
      .sort((a, b) => b.total - a.total)
    languageViews = languages.map((l) => ({ lang: l.lang, languageName: l.languageName, views: l.total }))
    wikiInterest = OK({ ...wikiFull.data, languages: languages.slice(0, LANGUAGES_SHOWN), primary: null })
  }
  const seriesOpportunity = buildSeriesOpportunity(
    languageViews,
    ok(seriesAvailability) ? seriesAvailability.data.available : []
  )

  const imdb = await (deps.getImdb || getImdbDataForTmdbSeries)(id).catch(() => null)
  const enrichment = (deps.getSeriesEnrichment || getSeriesEnrichment)(id)
  const seriesImdb =
    imdb?.status === 'ready' || enrichment?.imdb?.seasons?.length
      ? OK({
          rating: imdb?.rating ?? null,
          votes: imdb?.votes ?? null,
          growth7: imdb?.votesGrowth?.d7 ?? null,
          seasons: enrichment?.imdb?.seasons || [],
        })
      : NONE

  const pressRows = (
    deps.readPressRows || ((sid) => db.prepare('SELECT * FROM media_sentiment WHERE series_id = ?').all(sid))
  )(id)
  const seriesPress = buildSeriesPress(pressRows)
  const seriesContent = buildSeriesContent({
    ...(deps.readClassification || readClassification)(id),
    crew: enrichment?.imdb?.crew,
    localized: enrichment?.imdb?.localizedTitles,
    name: series.name,
  })

  const sections = {
    seriesMarkets,
    seriesOpportunity,
    seriesAvailability,
    wikiInterest,
    seriesImdb,
    seriesPress,
    seriesContent,
  }
  const chapters = []
  for (const ch of SERIES_CHAPTERS) {
    const secs = ch.sections
      .filter((k) => ok(sections[k]))
      .map((k) => ({ key: k, title: SERIES_SECTION_TITLES[k], data: sections[k].data, caveat: null }))
    if (secs.length) chapters.push({ key: ch.key, title: ch.title, sections: secs })
  }
  const anyWeek = [...rankings.values()][0]?.to ?? null
  const report = {
    seriesId: id,
    seriesName: series.name,
    posterPath: series.posterPath ?? null,
    title: 'Dizi raporu',
    generatedAt: (deps.now ? deps.now() : new Date()).toISOString(),
    week: anyWeek,
    isTracked: true,
    summary: buildSeriesSummary(sections),
    chapters,
    contract: SERIES_REPORT_CONTRACT,
  }
  if (useCache) setCached(cacheKey, report, CACHE_TTL_MS)
  return report
}
