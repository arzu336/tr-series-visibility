import db from '../db.js'
import { getCached, setCached } from '../cache.js'
import { getEnrichedVisibility } from '../data-pipeline.js'
import { getPipelineDb } from './pipelineDb.js'
import { languagesOfCountry } from '../../src/lib/langCountries.js'
import countryNames from '../../src/data/country-centroids.json' with { type: 'json' }
import continentByIso2 from '../../src/data/continents.json' with { type: 'json' }

// Dönem raporu (2026-10-13, kullanıcı isteği: raporlar tarih aralığıyla filtrelenebilsin — ay düzeyinde; okunma ve
// turizm verisi aylık olduğundan en ince ayrım ay). Güncel raporun bölümleri "şu an"a göre hesaplandığı için dönem
// seçilince ayrı bir belge üretilir — aynı biçim (özet → başlıklar), yalnızca o dönemin KAYITLI verisiyle: platform listeleri (Netflix 2021+, diğer platformlar 2026-09+), okunma (2015+), turist girişleri
// (2016+), yabancı öğrenciler, TV yayınları, basın taramaları, izlenme düzeyi ve yayın durumu (2026-10+). O dönem verisi
// olmayan bölüm basılmaz. Verinin nereden ve ne zamandan beri geldiği raporda yazmaz (kullanıcı isteği). Ücretli sorgu yok.

export const YEAR_REPORT_CONTRACT = 'yillik-rapor-v1'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const TOP_N = 15
const OK = (data) => ({ status: 'hesaplandi', data })
const NONE = { status: 'hesaplanamaz' }
const ok = (s) => s?.status === 'hesaplandi'
const nameOf = (iso2) => countryNames[iso2]?.name || iso2
const fmt = (n) => Number(n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 })
const langName = (() => {
  const dn = new Intl.DisplayNames(['tr'], { type: 'language' })
  return (l) => {
    try {
      return dn.of(l) || l
    } catch {
      return l
    }
  }
})()

const AYLAR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
]

/**
 * Ay aralığı ('YYYY-MM' – 'YYYY-MM') → gün aralığı; bitiş ayı bugünü geçiyorsa bugüne kadar. `ymFrom`/`ymTo` aylık
 * tablolar için (yıl*100+ay).
 */
export function periodRange({ from, to }, now = new Date()) {
  const [ty, tm] = to.split('-').map(Number)
  const end = new Date(Date.UTC(ty, tm, 0)).toISOString().slice(0, 10)
  const today = now.toISOString().slice(0, 10)
  const [fy, fm] = from.split('-').map(Number)
  return {
    from: `${from}-01`,
    to: end < today ? end : today,
    partial: end >= today,
    ymFrom: fy * 100 + fm,
    ymTo: ty * 100 + tm,
    label: periodLabel({ from, to }),
  }
}

/** "2024" (tam yıl), "Mart 2024" (tek ay), "Ocak 2023 – Haziran 2024". */
export function periodLabel({ from, to }) {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  if (fy === ty && fm === 1 && tm === 12) return String(fy)
  if (from === to) return `${AYLAR[fm - 1]} ${fy}`
  return `${AYLAR[fm - 1]} ${fy} – ${AYLAR[tm - 1]} ${ty}`
}

/** Geçerli dönem: 'YYYY-MM' biçimi, 2015 sonrası, başlangıç ≤ bitiş. */
export function parsePeriod({ from, to, year } = {}) {
  if (year && /^\d{4}$/.test(String(year))) return { from: `${year}-01`, to: `${year}-12` }
  const ym = /^(20[1-3]\d)-(0[1-9]|1[0-2])$/
  if (!ym.test(from || '') || !ym.test(to || '') || from > to) return null
  return { from, to }
}

/** Dönem bitmediyse not (verinin nereden ve ne zamandan beri tutulduğu rapora yazılmaz — kullanıcı isteği). */
function periodCaveat(from, to, partial) {
  return partial ? `Dönem henüz bitmedi: ${to} tarihine kadarki veri.` : null
}

/** Geriye uyumluluk: tek yıl. */
export function yearRange(year, now = new Date()) {
  const { from, to, partial } = periodRange({ from: `${year}-01`, to: `${year}-12` }, now)
  return { from, to, partial }
}

/** Raporlanabilir yıllar: en eski platform listesi yılından bugüne. */
export function availableYears(now = new Date()) {
  const y = now.getUTCFullYear()
  return Array.from({ length: y - 2010 + 1 }, (_, i) => y - i)
}

const pipeline = () => getPipelineDb()
function all(conn, sql, ...params) {
  try {
    return conn?.prepare(sql).all(...params) ?? []
  } catch {
    return []
  }
}

// ---- bölümler (saf: satırları alır) ----------------------------------------------------------------------------

/**
 * Platform listeleri: o yıl ülkenin listelerine giren Türk dizileri. `rows`: [{ series_id, period_date, rank, provider,
 * platform }]. Hafta = dizinin listede görüldüğü farklı takvim haftası.
 */
export function buildYearLists(rows, nameById) {
  const by = new Map()
  const monthly = new Map()
  for (const r of rows) {
    if (!nameById.has(r.series_id)) continue
    const week = isoWeek(r.period_date)
    const s = by.get(r.series_id) || {
      seriesId: r.series_id,
      name: nameById.get(r.series_id),
      weeks: new Set(),
      best: 99,
      platforms: new Set(),
    }
    s.weeks.add(week)
    s.best = Math.min(s.best, r.rank)
    s.platforms.add(r.provider === 'netflix_tudum' ? 'netflix' : r.platform || 'diğer')
    by.set(r.series_id, s)
    const m = r.period_date.slice(0, 7)
    if (!monthly.has(m)) monthly.set(m, new Set())
    monthly.get(m).add(r.series_id)
  }
  if (!by.size) return NONE
  const top = [...by.values()]
    .map((s) => ({
      seriesId: s.seriesId,
      name: s.name,
      weeks: s.weeks.size,
      bestRank: s.best,
      platforms: [...s.platforms],
    }))
    .sort((a, b) => b.weeks - a.weeks || a.bestRank - b.bestRank)
  return OK({
    seriesCount: top.length,
    top: top.slice(0, TOP_N),
    monthly: [...monthly].sort(([a], [b]) => a.localeCompare(b)).map(([month, set]) => ({ month, series: set.size })),
  })
}

function isoWeek(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`)
  const wd = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - wd)
  return d.toISOString().slice(0, 10)
}

/** Okunma: o yıl, verilen dillerde dizilerin okunması. `rows`: [{ lang, tmdb_id, month, views }]. */
export function buildYearReading(rows, nameById, { regionalLangs = new Set() } = {}) {
  const bySeries = new Map()
  const byLang = new Map()
  const monthly = new Map()
  let total = 0
  for (const r of rows) {
    if (!nameById.has(r.tmdb_id)) continue
    total += r.views
    bySeries.set(r.tmdb_id, (bySeries.get(r.tmdb_id) || 0) + r.views)
    byLang.set(r.lang, (byLang.get(r.lang) || 0) + r.views)
    const m = `${r.year}-${String(r.month).padStart(2, '0')}`
    monthly.set(m, (monthly.get(m) || 0) + r.views)
  }
  if (!total) return NONE
  return OK({
    total,
    languages: [...byLang]
      .sort((a, b) => b[1] - a[1])
      .map(([lang, views]) => ({ lang, languageName: langName(lang), views, regional: regionalLangs.has(lang) })),
    top: [...bySeries]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([id, views]) => ({ seriesId: id, name: nameById.get(id), views })),
    monthly: [...monthly].sort((a, b) => a[0].localeCompare(b[0])).map(([month, views]) => ({ month, views })),
  })
}

/** Turist girişleri: o yıl aylık ve bir önceki yılın aynı aylarına göre değişim. */
export function buildYearTourism(rows, prevRows) {
  if (!rows.length) return NONE
  const key = (y, m) => `${y}-${String(m).padStart(2, '0')}`
  const prev = new Map(prevRows.map((r) => [key(r.year, r.month), r.visitor_count]))
  const total = rows.reduce((n, r) => n + r.visitor_count, 0)
  // Değişim, önceki yılın aynı ayı bilinen aylar üzerinden.
  let cur = 0
  let old = 0
  for (const r of rows) {
    const p = prev.get(key(r.year - 1, r.month))
    if (p != null) {
      cur += r.visitor_count
      old += p
    }
  }
  return OK({
    total,
    months: rows.length,
    monthly: rows.map((r) => ({ month: key(r.year, r.month), visitors: r.visitor_count })),
    changePct: old ? Math.round(((cur - old) / old) * 1000) / 10 : null,
  })
}

/** TV yayınları: o yıl dizi başına yayın günü ve kanallar. */
export function buildYearTv(rows, nameById) {
  const by = new Map()
  for (const r of rows) {
    const s = by.get(r.series_id) || {
      seriesId: r.series_id,
      name: nameById.get(r.series_id) || r.title,
      slots: 0,
      channels: new Set(),
      countries: new Set(),
    }
    s.slots += r.slots
    s.channels.add(r.channel)
    s.countries.add(r.iso2)
    by.set(r.series_id, s)
  }
  if (!by.size) return NONE
  return OK({
    rows: [...by.values()]
      .map((s) => ({
        seriesId: s.seriesId,
        name: s.name,
        slots: s.slots,
        channels: [...s.channels],
        countries: [...s.countries],
      }))
      .sort((a, b) => b.slots - a.slots)
      .slice(0, TOP_N),
  })
}

/** Basın: o yılın taramaları — haberli tarama, haber sayısı, ortalama ton. */
export function buildYearPress(rows, nameById) {
  const withNews = rows.filter((r) => r.total_news_count > 0)
  if (!withNews.length) return NONE
  const toned = withNews.filter((r) => r.positive_score != null)
  const avg = (k) => (toned.length ? Math.round((toned.reduce((n, r) => n + r[k], 0) / toned.length) * 100) : null)
  const by = new Map()
  for (const r of withNews) {
    const s = by.get(r.series_id) || {
      seriesId: r.series_id,
      name: nameById.get(r.series_id) || String(r.series_id),
      news: 0,
      countries: new Set(),
    }
    s.news += r.total_news_count
    s.countries.add(r.country_iso2)
    by.set(r.series_id, s)
  }
  return OK({
    scans: rows.length,
    withNews: withNews.length,
    news: withNews.reduce((n, r) => n + r.total_news_count, 0),
    positivePct: avg('positive_score'),
    negativePct: avg('negative_score'),
    top: [...by.values()]
      .map((s) => ({ seriesId: s.seriesId, name: s.name, news: s.news, countries: [...s.countries] }))
      .sort((a, b) => b.news - a.news)
      .slice(0, TOP_N),
  })
}

/** İzlenme düzeyi: o yılın günlük kayıtlarından ortalama ve en sık düzey. */
export function buildYearWatch(rows) {
  const vals = rows.filter((r) => r.idx != null)
  if (!vals.length) return NONE
  const count = new Map()
  for (const r of vals) count.set(r.level, (count.get(r.level) || 0) + 1)
  return OK({
    days: vals.length,
    avgIndex: Math.round(vals.reduce((n, r) => n + r.idx, 0) / vals.length),
    level: [...count].sort((a, b) => b[1] - a[1])[0][0],
    first: rows[0].date,
    last: rows[rows.length - 1].date,
  })
}

// ---- belge ------------------------------------------------------------------------------------------------------

const COUNTRY_CHAPTERS = [
  { key: 'izleniyor', title: 'Ne izlendi', sections: ['yearLists', 'yearTv'] },
  { key: 'ilgi', title: 'Ne kadar ilgi gördü', sections: ['yearReading', 'yearWatch'] },
  { key: 'gundem', title: 'Nasıl konuşuldu', sections: ['yearPress'] },
  { key: 'etki', title: 'Turizm ve eğitim', sections: ['yearTourism', 'yearStudents'] },
]
const SECTION_TITLES = {
  yearLists: 'Platform listelerine giren diziler',
  yearTv: 'Televizyonda yayınlanan diziler',
  yearReading: 'Okunma ilgisi',
  yearWatch: 'İzlenme düzeyi',
  yearPress: 'Basın taramaları',
  yearTourism: 'Türkiye’ye gelen ziyaretçiler',
  yearStudents: 'Türkiye’de okuyan öğrenciler',
  yearMarkets: 'Listeye girdiği ülkeler',
  yearSearch: 'Arama ilgisi',
  contSeries: 'En çok izlenen Türk dizileri',
  contCountries: 'Ülkeler',
}

function chaptersOf(spec, sections) {
  return spec
    .map((ch) => ({
      key: ch.key,
      title: ch.title,
      sections: ch.sections
        .filter((k) => ok(sections[k]))
        .map((k) => ({
          key: k,
          title: SECTION_TITLES[k],
          data: sections[k].data,
          caveat: null,
        })),
    }))
    .filter((ch) => ch.sections.length)
}

async function catalog(deps, { withSeries = false } = {}) {
  const { raw } = await (deps.getEnrichedVisibility || getEnrichedVisibility)()
  const names = new Map(raw.series.map((s) => [s.id, s.name]))
  return withSeries ? { names, byId: new Map(raw.series.map((s) => [s.id, s])) } : names
}

/** `period`: { from: 'YYYY-MM', to: 'YYYY-MM' } (bkz. parsePeriod). */
export async function buildCountryPeriodReport(iso2Raw, period, { useCache = true, deps = {}, now = new Date() } = {}) {
  const iso2 = String(iso2Raw).toUpperCase()
  const key = `report:country-period:v1:${iso2}:${period.from}:${period.to}`
  if (useCache) {
    const c = getCached(key)
    if (c) return c
  }
  const { from, to, partial, ymFrom, ymTo, label } = periodRange(period, now)
  const nameById = await catalog(deps)
  const p = deps.pipeline !== undefined ? deps.pipeline : pipeline()
  const langs = languagesOfCountry(iso2)
  const langList = langs.map((l) => l.lang)
  const marks = langList.map(() => '?').join(',') || "''"

  const sections = {
    yearLists: buildYearLists(
      all(
        p,
        `SELECT series_id, period_date, rank, provider, platform FROM chart_entries
              WHERE country_iso2 = ? AND period_date BETWEEN ? AND ? AND series_id IS NOT NULL
                AND program_kind = 'series' AND provider IN ('netflix_tudum', 'flixpatrol')`,
        iso2,
        from,
        to
      ),
      nameById
    ),
    yearTv: buildYearTv(
      all(db, 'SELECT * FROM tv_airings WHERE iso2 = ? AND date BETWEEN ? AND ?', iso2, from, to),
      nameById
    ),
    yearReading: buildYearReading(
      all(
        db,
        `SELECT lang, tmdb_id, year, month, views FROM series_language_interest
           WHERE year * 100 + month BETWEEN ? AND ? AND lang IN (${marks})`,
        ymFrom,
        ymTo,
        ...langList
      ),
      nameById,
      { regionalLangs: new Set(langs.filter((l) => l.regional).map((l) => l.lang)) }
    ),
    yearWatch: buildYearWatch(
      all(db, 'SELECT * FROM watch_signal_daily WHERE iso2 = ? AND date BETWEEN ? AND ? ORDER BY date', iso2, from, to)
    ),
    yearPress: buildYearPress(
      all(db, 'SELECT * FROM press_history WHERE country_iso2 = ? AND scanned_on BETWEEN ? AND ?', iso2, from, to),
      nameById
    ),
    yearTourism: buildYearTourism(
      all(
        db,
        'SELECT year, month, visitor_count FROM tourist_arrivals WHERE iso2 = ? AND year * 100 + month BETWEEN ? AND ? ORDER BY year, month',
        iso2,
        ymFrom,
        ymTo
      ),
      all(
        db,
        'SELECT year, month, visitor_count FROM tourist_arrivals WHERE iso2 = ? AND year * 100 + month BETWEEN ? AND ?',
        iso2,
        ymFrom - 100,
        ymTo - 100
      )
    ),
    // Öğrenci verisi yıllık: dönemin içindeki son yıl.
    yearStudents: (() => {
      const cur = all(
        db,
        'SELECT year, students FROM foreign_students WHERE iso2 = ? AND year BETWEEN ? AND ? ORDER BY year DESC',
        iso2,
        Math.floor(ymFrom / 100),
        Math.floor(ymTo / 100)
      )[0]
      if (!cur) return NONE
      const prev = all(db, 'SELECT students FROM foreign_students WHERE iso2 = ? AND year = ?', iso2, cur.year - 1)[0]
      return OK({ year: cur.year, students: cur.students, prev: prev?.students ?? null })
    })(),
  }
  const s = sections
  const kpis = [
    ok(s.yearLists) && {
      key: 'lists',
      label: 'Listelere giren dizi',
      value: `${s.yearLists.data.seriesCount}`,
      detail: null,
    },
    ok(s.yearReading) && {
      key: 'reading',
      label: 'Okunma',
      value: fmt(s.yearReading.data.total),
      detail: null,
    },
    ok(s.yearTourism) && {
      key: 'tourism',
      label: 'Ziyaretçi',
      value: fmt(s.yearTourism.data.total),
      detail:
        s.yearTourism.data.changePct != null
          ? `önceki yıla göre ${s.yearTourism.data.changePct > 0 ? '+' : ''}${s.yearTourism.data.changePct}%`
          : null,
    },
    ok(s.yearTv) && { key: 'tv', label: 'Televizyonda', value: `${s.yearTv.data.rows.length} dizi`, detail: null },
  ].filter(Boolean)
  const sentences = []
  if (ok(s.yearLists)) {
    const t = s.yearLists.data.top[0]
    sentences.push({
      basis: 'lists',
      text: `${label} döneminde ${s.yearLists.data.seriesCount} Türk dizisi listelere girdi; en uzun kalan ${t.name} (${t.weeks} hafta, en iyi ${t.bestRank}. sıra).`,
    })
  }
  if (ok(s.yearReading)) {
    const t = s.yearReading.data.top[0]
    sentences.push({ basis: 'reading', text: `En çok okunan dizi ${t.name} (${fmt(t.views)} okunma).` })
  }
  if (ok(s.yearTourism) && s.yearTourism.data.changePct != null)
    sentences.push({
      basis: 'tourism',
      text: `Türkiye’ye gelen ziyaretçi sayısı önceki yılın aynı aylarına göre %${Math.abs(s.yearTourism.data.changePct)} ${s.yearTourism.data.changePct >= 0 ? 'arttı' : 'azaldı'}.`,
    })
  if (!kpis.length && !sentences.length) sentences.push({ basis: 'empty', text: 'Bu dönem için kayıtlı veri yok.' })
  const report = {
    title: `Ülke brifingi — ${label}`,
    iso2,
    period: { from: period.from, to: period.to, label, partial, lastDay: to },
    generatedAt: now.toISOString(),
    isTracked: true,
    summary: { kpis, sentences, caveat: periodCaveat(from, to, partial) },
    chapters: chaptersOf(COUNTRY_CHAPTERS, sections),
    contract: YEAR_REPORT_CONTRACT,
  }
  setCached(key, report, CACHE_TTL_MS)
  return report
}

const SERIES_CHAPTERS = [
  { key: 'izleniyor', title: 'Nerede izlendi', sections: ['yearMarkets', 'yearTv'] },
  { key: 'ilgi', title: 'Ne kadar ilgi gördü', sections: ['yearReading', 'yearSearch'] },
  { key: 'gundem', title: 'Nasıl konuşuldu', sections: ['yearPress'] },
]

/** Dizinin o yıl listeye girdiği ülkeler: hafta ve en iyi sıra. */
export function buildYearMarkets(rows) {
  const by = new Map()
  for (const r of rows) {
    const s = by.get(r.country_iso2) || { iso2: r.country_iso2, weeks: new Set(), best: 99 }
    s.weeks.add(isoWeek(r.period_date))
    s.best = Math.min(s.best, r.rank)
    by.set(r.country_iso2, s)
  }
  if (!by.size) return NONE
  return OK({
    rows: [...by.values()]
      .map((s) => ({ iso2: s.iso2, weeks: s.weeks.size, bestRank: s.best }))
      .sort((a, b) => b.weeks - a.weeks || a.bestRank - b.bestRank),
  })
}

/** Arama ilgisi: o yılı kapsayan en yeni kayıtlı seriden yalnızca o yılın haftaları. */
export function buildYearSearch(windows, from, to) {
  const toSec = (d) => Date.parse(`${d}T00:00:00Z`) / 1000
  // Yılı en çok kapsayan seri (eşitse en yeni): son 12 aylık seri yılın yalnızca bir kısmını kapsayabilir.
  const overlap = (x) =>
    (Date.parse(x.window_end < to ? x.window_end : to) - Date.parse(x.window_start > from ? x.window_start : from)) /
    86400000
  const w = windows
    .filter((x) => x.window_start <= to && x.window_end >= from)
    .sort((a, b) => overlap(b) - overlap(a) || b.fetched_at.localeCompare(a.fetched_at))[0]
  if (!w) return NONE
  const points = JSON.parse(w.timeline).filter((p) => p.timestamp >= toSec(from) && p.timestamp <= toSec(to) + 86400)
  if (points.length < 2 || !points.some((p) => p.value > 0)) return NONE
  return OK({ timeline: points, coverage: { from: w.window_start, to: w.window_end } })
}

export async function buildSeriesPeriodReport(seriesId, period, { useCache = true, deps = {}, now = new Date() } = {}) {
  const id = Number(seriesId)
  const key = `report:series-period:v1:${id}:${period.from}:${period.to}`
  if (useCache) {
    const c = getCached(key)
    if (c) return c
  }
  const { from, to, partial, ymFrom, ymTo, label } = periodRange(period, now)
  const { names: nameById, byId } = await catalog(deps, { withSeries: true })
  if (!nameById.has(id)) return null
  const name = nameById.get(id)
  // Yayından önceki haber ve arama kayıtları dizi değil, aynı adlı başka şeyler (genel adlar: "Seni Tanıyorum").
  const aired = byId.get(id)?.firstAirDate || null
  const newsFrom = aired && aired > from ? aired : from
  const p = deps.pipeline !== undefined ? deps.pipeline : pipeline()
  const readingRows = all(
    db,
    'SELECT lang, tmdb_id, year, month, views FROM series_language_interest WHERE tmdb_id = ? AND year * 100 + month BETWEEN ? AND ? AND lang != ?',
    id,
    ymFrom,
    ymTo,
    'tr'
  )
  const sections = {
    yearMarkets: buildYearMarkets(
      all(
        p,
        `SELECT country_iso2, period_date, rank FROM chart_entries WHERE series_id = ? AND period_date BETWEEN ? AND ?
              AND country_iso2 != 'TR' AND provider IN ('netflix_tudum', 'flixpatrol')`,
        id,
        from,
        to
      )
    ),
    yearTv: buildYearTv(
      all(db, 'SELECT * FROM tv_airings WHERE series_id = ? AND date BETWEEN ? AND ?', id, from, to),
      nameById
    ),
    yearReading: buildYearReading(readingRows, nameById),
    yearSearch:
      newsFrom > to
        ? NONE
        : buildYearSearch(
            all(db, 'SELECT * FROM trends_windows WHERE query = ? AND geo = ?', name.toLocaleLowerCase('tr'), 'WW'),
            newsFrom,
            to
          ),
    yearPress: buildYearPress(
      all(db, 'SELECT * FROM press_history WHERE series_id = ? AND scanned_on BETWEEN ? AND ?', id, newsFrom, to),
      nameById
    ),
  }
  const s = sections
  const kpis = [
    ok(s.yearMarkets) && {
      key: 'markets',
      label: 'Listeye girdiği ülke',
      value: `${s.yearMarkets.data.rows.length}`,
      detail: null,
    },
    ok(s.yearReading) && {
      key: 'reading',
      label: 'Yabancı dillerde okunma',
      value: fmt(s.yearReading.data.total),
      detail: `${s.yearReading.data.languages.length} dil`,
    },
    ok(s.yearTv) && {
      key: 'tv',
      label: 'Televizyonda',
      value: `${s.yearTv.data.rows[0].countries.length} ülke`,
      detail: null,
    },
    ok(s.yearPress) && {
      key: 'press',
      label: 'Haber',
      value: fmt(s.yearPress.data.news),
      detail: `${s.yearPress.data.withNews} taramada`,
    },
  ].filter(Boolean)
  const sentences = []
  if (ok(s.yearMarkets)) {
    const t = s.yearMarkets.data.rows[0]
    sentences.push({
      basis: 'markets',
      text: `${label} döneminde ${s.yearMarkets.data.rows.length} ülkede listelere girdi; en uzun kaldığı ülke ${nameOf(t.iso2)} (${t.weeks} hafta).`,
    })
  }
  if (ok(s.yearReading)) {
    const l = s.yearReading.data.languages[0]
    sentences.push({ basis: 'reading', text: `Yabancı dillerde en çok ${l.languageName} okundu (${fmt(l.views)}).` })
  }
  if (aired && aired > to)
    sentences.push({ basis: 'aired', text: `Dizi ${aired.slice(0, 4)} yılında yayına girdi; bu dönem yayından önce.` })
  else if (!kpis.length && !sentences.length)
    sentences.push({ basis: 'empty', text: 'Bu dönem için kayıtlı veri yok.' })
  const report = {
    title: `Dizi raporu — ${label}`,
    seriesId: id,
    seriesName: name,
    period: { from: period.from, to: period.to, label, partial, lastDay: to },
    generatedAt: now.toISOString(),
    isTracked: true,
    summary: { kpis, sentences, caveat: periodCaveat(from, to, partial) },
    chapters: chaptersOf(SERIES_CHAPTERS, sections),
    contract: YEAR_REPORT_CONTRACT,
  }
  setCached(key, report, CACHE_TTL_MS)
  return report
}

// ---- kıta raporu (2026-10-13, kullanıcı: "kıta bazında en çok izlenmeleri raporlayabilirsek") -------------------
// Kıtanın ülkelerindeki kayıtların toplamı; dönem raporuyla aynı belge biçimi. "En çok izlenen" = platform
// listelerinde en çok ülke-hafta kalan dizi (izlenme sayısı yayımlanmıyor; listede kalma süresi en yakın gösterge).

export const CONTINENTS = {
  europe: 'Avrupa',
  middle_east: 'Orta Doğu',
  latin_america: 'Latin Amerika',
  asia_pacific: 'Asya-Pasifik',
  africa: 'Afrika',
  north_america: 'Kuzey Amerika',
}

export function continentCountries(id) {
  return Object.entries(continentByIso2)
    .filter(([iso2, c]) => c === id && iso2 !== 'TR')
    .map(([iso2]) => iso2)
}

/** Kıtada listelere giren diziler: ülke sayısı ve ülke-hafta. `rows`: [{ series_id, country_iso2, period_date, rank, provider, platform }]. */
export function buildContinentSeries(rows, nameById) {
  const by = new Map()
  const monthly = new Map()
  for (const r of rows) {
    if (!nameById.has(r.series_id)) continue
    const s = by.get(r.series_id) || {
      seriesId: r.series_id,
      name: nameById.get(r.series_id),
      weeksByCountry: new Map(),
      best: 99,
      platforms: new Set(),
    }
    if (!s.weeksByCountry.has(r.country_iso2)) s.weeksByCountry.set(r.country_iso2, new Set())
    s.weeksByCountry.get(r.country_iso2).add(isoWeek(r.period_date))
    s.best = Math.min(s.best, r.rank)
    s.platforms.add(r.provider === 'netflix_tudum' ? 'netflix' : r.platform || 'diğer')
    by.set(r.series_id, s)
    const m = r.period_date.slice(0, 7)
    if (!monthly.has(m)) monthly.set(m, new Set())
    monthly.get(m).add(r.series_id)
  }
  if (!by.size) return NONE
  const top = [...by.values()]
    .map((s) => {
      const countries = [...s.weeksByCountry].sort((a, b) => b[1].size - a[1].size).map(([iso2]) => iso2)
      const countryWeeks = [...s.weeksByCountry.values()].reduce((n, w) => n + w.size, 0)
      return {
        seriesId: s.seriesId,
        name: s.name,
        countries,
        countryWeeks,
        bestRank: s.best,
        platforms: [...s.platforms],
      }
    })
    .sort(
      (a, b) => b.countryWeeks - a.countryWeeks || b.countries.length - a.countries.length || a.bestRank - b.bestRank
    )
  return OK({
    seriesCount: top.length,
    top: top.slice(0, TOP_N),
    monthly: [...monthly].sort(([a], [b]) => a.localeCompare(b)).map(([month, set]) => ({ month, series: set.size })),
  })
}

/** Kıtanın ülkeleri: listeye giren Türk dizisi sayısı, dizi-hafta ve ortalama izlenme düzeyi. */
export function buildContinentCountries(chartRows, watchRows, iso2s) {
  const by = new Map(
    iso2s.map((iso2) => [iso2, { iso2, series: new Set(), weeks: new Set(), idx: [], levels: new Map() }])
  )
  for (const r of chartRows) {
    const c = by.get(r.country_iso2)
    if (!c) continue
    c.series.add(r.series_id)
    c.weeks.add(`${r.series_id}|${isoWeek(r.period_date)}`)
  }
  for (const r of watchRows) {
    const c = by.get(r.iso2)
    if (!c || r.idx == null) continue
    c.idx.push(r.idx)
    c.levels.set(r.level, (c.levels.get(r.level) || 0) + 1)
  }
  const rows = [...by.values()]
    .map((c) => ({
      iso2: c.iso2,
      series: c.series.size,
      seriesWeeks: c.weeks.size,
      watchIndex: c.idx.length ? Math.round(c.idx.reduce((n, v) => n + v, 0) / c.idx.length) : null,
      watchLevel: c.levels.size ? [...c.levels].sort((a, b) => b[1] - a[1])[0][0] : null,
    }))
    .filter((c) => c.series || c.watchIndex != null)
    .sort((a, b) => b.series - a.series || b.seriesWeeks - a.seriesWeeks || (b.watchIndex ?? -1) - (a.watchIndex ?? -1))
  if (!rows.length) return NONE
  return OK({ total: iso2s.length, listed: rows.filter((c) => c.series).length, rows })
}

const CONTINENT_CHAPTERS = [
  { key: 'izleniyor', title: 'Ne izlendi', sections: ['contSeries', 'contCountries', 'yearTv'] },
  { key: 'ilgi', title: 'Ne kadar ilgi gördü', sections: ['yearReading'] },
  { key: 'gundem', title: 'Nasıl konuşuldu', sections: ['yearPress'] },
  { key: 'etki', title: 'Turizm ve eğitim', sections: ['yearTourism', 'yearStudents'] },
]

/** Kıta raporu (`period`: { from, to } 'YYYY-MM'). */
export async function buildContinentPeriodReport(id, period, { useCache = true, deps = {}, now = new Date() } = {}) {
  if (!CONTINENTS[id]) return null
  const key = `report:continent-period:v1:${id}:${period.from}:${period.to}`
  if (useCache) {
    const c = getCached(key)
    if (c) return c
  }
  const { from, to, partial, ymFrom, ymTo, label } = periodRange(period, now)
  const nameById = await catalog(deps)
  const p = deps.pipeline !== undefined ? deps.pipeline : pipeline()
  const iso2s = continentCountries(id)
  const inList = iso2s.map(() => '?').join(',')
  const langs = new Map()
  for (const iso2 of iso2s)
    for (const l of languagesOfCountry(iso2)) if (l.lang !== 'tr') langs.set(l.lang, langs.get(l.lang) || l.regional)
  const langList = [...langs.keys()]
  const langMarks = langList.map(() => '?').join(',') || "''"

  const chartRows = all(
    p,
    `SELECT series_id, country_iso2, period_date, rank, provider, platform FROM chart_entries
      WHERE country_iso2 IN (${inList}) AND period_date BETWEEN ? AND ? AND series_id IS NOT NULL
        AND program_kind = 'series' AND provider IN ('netflix_tudum', 'flixpatrol')`,
    ...iso2s,
    from,
    to
  )
  const watchRows = all(
    db,
    `SELECT iso2, idx, level FROM watch_signal_daily WHERE iso2 IN (${inList}) AND date BETWEEN ? AND ?`,
    ...iso2s,
    from,
    to
  )
  const sections = {
    contSeries: buildContinentSeries(chartRows, nameById),
    contCountries: buildContinentCountries(chartRows, watchRows, iso2s),
    yearTv: buildYearTv(
      all(db, `SELECT * FROM tv_airings WHERE iso2 IN (${inList}) AND date BETWEEN ? AND ?`, ...iso2s, from, to),
      nameById
    ),
    yearReading: buildYearReading(
      all(
        db,
        `SELECT lang, tmdb_id, year, month, views FROM series_language_interest
           WHERE year * 100 + month BETWEEN ? AND ? AND lang IN (${langMarks})`,
        ymFrom,
        ymTo,
        ...langList
      ),
      nameById,
      { regionalLangs: new Set(langList.filter((l) => langs.get(l))) }
    ),
    yearPress: buildYearPress(
      all(
        db,
        `SELECT * FROM press_history WHERE country_iso2 IN (${inList}) AND scanned_on BETWEEN ? AND ?`,
        ...iso2s,
        from,
        to
      ),
      nameById
    ),
    yearTourism: buildYearTourism(
      all(
        db,
        `SELECT year, month, SUM(visitor_count) AS visitor_count FROM tourist_arrivals
          WHERE iso2 IN (${inList}) AND year * 100 + month BETWEEN ? AND ? GROUP BY year, month ORDER BY year, month`,
        ...iso2s,
        ymFrom,
        ymTo
      ),
      all(
        db,
        `SELECT year, month, SUM(visitor_count) AS visitor_count FROM tourist_arrivals
          WHERE iso2 IN (${inList}) AND year * 100 + month BETWEEN ? AND ? GROUP BY year, month`,
        ...iso2s,
        ymFrom - 100,
        ymTo - 100
      )
    ),
    yearStudents: (() => {
      const byYear = all(
        db,
        `SELECT year, SUM(students) AS students FROM foreign_students WHERE iso2 IN (${inList}) AND year BETWEEN ? AND ?
          GROUP BY year ORDER BY year DESC`,
        ...iso2s,
        Math.floor(ymFrom / 100) - 1,
        Math.floor(ymTo / 100)
      )
      const cur = byYear.find((r) => r.year >= Math.floor(ymFrom / 100))
      if (!cur) return NONE
      const prev = byYear.find((r) => r.year === cur.year - 1)
      return OK({ year: cur.year, students: cur.students, prev: prev?.students ?? null })
    })(),
  }
  const s = sections
  const name = CONTINENTS[id]
  const kpis = [
    ok(s.contSeries) && {
      key: 'lists',
      label: 'Listelere giren dizi',
      value: `${s.contSeries.data.seriesCount}`,
      detail: null,
    },
    ok(s.contCountries) && {
      key: 'countries',
      label: 'Türk dizisi listelenen ülke',
      value: `${s.contCountries.data.listed} / ${s.contCountries.data.total}`,
      detail: null,
    },
    ok(s.yearReading) && {
      key: 'reading',
      label: 'Okunma',
      value: fmt(s.yearReading.data.total),
      detail: 'kıtanın dillerinde',
    },
    ok(s.yearTourism) && {
      key: 'tourism',
      label: 'Ziyaretçi',
      value: fmt(s.yearTourism.data.total),
      detail:
        s.yearTourism.data.changePct != null
          ? `önceki yıla göre ${s.yearTourism.data.changePct > 0 ? '+' : ''}${s.yearTourism.data.changePct}%`
          : null,
    },
  ].filter(Boolean)
  const sentences = []
  if (ok(s.contSeries)) {
    const t = s.contSeries.data.top[0]
    sentences.push({
      basis: 'lists',
      text: `${label} döneminde ${name} ülkelerinde ${s.contSeries.data.seriesCount} Türk dizisi listelere girdi; en çok izlenen ${t.name} (${t.countries.length} ülkede, toplam ${t.countryWeeks} ülke-hafta).`,
    })
  }
  if (ok(s.contCountries)) {
    const top = s.contCountries.data.rows.find((c) => c.series)
    if (top)
      sentences.push({
        basis: 'countries',
        text: `Türk dizilerinin en çok listeye girdiği ülke ${nameOf(top.iso2)} (${top.series} dizi).`,
      })
  }
  if (ok(s.yearTourism) && s.yearTourism.data.changePct != null)
    sentences.push({
      basis: 'tourism',
      text: `Kıtadan Türkiye’ye gelen ziyaretçi sayısı önceki yılın aynı aylarına göre %${Math.abs(s.yearTourism.data.changePct)} ${s.yearTourism.data.changePct >= 0 ? 'arttı' : 'azaldı'}.`,
    })
  if (!kpis.length && !sentences.length) sentences.push({ basis: 'empty', text: 'Bu dönem için kayıtlı veri yok.' })
  const chapters = chaptersOf(CONTINENT_CHAPTERS, sections)
  for (const ch of chapters)
    for (const sec of ch.sections)
      if (sec.key === 'yearReading')
        sec.caveat = 'Kıtanın ülkelerinde konuşulan dillerdeki okunma; aynı dil başka kıtalarda da okunur.'
  const report = {
    title: `Kıta raporu — ${label}`,
    continent: id,
    continentName: name,
    period: { from: period.from, to: period.to, label, partial, lastDay: to },
    generatedAt: now.toISOString(),
    isTracked: true,
    summary: { kpis, sentences, caveat: periodCaveat(from, to, partial) },
    chapters,
    contract: YEAR_REPORT_CONTRACT,
  }
  setCached(key, report, CACHE_TTL_MS)
  return report
}
