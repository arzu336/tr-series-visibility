import { getCached, setCached } from '../cache.js'
import { getEnrichedVisibility } from '../data-pipeline.js'
import { getPipelineDb } from './pipelineDb.js'
import { getWatchSignals } from './watchSignal.js'
import { languagesOfCountry } from '../../src/lib/langCountries.js'
import { EMPTY } from '../../src/lib/emptyStates.js'
import db from '../db.js'

// Liste okuyucu: chart_entries (pipeline.db, Python yazar) → arayüzün gösterdiği listeler.
// Sağlayıcıdan bağımsız tek biçim: { rank, seriesId, name, kind, weeksInList, trend }. Her listenin
// altına kaynak etiketi (provider, period, fetchedAt) eklenir. Uydurma yok: boş dönem boş döner.

export const PROVIDER_LABELS = {
  netflix_tudum: {
    label: 'Netflix Top 10',
    platform: 'Netflix',
    period: 'haftalık',
    url: 'https://www.netflix.com/tudum/top10',
  },
  reytingtv: {
    label: 'Türkiye TV Top 10',
    platform: 'reytingtv.com (TİAK sırası)',
    period: 'günlük',
    url: 'https://reytingtv.com',
  },
}
export const WINDOW_WEEKS = 52
export const YEAR_AGO_TOLERANCE_DAYS = 28
const CACHE_TTL_MS = 30 * 60 * 1000

export function addDays(ymd, d) {
  const t = new Date(ymd + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + d)
  return t.toISOString().slice(0, 10)
}

function sourceOf(provider, rows) {
  const fetched =
    rows
      .map((r) => r.fetched_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null
  return { provider, ...PROVIDER_LABELS[provider], fetchedAt: fetched }
}

// ---------------------------------------------------------------- saf hesaplar (test edilebilir)

/**
 * Belirli hafta/gün için liste; önceki döneme göre trend ('↑n' | '↓n' | '=' | 'yeni' | 'tekrar') ve o dönem
 * itibarıyla kaç dönemdir listede. 'tekrar': daha önce listede bulunmuş, önceki dönemde yokken geri girmiş.
 */
export function chartForPeriod(rows, periodDate, { prevPeriodDate = null, nameOf = (id, raw) => raw } = {}) {
  const cur = rows.filter((r) => r.period_date === periodDate).sort((a, b) => a.rank - b.rank)
  const prev = new Map(rows.filter((r) => r.period_date === prevPeriodDate).map((r) => [keyOf(r), r.rank]))
  return cur.map((r) => {
    const k = keyOf(r)
    const weeksInList = rows.filter((x) => keyOf(x) === k && x.period_date <= periodDate).length
    const p = prevPeriodDate ? prev.get(k) : undefined
    // Önceki dönemde yoksa: daha önce hiç listede olmadıysa 'yeni', olduysa listeye geri girmiştir ('tekrar').
    const trend =
      p == null
        ? weeksInList > 1
          ? 'tekrar'
          : 'yeni'
        : p > r.rank
          ? `↑${p - r.rank}`
          : p < r.rank
            ? `↓${r.rank - p}`
            : '='
    return {
      rank: r.rank,
      seriesId: r.series_id ?? null,
      name: displayName(r, nameOf),
      titleRaw: r.title_raw,
      kind: r.program_kind || 'unknown',
      weeksInList,
      trend,
      segment: r.segment,
    }
  })
}

// JS \b Türkçe harfleri kelime saymaz; sınırlar açık yazıldı.
const RECAP_RE = /(^|[\s(])(ÖZET|OZET)($|[\s)])/i
/** Bir dizinin özet (tekrar/özet) yayını ayrı satırdır: aynı gün "Daha 17" ve "Daha 17 (özet)" ikisi de listede kalır. */
export function isRecap(r) {
  return r.series_id != null && RECAP_RE.test(r.title_raw || '')
}

function keyOf(r) {
  if (r.series_id != null) return isRecap(r) ? `id:${r.series_id}:ozet` : `id:${r.series_id}`
  return `raw:${r.title_raw}`
}

function displayName(r, nameOf) {
  const n = nameOf(r.series_id, r.title_raw)
  return isRecap(r) ? `${n} (özet)` : n
}

/** Pencere içindeki dizi sıralaması: en çok dönem, sonra en iyi sıra. */
export function topInWindow(rows, fromDate, toDate, { nameOf = (id, raw) => raw, limit = 10 } = {}) {
  const agg = new Map()
  for (const r of rows) {
    if (r.period_date < fromDate || r.period_date > toDate) continue
    const k = keyOf(r)
    const a = agg.get(k) || {
      seriesId: r.series_id ?? null,
      name: displayName(r, nameOf),
      kind: r.program_kind || 'unknown',
      periods: 0,
      bestRank: 99,
      lastDate: null,
      firstDate: null,
    }
    a.periods++
    a.bestRank = Math.min(a.bestRank, r.rank)
    if (!a.lastDate || r.period_date > a.lastDate) a.lastDate = r.period_date
    if (!a.firstDate || r.period_date < a.firstDate) a.firstDate = r.period_date
    agg.set(k, a)
  }
  return [...agg.values()]
    .sort((a, b) => b.periods - a.periods || a.bestRank - b.bestRank || a.name.localeCompare(b.name, 'tr'))
    .slice(0, limit)
}

/**
 * "1 yıl önce": tam aynı dönem doluysa o; boşsa geçen yılın aynı dönemi ±tolerans içinde en yakın dolu dönem
 * (pencere belirtilir); o da boşsa en son listeye girilen dönem. Hiç kayıt yoksa null.
 */
export function yearAgo(rows, periodDate, { toleranceDays = YEAR_AGO_TOLERANCE_DAYS, nameOf } = {}) {
  const target = addDays(periodDate, -364)
  const dates = [...new Set(rows.map((r) => r.period_date))].sort()
  if (dates.includes(target))
    return { mode: 'exact', periodDate: target, entries: chartForPeriod(rows, target, { nameOf }) }
  const from = addDays(target, -toleranceDays)
  const to = addDays(target, toleranceDays)
  const window = dates.filter((d) => d >= from && d <= to)
  if (window.length) {
    const nearest = window.sort(
      (a, b) => Math.abs(new Date(a) - new Date(target)) - Math.abs(new Date(b) - new Date(target))
    )[0]
    return {
      mode: 'window',
      periodDate: nearest,
      window: { from, to },
      entries: chartForPeriod(rows, nearest, { nameOf }),
    }
  }
  // Pencere de boşsa: hedef tarihe en yakın kayıt (cari dönem hariç) — "1 yıl önce liste yoktu; en yakın kayıt …"
  const nearestAny = dates
    .filter((d) => d !== periodDate)
    .sort((a, b) => Math.abs(new Date(a) - new Date(target)) - Math.abs(new Date(b) - new Date(target)))[0]
  if (nearestAny) return { mode: 'last', periodDate: nearestAny, entries: chartForPeriod(rows, nearestAny, { nameOf }) }
  return null
}

/** Ülke zaman çizelgesi: dönem başına listeye giren farklı dizi sayısı ve toplam liste-dönem sayısı. */
export function timeline(rows, range = 'monthly') {
  const key = (d) => (range === 'yearly' ? d.slice(0, 4) : d.slice(0, 7))
  const agg = new Map()
  for (const r of rows) {
    const k = key(r.period_date)
    const a = agg.get(k) || { period: k, series: new Set(), entries: 0, bestRank: 99 }
    a.series.add(keyOf(r))
    a.entries++
    a.bestRank = Math.min(a.bestRank, r.rank)
    agg.set(k, a)
  }
  return [...agg.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((a) => ({ period: a.period, seriesCount: a.series.size, entries: a.entries, bestRank: a.bestRank }))
}

/** Küresel zirve: verilen haftada en çok ülkede listede olan diziler. */
export function globalTopForWeek(rows, week, { nameOf = (id, raw) => raw } = {}) {
  const agg = new Map()
  for (const r of rows) {
    if (r.period_date !== week) continue
    const k = keyOf(r)
    const a = agg.get(k) || {
      seriesId: r.series_id ?? null,
      name: displayName(r, nameOf),
      countries: new Set(),
      top3: 0,
      bestRank: 99,
    }
    a.countries.add(r.country_iso2)
    if (r.rank <= 3) a.top3++
    a.bestRank = Math.min(a.bestRank, r.rank)
    agg.set(k, a)
  }
  return [...agg.values()]
    .map((a) => ({ ...a, countries: a.countries.size, countryList: undefined }))
    .sort((a, b) => b.countries - a.countries || a.bestRank - b.bestRank)
}

// Liste platformları: chart_entries'te Netflix ayrı sağlayıcıdır (netflix_tudum, haftalık); diğerleri
// flixpatrol sağlayıcısından gelir ve platform `segment` alanında taşınır (günlük anlık görüntü).
// 'tv' = Türkiye TV günlük listesi (reytingtv, Total kategorisi) — yalnızca Türkiye panelinde.
export const PLATFORM_LABELS = {
  netflix: 'Netflix',
  disney: 'Disney+',
  'amazon-prime': 'Prime Video',
  'hbo-max': 'HBO Max',
  'apple-tv': 'Apple TV+',
  shahid: 'Shahid',
  tv: 'TV',
}
/** Bu kadar günden eski bir platform listesi "şu an" sayılmaz. */
export const LIST_STALE_DAYS = 14

const platformLabel = (slug) => PLATFORM_LABELS[slug] ?? slug

/** Tarihin ait olduğu haftanın Pazar günü (Netflix hafta anahtarıyla aynı biçim). */
export function weekEndOf(ymd) {
  const dow = new Date(ymd + 'T00:00:00Z').getUTCDay()
  return addDays(ymd, (7 - dow) % 7)
}

/**
 * Ülke listeleri, tüm platformlar birlikte. `now`: her platformun en güncel listesindeki Türk dizileri
 * (gerçek sıra + platform). `top`: son 52 haftada en çok hafta listede kalanlar (hangi platformlarda).
 * Yalnızca kataloğa eşleşen diziler alınır; eşleşmeyen satırlar (yabancı yapımlar) listeye girmez.
 */
export function buildCountryLists({
  netflixRows = [],
  flixRows = [],
  latestWeek = null,
  prevWeek = null,
  today = new Date().toISOString().slice(0, 10),
  nameOf = (id, raw) => raw,
} = {}) {
  const now = []
  if (latestWeek)
    for (const it of chartForPeriod(netflixRows, latestWeek, { prevPeriodDate: prevWeek, nameOf }))
      now.push({ ...it, platform: PLATFORM_LABELS.netflix })

  const bySlug = new Map()
  for (const r of flixRows) {
    if (!bySlug.has(r.segment)) bySlug.set(r.segment, [])
    bySlug.get(r.segment).push(r)
  }
  const isSeries = (r) => r.series_id != null && r.program_kind === 'series'
  const staleBefore = addDays(today, -LIST_STALE_DAYS)
  let flixLatest = null
  for (const [slug, all] of bySlug) {
    // Tarihler TÜM satırlardan: önceki anlık görüntüde Türk dizisi olmasa da "önceki dönem" odur.
    const dates = [...new Set(all.map((r) => r.period_date))].sort()
    const last = dates.at(-1)
    if (!flixLatest || last > flixLatest) flixLatest = last
    if (last < staleBefore) continue
    const series = all.filter(isSeries)
    for (const it of chartForPeriod(series, last, { prevPeriodDate: dates.at(-2) ?? null, nameOf }))
      now.push({ ...it, platform: platformLabel(slug) })
  }
  const merged = mergeAcrossPlatforms(now)

  const to = [latestWeek, flixLatest].filter(Boolean).sort().at(-1) ?? null
  const from = to ? addDays(to, -(WINDOW_WEEKS * 7 - 1)) : null
  const agg = new Map()
  if (to) {
    const tagged = [...netflixRows.map((r) => [r, 'netflix']), ...flixRows.filter(isSeries).map((r) => [r, r.segment])]
    for (const [r, slug] of tagged) {
      if (r.period_date < from || r.period_date > to) continue
      const k = keyOf(r)
      const a = agg.get(k) || {
        seriesId: r.series_id ?? null,
        name: displayName(r, nameOf),
        kind: r.program_kind || 'unknown',
        weekSet: new Set(),
        platformSet: new Set(),
        bestRank: 99,
        lastDate: null,
      }
      a.weekSet.add(weekEndOf(r.period_date))
      a.platformSet.add(platformLabel(slug))
      a.bestRank = Math.min(a.bestRank, r.rank)
      if (!a.lastDate || r.period_date > a.lastDate) a.lastDate = r.period_date
      agg.set(k, a)
    }
  }
  const top = [...agg.values()]
    .map(({ weekSet, platformSet, ...a }) => ({ ...a, periods: weekSet.size, platforms: [...platformSet].sort() }))
    .sort((a, b) => b.periods - a.periods || a.bestRank - b.bestRank || a.name.localeCompare(b.name, 'tr'))
    .slice(0, 10)

  return { now: merged, top, window: to ? { from, to, weeks: WINDOW_WEEKS } : null }
}

/**
 * Aynı dizi aynı anda birden çok platformun listesindeyse (ör. Eşref Rüya hem Prime Video hem Shahid'de 10.)
 * tek satır: en iyi sıradaki kayıt esas alınır, platformlar en iyi sıradan başlayarak birlikte yazılır,
 * "kaç haftadır listede" en uzunu. Özet yayını farklı ad taşıdığı için ayrı kalır.
 */
export function mergeAcrossPlatforms(items) {
  const sorted = [...items].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'tr'))
  const byKey = new Map()
  for (const it of sorted) {
    const k = `${it.seriesId ?? `raw:${it.titleRaw}`}|${it.name}`
    const cur = byKey.get(k)
    if (!cur) {
      byKey.set(k, { ...it, platforms: [it.platform] })
      continue
    }
    if (!cur.platforms.includes(it.platform)) cur.platforms.push(it.platform)
    cur.weeksInList = Math.max(cur.weeksInList ?? 0, it.weeksInList ?? 0)
  }
  return [...byKey.values()].map((it) => ({ ...it, platform: it.platforms.join(' · ') }))
}

// ---------------------------------------------------------------- okuyucular

/**
 * Aynı dönemde aynı dizinin birden çok satırını tek satıra indirir, en iyi sıra kalır. Netflix her sezonu
 * ayrı listeler (ör. "Graveyard" aynı hafta 3. ve 10.): ayrı tutulunca dizi listede iki kez görünüyor ve
 * "kaç haftadır listede" sayıları şişiyordu. Özet yayını (Türkiye TV) ayrı anahtar olduğu için, farklı
 * platformlar da segment farklı olduğu için ayrı kalır.
 */
export function collapseSeasons(rows) {
  const best = new Map()
  for (const r of rows) {
    const k = `${r.provider}|${r.country_iso2}|${r.period_date}|${r.segment}|${keyOf(r)}`
    const cur = best.get(k)
    if (!cur || r.rank < cur.rank) best.set(k, r)
  }
  return best.size === rows.length ? rows : [...best.values()]
}

function readRows(conn, where, params) {
  try {
    return collapseSeasons(
      conn
        .prepare(
          `SELECT provider, country_iso2, period_type, period_date, segment, rank, series_id, title_raw, program_kind, fetched_at FROM chart_entries WHERE ${where}`
        )
        .all(...params)
    )
  } catch {
    return []
  }
}

async function namer() {
  const { raw } = await getEnrichedVisibility()
  const byId = new Map(raw.series.map((s) => [s.id, s.name]))
  return (id, rawTitle) => (id != null && byId.has(id) ? byId.get(id) : rawTitle)
}

export async function getChartsMeta() {
  const conn = getPipelineDb()
  if (!conn) return { available: false, reason: EMPTY.netflixDbMissing }
  const weeks = readRows(conn, "provider='netflix_tudum'", []).map((r) => r.period_date)
  const tvDays = readRows(conn, "provider='reytingtv'", []).map((r) => r.period_date)
  const uniq = (a) => [...new Set(a)].sort()
  const nf = uniq(weeks)
  const tv = uniq(tvDays)
  const sources = {}
  for (const p of Object.keys(PROVIDER_LABELS)) {
    const rows = readRows(conn, 'provider=?', [p])
    sources[p] = {
      ...sourceOf(p, rows),
      rows: rows.length,
      first: rows.map((r) => r.period_date).sort()[0] ?? null,
      last:
        rows
          .map((r) => r.period_date)
          .sort()
          .at(-1) ?? null,
    }
  }
  return {
    available: true,
    netflix: { weeks: nf, latest: nf.at(-1) ?? null },
    turkeyTv: { days: tv, latest: tv.at(-1) ?? null },
    sources,
  }
}

export async function getGlobalTop({ week } = {}) {
  const conn = getPipelineDb()
  if (!conn) return { status: 'hesaplanamaz', reason: EMPTY.netflixDbMissing, items: [] }
  const rows = readRows(conn, "provider='netflix_tudum'", [])
  const weeks = [...new Set(rows.map((r) => r.period_date))].sort()
  const w = week && weeks.includes(week) ? week : weeks.at(-1)
  if (!w) return { status: 'hesaplanamaz', reason: EMPTY.netflixTableMissing, items: [] }
  const nameOf = await namer()
  const items = globalTopForWeek(rows, w, { nameOf })
  const ya = yearAgoGlobal(rows, w, nameOf)
  return { status: 'hesaplandi', week: w, weeks, items, yearAgo: ya, source: sourceOf('netflix_tudum', rows) }
}

function yearAgoGlobal(rows, week, nameOf) {
  const target = addDays(week, -364)
  const weeks = [...new Set(rows.map((r) => r.period_date))].sort()
  const pick = (w) => ({ week: w, items: globalTopForWeek(rows, w, { nameOf }) })
  if (weeks.includes(target) && rows.some((r) => r.period_date === target)) return { mode: 'exact', ...pick(target) }
  const from = addDays(target, -YEAR_AGO_TOLERANCE_DAYS)
  const to = addDays(target, YEAR_AGO_TOLERANCE_DAYS)
  const win = weeks.filter((d) => d >= from && d <= to)
  if (win.length) {
    const nearest = win.sort(
      (a, b) => Math.abs(new Date(a) - new Date(target)) - Math.abs(new Date(b) - new Date(target))
    )[0]
    return { mode: 'window', window: { from, to }, ...pick(nearest) }
  }
  const last = weeks.filter((d) => d < week).at(-1)
  return last ? { mode: 'last', ...pick(last) } : null
}

export async function getTurkeyTv({ date, segment = 'Total', onlySeries = true } = {}) {
  const conn = getPipelineDb()
  if (!conn) return { status: 'hesaplanamaz', reason: EMPTY.netflixDbMissing, items: [] }
  const all = readRows(conn, "provider='reytingtv' AND segment=?", [segment])
  const days = [...new Set(all.map((r) => r.period_date))].sort()
  const d = date && days.includes(date) ? date : days.at(-1)
  if (!d)
    return {
      status: 'hesaplanamaz',
      reason: 'Türkiye TV listesi henüz çekilmedi (backfill_reytingtv.py)',
      items: [],
      days: [],
    }
  const nameOf = await namer()
  const prev = days[days.indexOf(d) - 1] ?? null
  const filt = (items) => (onlySeries ? items.filter((i) => i.kind === 'series') : items)
  const items = filt(chartForPeriod(all, d, { prevPeriodDate: prev, nameOf }))
  const ya = yearAgo(all, d, { nameOf })
  if (ya) ya.entries = filt(ya.entries)
  const segments = [...new Set(readRows(conn, "provider='reytingtv'", []).map((r) => r.segment))].sort()
  return {
    status: 'hesaplandi',
    date: d,
    days,
    segment,
    segments,
    onlySeries,
    items,
    hiddenCount: onlySeries ? chartForPeriod(all, d, { nameOf }).length - items.length : 0,
    yearAgo: ya,
    source: sourceOf('reytingtv', all),
  }
}

/** Ülke paneli: kaynak sırasına göre gerçekler + liste + 1 yıl önce + zaman çizelgesi. */
export async function getCountryCharts(iso2, { week, range = 'monthly' } = {}) {
  const cacheKey = `charts:country:v6:${iso2}:${week ?? 'latest'}:${range}`
  const cached = getCached(cacheKey)
  if (cached) return cached
  const conn = getPipelineDb()
  const [{ data, raw }, signals] = await Promise.all([getEnrichedVisibility(), getWatchSignals().catch(() => null)])
  const nameOf = await namer()
  const country = data.countries.find((c) => c.iso2 === iso2) || null
  const sig = signals?.byIso2?.[iso2] ?? null
  const rows = conn ? readRows(conn, "provider='netflix_tudum' AND country_iso2=?", [iso2]) : []
  const allWeeks = conn
    ? [...new Set(readRows(conn, "provider='netflix_tudum'", []).map((r) => r.period_date))].sort()
    : []
  const latest = week && allWeeks.includes(week) ? week : (allWeeks.at(-1) ?? null)
  const prev = latest ? (allWeeks[allWeeks.indexOf(latest) - 1] ?? null) : null
  const from = latest ? addDays(latest, -(WINDOW_WEEKS * 7 - 1)) : null
  const inWindow = latest ? rows.filter((r) => r.period_date >= from && r.period_date <= latest) : []
  const netflixActive = Boolean(sig?.components?.netflix?.present)
  const facts = []

  // 1) Netflix
  let netflix = null
  if (latest && netflixActive) {
    const series = new Set(inWindow.map((r) => keyOf(r)))
    netflix = {
      status: 'hesaplandi',
      window: { from, to: latest, weeks: WINDOW_WEEKS },
      seriesCount: series.size,
      weeks: inWindow.length,
      bestRank: inWindow.length ? Math.min(...inWindow.map((r) => r.rank)) : null,
      now: chartForPeriod(rows, latest, { prevPeriodDate: prev, nameOf }),
      top: topInWindow(rows, from, latest, { nameOf, limit: 10 }),
      yearAgo: yearAgo(rows, latest, { nameOf }),
      lastEntry: rows.length
        ? rows
            .map((r) => r.period_date)
            .sort()
            .at(-1)
        : null,
      source: sourceOf('netflix_tudum', rows),
    }
    facts.push({
      source: 'netflix_tudum',
      kind: 'netflix',
      text: inWindow.length
        ? `Netflix Top 10'da ${series.size} Türk dizisi · ${inWindow.length} hafta · en iyi sıra ${netflix.bestRank}`
        : `Netflix Top 10 (son ${WINDOW_WEEKS} hafta): Türk dizisi girmedi${netflix.lastEntry ? `; son giriş ${netflix.lastEntry}` : ''}`,
    })
  } else if (latest) {
    const lastRow =
      rows
        .map((r) => r.period_date)
        .sort()
        .at(-1) ?? null
    netflix = {
      status: 'hesaplanamaz',
      reason: lastRow
        ? `Netflix bu pazarda son ${WINDOW_WEEKS} haftada Top 10 yayımlamadı (dosyadaki son hafta ${lastRow})`
        : EMPTY.netflixNotPublished,
      lastEntry: lastRow,
    }
  }

  // Tüm platformlar birlikte: Netflix (haftalık) + FlixPatrol platformları (anlık görüntü) + Türkiye
  // panelinde Türkiye TV günlük listesi (Total kategorisi; platform olarak 'tv').
  const tvRows =
    conn && iso2 === 'TR'
      ? readRows(conn, "provider='reytingtv' AND segment='Total'", []).map((r) => ({ ...r, segment: 'tv' }))
      : []
  const platformRows = [...(conn ? readRows(conn, "provider='flixpatrol' AND country_iso2=?", [iso2]) : []), ...tvRows]
  const posterById = new Map(raw.series.map((sr) => [sr.id, sr.posterPath || null]))
  const withPoster = (items) =>
    items.map((it) => ({ ...it, posterPath: it.seriesId != null ? (posterById.get(it.seriesId) ?? null) : null }))
  const built = buildCountryLists({
    netflixRows: rows,
    flixRows: platformRows,
    latestWeek: latest,
    prevWeek: prev,
    nameOf,
  })
  const lists = { ...built, now: withPoster(built.now), top: withPoster(built.top) }
  const flixSeries = platformRows.filter((r) => r.series_id != null && r.program_kind === 'series')
  // Türkiye TV'nin en son yayımlanan günü ayrı liste olarak (tarihiyle): kaynak düzensiz yayımladığı
  // için "şu an" listesine giremeyecek kadar eski olabilir; tarih açıkça gösterilir.
  let turkeyTv = null
  if (iso2 === 'TR') {
    const tv = await getTurkeyTv({ segment: 'Total', onlySeries: true })
    turkeyTv = tv.status === 'hesaplandi' ? { date: tv.date, items: withPoster(tv.items) } : null
  }

  // 2) Wikipedia (ülkenin dilleri)
  const langs = languagesOfCountry(iso2)
  const wiki = []
  if (langs.length) {
    const d = new Date()
    d.setUTCMonth(d.getUTCMonth() - 12)
    const cutoff = d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1)
    for (const { lang, regional } of langs) {
      const rs = db
        .prepare(
          'SELECT tmdb_id, SUM(views) v FROM series_language_interest WHERE lang=? AND (year*100+month)>? GROUP BY tmdb_id ORDER BY v DESC LIMIT 5'
        )
        .all(lang, cutoff)
      if (rs.length)
        wiki.push({
          lang,
          regional,
          items: rs.map((r) => ({ seriesId: r.tmdb_id, name: nameOf(r.tmdb_id, `#${r.tmdb_id}`), views: r.v })),
        })
    }
  }
  if (wiki.length) {
    const w = wiki[0]
    facts.push({
      source: 'wikipedia',
      kind: 'wiki',
      text: `Wikipedia'da en çok okunan (12 ay, ${w.lang} Vikipedi${w.regional ? '; ortak dil, okunma ülkeye ayrılamaz' : ''}): ${w.items
        .slice(0, 3)
        .map((i) => `${i.name} ${Math.round(i.views / 1000)}k`)
        .join(', ')}`,
    })
  }

  // 3) Arama
  const s = sig?.components?.search
  if (s?.present)
    facts.push({
      source: 'google_trends',
      kind: 'search',
      text: `Google Trends (önbellek): ${s.seriesQueried} diziden ${s.seriesWithInterest}'inde ölçülebilir ilgi${s.localTitleHits ? `, ${s.localTitleHits}'i yerel adla` : ''}`,
    })

  // 4) Erişim gerçekleri
  let access = null
  if (country && country.dataSource !== 'proxy') {
    const provs = new Map()
    for (const sr of raw.series) {
      const e = raw.providersById[sr.id]?.[iso2]
      if (!e) continue
      for (const k of ['flatrate', 'free', 'ads', 'rent', 'buy'])
        for (const p of e[k] || []) provs.set(p.provider_name, (provs.get(p.provider_name) || 0) + 1)
    }
    access = {
      seriesCount: country.seriesCount,
      platformCount: provs.size,
      platforms: [...provs.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    }
    facts.push({
      source: 'tmdb_providers',
      kind: 'access',
      text: `Yayın varlığı: ${access.seriesCount} dizi yayında, ${access.platformCount} platformda`,
    })
  } else {
    facts.push({ source: 'tmdb_providers', kind: 'access', text: EMPTY.visibilityHistoryProxy })
  }

  const primary =
    facts.find((f) => f.kind === 'netflix' && netflix?.status === 'hesaplandi' && netflix.weeks > 0) ||
    facts.find((f) => f.kind === 'wiki') ||
    facts.find((f) => f.kind === 'search') ||
    facts[0] ||
    null
  const out = {
    iso2,
    latestWeek: latest,
    watch: sig
      ? {
          level: sig.level,
          index: sig.index,
          confidence: sig.confidence,
          opportunity: sig.opportunity,
          warnings: sig.warnings,
        }
      : null,
    primary,
    facts,
    netflix,
    wiki,
    access,
    lists,
    turkeyTv,
    timeline: timeline([...rows, ...flixSeries], range),
    timelineRange: range,
  }
  setCached(cacheKey, out, CACHE_TTL_MS)
  return out
}

/** Kıta paneli: lider (izlenme düzeyi), en çok izlenen dizi (52 hafta ülke-hafta), bu hafta listede kaç Türk dizisi. */
export async function getContinentCharts(continentByIso2, continents) {
  const conn = getPipelineDb()
  const [{ data }, signals] = await Promise.all([getEnrichedVisibility(), getWatchSignals().catch(() => null)])
  const nameOf = await namer()
  const rows = conn ? readRows(conn, "provider='netflix_tudum'", []) : []
  const weeks = [...new Set(rows.map((r) => r.period_date))].sort()
  const latest = weeks.at(-1) ?? null
  const from = latest ? addDays(latest, -(WINDOW_WEEKS * 7 - 1)) : null
  return continents.map(({ id, name }) => {
    const isos = data.countries.filter((c) => continentByIso2[c.iso2] === id && c.iso2 !== 'TR').map((c) => c.iso2)
    const set = new Set(isos)
    const scored = isos
      .map((i) => [i, signals?.byIso2?.[i]])
      .filter(([, s]) => s?.index != null)
      .sort((a, b) => b[1].index - a[1].index)
    const leader = scored[0] ? { iso2: scored[0][0], level: scored[0][1].level, index: scored[0][1].index } : null
    const levels = {}
    for (const [, s] of scored) levels[s.level] = (levels[s.level] || 0) + 1
    const cont = rows.filter((r) => set.has(r.country_iso2))
    const top = latest ? topInWindow(cont, from, latest, { nameOf, limit: 3 }) : []
    const thisWeek = latest ? new Set(cont.filter((r) => r.period_date === latest).map((r) => keyOf(r))).size : 0
    const topCountries = isos
      .map((i) => ({
        iso2: i,
        index: signals?.byIso2?.[i]?.index ?? null,
        level: signals?.byIso2?.[i]?.level ?? null,
        weeks: cont.filter((r) => r.country_iso2 === i && latest && r.period_date >= from).length,
      }))
      .filter((c) => c.index != null)
      .sort((a, b) => b.index - a.index)
      .slice(0, 5)
    return {
      id,
      name,
      countryCount: isos.length,
      leader,
      levels,
      topSeries: top[0] ? { ...top[0], countryWeeks: top[0].periods } : null,
      topSeriesList: top,
      thisWeekSeriesCount: thisWeek,
      topCountries,
      latestWeek: latest,
    }
  })
}

/**
 * Dizinin girdiği tüm listeler, ülke × platform: Netflix (haftalık), FlixPatrol platformları ve Türkiye TV.
 * Hafta = farklı takvim haftası (aynı hafta birden çok anlık görüntü tek sayılır). En son girilen önce.
 */
export function seriesListings({ netflixRows = [], flixRows = [], tvRows = [] } = {}) {
  const agg = new Map()
  const tagged = [
    ...netflixRows.map((r) => [r, 'netflix']),
    ...flixRows.map((r) => [r, r.segment]),
    ...tvRows.map((r) => [r, 'tv']),
  ]
  for (const [r, slug] of tagged) {
    const k = `${r.country_iso2}|${slug}`
    const a = agg.get(k) || {
      iso2: r.country_iso2,
      platform: platformLabel(slug),
      weekSet: new Set(),
      bestRank: 99,
      lastDate: null,
    }
    a.weekSet.add(weekEndOf(r.period_date))
    a.bestRank = Math.min(a.bestRank, r.rank)
    if (!a.lastDate || r.period_date > a.lastDate) a.lastDate = r.period_date
    agg.set(k, a)
  }
  return [...agg.values()]
    .map(({ weekSet, ...a }) => ({ ...a, weeks: weekSet.size }))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.weeks - a.weeks || a.bestRank - b.bestRank)
}

/** Dizi seçilince: listeye girdiği ülkeler (Netflix; hafta sayısı, en iyi sıra), tüm platform listeleri, sıra geçmişi. */
export async function getSeriesCharts(tmdbId) {
  const conn = getPipelineDb()
  if (!conn) return { status: 'hesaplanamaz', reason: EMPTY.netflixDbMissing, countries: [], history: [] }
  const rows = readRows(conn, "provider='netflix_tudum' AND series_id=?", [tmdbId])
  const tv = readRows(conn, "provider='reytingtv' AND series_id=? AND segment='Total'", [tmdbId])
  const flix = readRows(conn, "provider='flixpatrol' AND series_id=? AND program_kind='series'", [tmdbId])
  const listings = seriesListings({ netflixRows: rows, flixRows: flix, tvRows: tv })
  const byC = new Map()
  for (const r of rows) {
    const a = byC.get(r.country_iso2) || {
      iso2: r.country_iso2,
      weeks: 0,
      bestRank: 99,
      lastWeek: null,
      firstWeek: null,
    }
    a.weeks++
    a.bestRank = Math.min(a.bestRank, r.rank)
    if (!a.lastWeek || r.period_date > a.lastWeek) a.lastWeek = r.period_date
    if (!a.firstWeek || r.period_date < a.firstWeek) a.firstWeek = r.period_date
    byC.set(r.country_iso2, a)
  }
  const history = timeline(rows, 'monthly').map((t) => ({
    period: t.period,
    countries: t.seriesCount === 0 ? 0 : undefined,
    entries: t.entries,
    bestRank: t.bestRank,
  }))
  const any = rows.length || tv.length || flix.length
  return {
    status: any ? 'hesaplandi' : 'hesaplanamaz',
    reason: any ? null : 'Bu dizi hiçbir listeye girmedi.',
    tmdbId,
    listings,
    countries: [...byC.values()].sort((a, b) => b.weeks - a.weeks || a.bestRank - b.bestRank),
    totalWeeks: rows.length,
    history,
    turkeyTv: tv.length
      ? {
          days: tv.length,
          bestRank: Math.min(...tv.map((r) => r.rank)),
          lastDay: tv
            .map((r) => r.period_date)
            .sort()
            .at(-1),
        }
      : null,
    source: sourceOf('netflix_tudum', rows),
  }
}
