import db from '../db.js'
import { getCached, setCached } from '../cache.js'
import { getEnrichedVisibility } from '../data-pipeline.js'
import { buildDestinationRanking, getGlobalThemeDistribution } from '../aggregate.js'
import { getThemeStore } from '../themes.js'
import { buildBenchmark } from '../benchmark.js'
import { direktifIceriyorMu } from '../llm.js'
import { getAllOwnRankings } from './charts.js'
import { buildReadingTourismOverview } from './readingTourism.js'
import { getTopOriginCountries, getForeignStudentTotals } from './foreignStudents.js'
import { getMediaSentimentSummary, getMediaSentimentByCountry } from './newsSentiment.js'
import { getTourismLeadingSignalSummary } from './tourismTrendsCollector.js'
import countryNames from '../../src/data/country-centroids.json' with { type: 'json' }

// Küresel görünüm (sözleşme kuresel-brifing-v1) — eski "Etki analizi" ekranının yerini alır. Ülke brifingi ve
// dizi raporuyla aynı biçim: özet kartı → başlıklar. Kurallar: kaynak adı yok, öneri yok, yapay zekâ yorumu
// yok (yalnızca sayılardan kural tabanlı cümleler), hesaplanamayan bölüm gösterilmez. Rapor üretimi ücretli sorgu
// yapmaz: arama verisine dayalı bölümler yalnızca önbellekteki son ölçümü kullanır.

export const GLOBAL_CONTRACT = 'kuresel-brifing-v1'
const CACHE_KEY = 'report:global:v2'
const CACHE_TTL_MS = 60 * 60 * 1000

export const GLOBAL_CHAPTERS = [
  { key: 'izleniyor', title: 'Nerede izleniyor', sections: ['globalMarkets', 'globalSeries'] },
  {
    key: 'kultur',
    title: 'Kültürel etki',
    sections: ['globalThemes', 'globalStudents', 'turkishLearning', 'globalPress'],
  },
  { key: 'turizm', title: 'Turizm', sections: ['globalDestinations', 'readingTourism', 'travelSignal'] },
  { key: 'erisim', title: 'Pazar erişimi', sections: ['globalReach', 'benchmark'] },
]

export const GLOBAL_SECTION_TITLES = {
  globalMarkets: 'Türk dizilerinin en çok sıralamaya girdiği ülkeler',
  globalSeries: 'En çok ülkede sıralamada olan diziler',
  globalThemes: 'Tema dağılımı',
  globalStudents: 'Türkiye’de okuyan uluslararası öğrenciler',
  turkishLearning: 'Türkçe öğrenme ilgisi',
  globalPress: 'Basın tonu',
  globalDestinations: 'Dizilerde öne çıkan destinasyonlar',
  readingTourism: 'Okunma ilgisi ve ziyaretçi sayısı',
  travelSignal: 'Erken seyahat ilgisi (keşif amaçlı)',
  globalReach: 'Yayın erişimi',
  benchmark: 'Karşılaştırma: Türkiye, ABD, Güney Kore, İspanya',
}

// Ek kaldırıldığı için okurun yanlış okumaması gereken tek uyarı bölümün altında kalır.
const ALWAYS_CAVEAT = { readingTourism: 'Birlikte hareket nedensellik değildir.' }

const OK = (data) => ({ status: 'hesaplandi', data })
const NONE = { status: 'hesaplanamaz' }
const ok = (s) => s?.status === 'hesaplandi'
const nameOf = (iso2) => countryNames[iso2]?.name || iso2
const fmtInt = (n) => Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 0 })
const pct = (n) => `%${Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`

// ---- bölümler (saf) ----------------------------------------------------------------------------------------

/** Bu haftaki sıralamalardan: ülke başına Türk dizisi sayısı ve dizi başına ülke sayısı. */
export function buildMarketsAndSeries(rankings) {
  const markets = []
  const bySeries = new Map()
  let previousCountries = 0
  let comparable = false
  for (const [iso2, own] of rankings) {
    if (iso2 === 'TR') continue // kaynak ülke
    // previousCount null: o ülkede geçen haftanın listeleri bu haftayı kapsamıyor, karşılaştırma yapılmaz
    if (own.previousCount != null) comparable = true
    if ((own.previousCount ?? 0) > 0) previousCountries++
    const current = own.current || []
    if (!current.length) continue
    markets.push({ iso2, count: current.length, top: current[0]?.name ?? null })
    for (const it of current) {
      const key = it.seriesId ?? it.name
      const s = bySeries.get(key) || { seriesId: it.seriesId ?? null, name: it.name, countries: [], best: 99 }
      s.countries.push(iso2)
      if (it.position < s.best) {
        s.best = it.position
        s.bestCountry = iso2
      }
      bySeries.set(key, s)
    }
  }
  markets.sort((a, b) => b.count - a.count || nameOf(a.iso2).localeCompare(nameOf(b.iso2), 'tr'))
  const series = [...bySeries.values()]
    .map((s) => ({
      seriesId: s.seriesId,
      name: s.name,
      countryCount: s.countries.length,
      bestCountry: s.bestCountry,
      best: s.best,
    }))
    .sort((a, b) => b.countryCount - a.countryCount || a.best - b.best)
  return {
    globalMarkets: markets.length
      ? OK({
          rows: markets.slice(0, 15),
          countryCount: markets.length,
          previousCountryCount: comparable ? previousCountries : null,
        })
      : NONE,
    globalSeries: series.length ? OK({ rows: series.slice(0, 10), seriesCount: series.length }) : NONE,
  }
}

export function buildThemesSection(distribution) {
  const total = distribution.reduce((s, d) => s + d.totalPopularity, 0)
  if (!total) return NONE
  return OK({
    rows: distribution
      .filter((d) => d.theme !== 'diğer')
      .slice(0, 8)
      .map((d) => ({
        theme: d.theme,
        seriesCount: d.seriesCount,
        sharePct: Math.round((d.totalPopularity / total) * 1000) / 10,
      })),
  })
}

export function buildTurkishLearningSection(cacheRow, learners) {
  const items = cacheRow
    ? JSON.parse(cacheRow.by_country || '[]')
        .filter((r) => (r.matchedTermCount ?? 1) >= 2 && countryNames[r.country] && r.country !== 'TR')
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
        .map((r) => ({ iso2: r.country, value: Math.round(r.value) }))
    : []
  if (!items.length && !learners) return NONE
  return OK({ measuredAt: cacheRow?.queried_at ?? null, items, learners })
}

export function buildPressSection(summary, byCountry) {
  if (!summary || summary.status === 'pending' || !summary.sampleSize) return NONE
  return OK({
    positivePct: Math.round(summary.avgPositive * 1000) / 10,
    negativePct: Math.round(summary.avgNegative * 1000) / 10,
    sampleSize: summary.sampleSize,
    seriesCount: summary.seriesCount,
    countries: byCountry
      .sort((a, b) => b.scannedCount - a.scannedCount)
      .slice(0, 10)
      .map((c) => ({ iso2: c.iso2, positivePct: c.avgPositivePct, tone: c.dominantTone, seriesCount: c.seriesCount })),
  })
}

export function buildDestinationsSection(ranking) {
  const total = ranking.reduce((s, d) => s + (d.totalScore || 0), 0)
  if (!ranking.length || !total) return NONE
  return OK({
    rows: ranking.slice(0, 8).map((d) => ({
      name: d.name,
      seriesCount: d.seriesCount,
      countryCount: d.countryCount ?? null,
      sharePct: Math.round(((d.totalScore || 0) / total) * 1000) / 10,
    })),
  })
}

export function buildTravelSignalSection(summary) {
  if (summary?.status !== 'gerçek-veri-mevcut' || !summary.signals?.length) return NONE
  const best = new Map()
  for (const s of summary.signals)
    if (!best.has(s.iso2) || Math.abs(s.correlation) > Math.abs(best.get(s.iso2).correlation)) best.set(s.iso2, s)
  return OK({
    lagWeeks: summary.signals[0].lagWeeks,
    rows: [...best.values()]
      .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
      .slice(0, 10)
      .map((s) => ({ iso2: s.iso2, seriesName: s.topSeriesName, r: s.correlation, weeks: s.sampleSize })),
  })
}

export function buildReachSection(countries) {
  const tracked = countries.filter((c) => c.dataSource !== 'proxy' && c.seriesCount > 0)
  if (!tracked.length) return NONE
  const top = [...tracked].sort((a, b) => b.score - a.score).slice(0, 10)
  const rising = tracked
    .filter((c) => c.trend?.direction === 'yükseliyor')
    .sort((a, b) => (b.trend.changePct ?? 0) - (a.trend.changePct ?? 0))
    .slice(0, 5)
  return OK({
    countryCount: tracked.length,
    top: top.map((c) => ({ iso2: c.iso2, seriesCount: c.seriesCount })),
    rising: rising.map((c) => ({ iso2: c.iso2, changePct: c.trend.changePct })),
  })
}

export function buildBenchmarkSection(bench) {
  if (!bench?.countries?.length) return NONE
  return OK({
    rows: bench.countries.map((c) => ({
      code: c.code,
      name: c.name ?? c.code,
      sharePct: c.marketSharePct,
      countries: c.exportCountryCount ?? null,
    })),
  })
}

// ---- özet ------------------------------------------------------------------------------------------------

export function buildGlobalSummary(sections, { students = null } = {}) {
  const {
    globalMarkets: m,
    globalSeries: s,
    globalReach: r,
    globalPress: p,
    readingTourism: rt,
    globalThemes: t,
  } = sections
  const kpis = [
    {
      key: 'ranked',
      label: 'Bu hafta sıralamada',
      value: ok(m) ? `${m.data.countryCount} ülke` : '—',
      detail: ok(m) && m.data.previousCountryCount != null ? `geçen hafta ${m.data.previousCountryCount}` : null,
      trend:
        ok(m) && m.data.previousCountryCount != null
          ? m.data.countryCount > m.data.previousCountryCount
            ? 'up'
            : m.data.countryCount < m.data.previousCountryCount
              ? 'down'
              : 'same'
          : null,
    },
    {
      key: 'reach',
      label: 'Yayında',
      value: ok(r) ? `${r.data.countryCount} ülke` : '—',
      detail: ok(r) && r.data.rising.length ? `${r.data.rising.length} ülkede erişim artıyor` : null,
      trend: null,
    },
    {
      key: 'students',
      label: 'Türkiye’de okuyan yabancı öğrenci',
      value: students ? fmtInt(students.total) : '—',
      detail:
        students?.changePct != null
          ? `${students.year} · ${students.baseYear}'e göre ${pct(Math.abs(students.changePct))} ${students.changePct >= 0 ? 'artış' : 'düşüş'}`
          : (students?.year ?? null),
      trend:
        students?.changePct != null ? (students.changePct > 0 ? 'up' : students.changePct < 0 ? 'down' : 'same') : null,
    },
    {
      key: 'press',
      label: 'Olumlu basın tonu',
      value: ok(p) ? pct(p.data.positivePct) : '—',
      detail: ok(p) ? `${p.data.sampleSize} dizi/ülke ölçümü` : null,
      trend: null,
    },
  ]
  const out = []
  if (ok(m)) {
    const top = m.data.rows[0]
    out.push({
      basis: 'markets',
      text: `Bu hafta ${m.data.countryCount} ülkede Türk dizisi sıralamada; en çok ${nameOf(top.iso2)} (${top.count} dizi).`,
    })
  }
  if (ok(s)) {
    const top = s.data.rows[0]
    out.push({ basis: 'series', text: `En çok ülkede sıralamada olan dizi ${top.name} (${top.countryCount} ülke).` })
  }
  if (students?.changePct != null) {
    out.push({
      basis: 'students',
      text: `${students.year}'te Türkiye'de ${fmtInt(students.total)} uluslararası öğrenci okuyordu; ${students.baseYear}'e göre ${pct(Math.abs(students.changePct))} ${students.changePct >= 0 ? 'artış' : 'düşüş'}.`,
    })
  }
  if (ok(rt)) {
    out.push({
      basis: 'readingTourism',
      text: `Okunma ilgisi ile ziyaretçi sayısı ${rt.data.tested} ülkede karşılaştırıldı; ${rt.data.significantCount} ülkede anlamlı ilişki var (rastlantıyla ~${String(rt.data.expectedByChance).replace('.', ',')} beklenir).`,
    })
  }
  if (ok(t)) {
    out.push({
      basis: 'themes',
      text: `En güçlü tema "${t.data.rows[0].theme}" (popülerliğin ${pct(t.data.rows[0].sharePct)}'i).`,
    })
  }
  return { kpis, sentences: out.filter((x) => !direktifIceriyorMu(x.text)).slice(0, 4), caveat: null }
}

// ---- toplama ----------------------------------------------------------------------------------------------

function duolingoLearners() {
  try {
    const rows = db
      .prepare('SELECT total_learners AS n, captured_at AS t FROM duolingo_history ORDER BY captured_at DESC')
      .all()
    if (!rows.length) return null
    const latest = rows[0]
    const monthAgo = rows.find((r) => latest.t - r.t >= 28 * 24 * 60 * 60 * 1000) ?? null
    return {
      total: latest.n,
      changePct: monthAgo?.n ? Math.round(((latest.n - monthAgo.n) / monthAgo.n) * 1000) / 10 : null,
    }
  } catch {
    return null
  }
}

export async function buildGlobalReport({ useCache = true } = {}) {
  if (useCache) {
    const cached = getCached(CACHE_KEY)
    if (cached) return cached
  }
  const { data, raw, destinationStore } = await getEnrichedVisibility()
  const rankings = await getAllOwnRankings()
  const { globalMarkets, globalSeries } = buildMarketsAndSeries(rankings)

  const safe = async (fn, fallback = NONE) => {
    try {
      return await fn()
    } catch (err) {
      console.error('[globalReport] bölüm hesaplanamadı:', err.message)
      return fallback
    }
  }

  const globalThemes = await safe(() => buildThemesSection(getGlobalThemeDistribution(raw, getThemeStore())))
  const top = getTopOriginCountries(10)
  const globalStudents = top.items.length ? OK(top) : NONE
  const turkishLearning = await safe(() =>
    buildTurkishLearningSection(
      db
        .prepare("SELECT queried_at, by_country FROM turkish_learning_cache WHERE key = 'turkish-learning-index'")
        .get(),
      duolingoLearners()
    )
  )
  const globalPress = await safe(() => buildPressSection(getMediaSentimentSummary(), getMediaSentimentByCountry()))
  const globalDestinations = await safe(() =>
    buildDestinationsSection(buildDestinationRanking(data.countries, raw.series, destinationStore))
  )
  const readingTourism = await safe(() => {
    const o = buildReadingTourismOverview()
    return o.tested ? OK(o) : NONE
  })
  const travelSignal = await safe(() => buildTravelSignalSection(getTourismLeadingSignalSummary()))
  const globalReach = buildReachSection(data.countries)
  const benchmark = await safe(async () => buildBenchmarkSection(await buildBenchmark()))

  const sections = {
    globalMarkets,
    globalSeries,
    globalThemes,
    globalStudents,
    turkishLearning,
    globalPress,
    globalDestinations,
    readingTourism,
    travelSignal,
    globalReach,
    benchmark,
  }
  const chapters = []
  for (const ch of GLOBAL_CHAPTERS) {
    const secs = ch.sections
      .filter((k) => ok(sections[k]))
      .map((k) => ({
        key: k,
        title: GLOBAL_SECTION_TITLES[k],
        data: sections[k].data,
        caveat: ALWAYS_CAVEAT[k] ?? null,
      }))
    if (secs.length) chapters.push({ key: ch.key, title: ch.title, sections: secs })
  }
  const report = {
    title: 'Küresel görünüm',
    generatedAt: new Date().toISOString(),
    week: [...rankings.values()][0]?.to ?? null,
    isTracked: true,
    summary: buildGlobalSummary(sections, { students: getForeignStudentTotals() }),
    chapters,
    contract: GLOBAL_CONTRACT,
  }
  if (useCache) setCached(CACHE_KEY, report, CACHE_TTL_MS)
  return report
}
