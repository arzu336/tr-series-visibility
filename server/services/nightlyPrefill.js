import db from '../db.js'
import { getEnrichedVisibility } from '../data-pipeline.js'
import { getAllOwnRankings } from './charts.js'
import { getSeriesPressCountries } from './newsScanTargets.js'
import { scanSeriesAcrossCountries } from './autoNewsScheduler.js'
import { getCountryRegionalInterest, regionalCandidates, readCountryRegionalInterest } from '../regional-interest.js'
import { getSerpApiUsageThisMonth, refreshSerpApiAccountUsage } from './serpApiCache.js'

// Gece ön doldurma (2026-10-09, kullanıcı kararı: "kullanıcı tıklayınca ücretli sorgu yapılmasın, gece arka planda
// önceden yapılsın"). Türkiye saatiyle 01:00–10:00 arasında günde bir kez:
//   1) Basın: dizi raporu açılınca hazır gelsin diye, taraması olmayan ya da süresi dolmuş diziler (önce gün içinde
//      açılıp hazır bulunamayanlar, sonra listelere girdiği ülke sayısına göre) öne çıktığı ülkelerde taranır.
//   2) Bölgesel ilgi: ülke paneli için ülkelerin bölge kırılımı (önce gün içinde açılanlar, sonra görünürlüğe göre).
// Her gece en fazla PRESS_MAX_QUERIES + REGIONAL_MAX_QUERIES ücretli sorgu; hesap kullanımı kotanın %80'ine
// ulaştıysa hiç başlamaz.

export const NIGHT_START_HOUR = 1
// Sabah 10'a kadar (2026-10-09, kullanıcı isteği): sunucu gece kapalıysa sabah açıldığında yine çalışır; günde bir kez.
export const NIGHT_END_HOUR = 10
export const PRESS_MAX_QUERIES = 40
export const REGIONAL_MAX_QUERIES = 40
const PRESS_COUNTRIES = 6
const PRESS_MIN_FRESH = 3
const USAGE_STOP_SHARE = 0.8
const MAX_RUN_MS = 45 * 60 * 1000
const META_DAY = 'lastNightlyPrefillDay'
const PRESS_QUEUE = 'prefillQueue:press:'
const REGIONAL_QUEUE = 'prefillQueue:regional:'

const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMeta = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)
const delMeta = db.prepare('DELETE FROM meta WHERE key = ?')
const queueRows = db.prepare('SELECT key, value FROM meta WHERE key LIKE ? ORDER BY value')
const freshPressStmt = db.prepare(
  'SELECT series_id, country_iso2 FROM media_sentiment WHERE expires_at > ? AND source = ?'
)

/** Türkiye saati: { day: 'YYYY-MM-DD', hour }. */
export function istanbulClock(now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value])
  )
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 }
}

/** Gün içinde açılıp hazır bulunamayan dizi/ülke gece önce alınır. */
export function queuePress(seriesId) {
  setMeta.run(`${PRESS_QUEUE}${seriesId}`, String(Date.now()))
}
export function queueRegional(iso2) {
  setMeta.run(`${REGIONAL_QUEUE}${iso2}`, String(Date.now()))
}
const queued = (prefix) => queueRows.all(`${prefix}%`).map((r) => r.key.slice(prefix.length))

/**
 * Basın sırası (saf): kuyruktakiler önce, sonra listelere girdiği ülke sayısı (çoktan aza), sonra popülerlik; taze
 * kaydı PRESS_MIN_FRESH ve üstünde olan dizi atlanır.
 */
export function pressOrder({ series, freshCount, listedCount, queue = [] }) {
  const q = new Set(queue.map(Number))
  return series
    .filter((s) => (freshCount.get(s.id) ?? 0) < PRESS_MIN_FRESH)
    .sort(
      (a, b) =>
        Number(q.has(b.id)) - Number(q.has(a.id)) ||
        (listedCount.get(b.id) ?? 0) - (listedCount.get(a.id) ?? 0) ||
        (b.popularity ?? 0) - (a.popularity ?? 0)
    )
}

function overBudget() {
  const u = getSerpApiUsageThisMonth()
  return u.used >= u.budget * USAGE_STOP_SHARE
}

async function prefillPress({
  raw,
  rankings,
  deadline,
  scan = scanSeriesAcrossCountries,
  countriesFor = getSeriesPressCountries,
}) {
  const fresh = freshPressStmt.all(Date.now(), 'google_news')
  const freshCount = new Map()
  const freshPairs = new Set()
  for (const r of fresh) {
    freshCount.set(r.series_id, (freshCount.get(r.series_id) ?? 0) + 1)
    freshPairs.add(`${r.series_id}|${r.country_iso2}`)
  }
  const listedCount = new Map()
  for (const own of rankings.values())
    for (const e of own.all || [])
      if (e.seriesId != null) listedCount.set(e.seriesId, (listedCount.get(e.seriesId) ?? 0) + 1)
  const queue = queued(PRESS_QUEUE)
  let queries = 0
  let series = 0
  for (const s of pressOrder({ series: raw.series, freshCount, listedCount, queue })) {
    if (queries >= PRESS_MAX_QUERIES || Date.now() >= deadline || overBudget()) break
    const countries = (await countriesFor(s.id, { limit: PRESS_COUNTRIES }))
      .filter((iso2) => !freshPairs.has(`${s.id}|${iso2}`))
      .slice(0, PRESS_MAX_QUERIES - queries)
    if (countries.length) {
      const r = await scan(s.id, s.name, countries, { throttle: true, deadline })
      queries += r.liveCalls
      series++
    }
    delMeta.run(`${PRESS_QUEUE}${s.id}`)
  }
  return { series, queries }
}

async function prefillRegional({ data, raw, rankings, deadline, fetchRegional = getCountryRegionalInterest }) {
  const queue = new Set(queued(REGIONAL_QUEUE))
  const order = [...data.countries]
    .filter((c) => c.iso2 !== 'TR')
    .sort((a, b) => Number(queue.has(b.iso2)) - Number(queue.has(a.iso2)) || (b.score ?? 0) - (a.score ?? 0))
  let queries = 0
  let countries = 0
  for (const c of order) {
    if (queries >= REGIONAL_MAX_QUERIES || Date.now() >= deadline || overBudget()) break
    const candidates = regionalCandidates(c.iso2, { data, raw, rankings })
    if (!candidates.length) continue
    // Kayıtlı (süresi dolmamış) sonucu olan ülke atlanır.
    if (readCountryRegionalInterest(c.iso2, candidates, { freshOnly: true })) {
      delMeta.run(`${REGIONAL_QUEUE}${c.iso2}`)
      continue
    }
    const once = getSerpApiUsageThisMonth().ownCounter
    await fetchRegional(c.iso2, candidates).catch((err) =>
      console.error(`[nightlyPrefill] ${c.iso2} bölgesel ilgi alınamadı:`, err.message)
    )
    queries += Math.max(0, getSerpApiUsageThisMonth().ownCounter - once)
    countries++
    delMeta.run(`${REGIONAL_QUEUE}${c.iso2}`)
  }
  return { countries, queries }
}

export async function runNightlyPrefillIfNeeded({ now = new Date(), deps = {} } = {}) {
  const { day, hour } = istanbulClock(now)
  if (hour < NIGHT_START_HOUR || hour >= NIGHT_END_HOUR) return { skipped: 'gündüz' }
  if (getMeta.get(META_DAY)?.value === day) return { skipped: 'bu gece yapıldı' }
  await refreshSerpApiAccountUsage().catch(() => null)
  if (overBudget()) {
    console.log('[nightlyPrefill] SerpApi kullanımı kotanın %80’inde; gece ön doldurma atlandı.')
    setMeta.run(META_DAY, day)
    return { skipped: 'kota' }
  }
  const deadline = Date.now() + MAX_RUN_MS
  const [{ data, raw }, rankings] = await Promise.all([getEnrichedVisibility(), getAllOwnRankings()])
  const press = await prefillPress({ raw, rankings, deadline, ...deps })
  const regional = await prefillRegional({ data, raw, rankings, deadline, ...deps })
  setMeta.run(META_DAY, day)
  console.log(
    `[nightlyPrefill] basın: ${press.series} dizi / ${press.queries} sorgu · bölgesel: ${regional.countries} ülke / ${regional.queries} sorgu`
  )
  return { press, regional }
}
