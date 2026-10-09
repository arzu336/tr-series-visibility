import crypto from 'node:crypto'
import db from '../db.js'
import { getCached, setCached } from '../cache.js'
import { generateTrendMovementNotes, direktifIceriyorMu } from '../llm.js'
import { getSeasonDates } from '../tmdb.js'
import { getPipelineDb } from './pipelineDb.js'
import { readStoredSerpApi } from './serpApiCache.js'
import { magazineCacheKey } from './magazineNews.js'
import countryNames from '../../src/data/country-centroids.json' with { type: 'json' }

// Arama ilgisi grafiğinin hareket hareket yorumu (2026-10-07, kullanıcı isteği: "her harekette ne olduğuna dair").
// 1) Grafikteki belirgin yükseliş/düşüşler sayılardan bulunur (zigzag eşiği). 2) Her hareketin penceresinde
// kayıtlı gelişmeler toplanır: dizinin listelere girdiği/çıktığı ülkeler, sezon başlangıçları, o dönemin haber
// başlıkları. 3) Yapay zekâ her hareketi YALNIZCA bu kayıtlarla yorumlar; kayıt yoksa bunu söyler. Dil modeli
// ulaşılamazsa kurallı cümle yazılır — yorum hiçbir zaman boş kalmaz.

const DAY = 86400
const WINDOW_BEFORE_S = 21 * DAY
const WINDOW_AFTER_S = 7 * DAY
const MAX_MOVES = 5
const MAX_EVENTS_PER_MOVE = 6
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const nameOf = (iso2) => countryNames[iso2]?.name || iso2
// Dil modeli zaman zaman Türkçe metne Çince/Japonca/Korece kelime karıştırıyor (2026-10-07: "随后的"); o metin atılır.
const YABANCI_YAZI = /[぀-ヿ㐀-鿿가-힯]/
export const gecerliMetin = (t) =>
  typeof t === 'string' && t.trim().length > 0 && !YABANCI_YAZI.test(t) && !direktifIceriyorMu(t)
const isoDay = (s) => new Date(s * 1000).toISOString().slice(0, 10)

/**
 * Zigzag: değer en az `threshold` puan ters yöne dönünce önceki uç nokta dönüm noktası sayılır. Hareketler ardışık
 * dönüm noktaları arasıdır; en büyük MAX_MOVES hareket tarih sırasıyla döner. Eşik: aralığın %30'u, en az 15 puan.
 */
export function detectMovements(timeline, { max = MAX_MOVES } = {}) {
  const v = (timeline || []).map((p) => p.value)
  const n = v.length
  if (n < 4) return []
  const range = Math.max(...v) - Math.min(...v)
  const d = Math.max(15, Math.round(range * 0.3))
  if (range < d) return []

  const pivots = []
  let dir = 0
  let ext = 0
  let hi = 0
  let lo = 0
  for (let i = 1; i < n; i++) {
    if (dir === 0) {
      if (v[i] > v[hi]) hi = i
      if (v[i] < v[lo]) lo = i
      if (v[hi] - v[lo] >= d) {
        pivots.push(Math.min(hi, lo))
        dir = hi > lo ? 1 : -1
        ext = Math.max(hi, lo)
      }
      continue
    }
    if (dir === 1) {
      if (v[i] >= v[ext]) ext = i
      else if (v[ext] - v[i] >= d) {
        pivots.push(ext)
        dir = -1
        ext = i
      }
    } else if (v[i] <= v[ext]) ext = i
    else if (v[i] - v[ext] >= d) {
      pivots.push(ext)
      dir = 1
      ext = i
    }
  }
  if (dir !== 0) pivots.push(ext)

  const moves = []
  for (let k = 1; k < pivots.length; k++) {
    const a = pivots[k - 1]
    const b = pivots[k]
    const delta = v[b] - v[a]
    if (Math.abs(delta) < d) continue
    // Hareketin başlangıcı, değerin başlangıç düzeyinden ayrılmaya başladığı son hafta (uzun düz dönem hareketi
    // aylara yaymasın; olay penceresi asıl değişimin olduğu haftalara düşsün).
    let s = a
    for (let k = a; k < b; k++) if (Math.abs(v[k] - v[a]) <= Math.abs(delta) * 0.1) s = k
    moves.push({
      from: timeline[s].timestamp,
      to: timeline[b].timestamp,
      fromValue: v[s],
      toValue: v[b],
      delta,
      kind: delta > 0 ? 'yükseliş' : 'düşüş',
    })
  }
  return moves
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    .slice(0, max)
    .sort((x, y) => x.from - y.from)
}

const mondayOf = (dateStr) => {
  const t = Date.parse(`${dateStr}T00:00:00Z`) / 1000
  const wd = (new Date(t * 1000).getUTCDay() + 6) % 7
  return t - wd * DAY
}

/**
 * Liste olayları (saf): satırlar [{ iso2, date }] (Netflix haftası yayımlandığı haftaya kaydırılmış olarak) →
 * haftalara bölünür; bir hafta yeni giren ülkeler "listeye girdi", iki ve daha fazla ülkeden çıkış "listeden çıktı".
 */
export function listingEvents(rows) {
  const weeks = new Map()
  for (const r of rows) {
    const w = mondayOf(r.date)
    if (!weeks.has(w)) weeks.set(w, new Set())
    weeks.get(w).add(r.iso2)
  }
  const keys = [...weeks.keys()].sort((a, b) => a - b)
  const out = []
  let prev = new Set()
  let prevW = null
  for (const w of keys) {
    const cur = weeks.get(w)
    // Arada boş hafta varsa önceki küme geçersiz (dizi listelerden tamamen çıkmış).
    if (prevW != null && w - prevW > 7 * DAY) {
      if (prev.size >= 2) out.push({ ts: prevW + 7 * DAY, type: 'listeden çıktı', countries: [...prev] })
      prev = new Set()
    }
    const girdi = [...cur].filter((c) => !prev.has(c))
    const cikti = [...prev].filter((c) => !cur.has(c))
    if (girdi.length) out.push({ ts: w, type: 'listeye girdi', countries: girdi })
    if (cikti.length >= 2) out.push({ ts: w, type: 'listeden çıktı', countries: cikti })
    prev = cur
    prevW = w
  }
  return out
}

function readListingRows(seriesId, iso2) {
  const conn = getPipelineDb()
  if (!conn) return []
  try {
    const rows = conn
      .prepare(
        `SELECT provider, country_iso2 AS iso2, period_date FROM chart_entries
         WHERE series_id = ? AND program_kind = 'series' AND provider IN ('netflix_tudum', 'flixpatrol')
         ${iso2 ? 'AND country_iso2 = ?' : ''}`
      )
      .all(...(iso2 ? [seriesId, iso2] : [seriesId]))
    return rows.map((r) => ({
      iso2: r.iso2,
      // Netflix haftası bittikten sonra yayımlanır; liste o haftanın sonuna denk gelir.
      date:
        r.provider === 'netflix_tudum'
          ? isoDay(Date.parse(`${r.period_date}T00:00:00Z`) / 1000 + 7 * DAY)
          : r.period_date,
    }))
  } catch {
    return []
  }
}

const pressRowsStmt = db.prepare(
  'SELECT country_iso2, raw_articles FROM media_sentiment WHERE series_id = ? AND total_news_count > 0'
)

function newsEvents(seriesId, iso2) {
  const out = []
  const seen = new Set()
  const push = (title, date, where) => {
    const ms = Date.parse(date || '')
    if (!title || !Number.isFinite(ms) || seen.has(title)) return
    seen.add(title)
    out.push({ ts: Math.floor(ms / 1000), type: 'haber', title: String(title).slice(0, 160), where })
  }
  for (const r of pressRowsStmt.all(seriesId)) {
    if (iso2 && r.country_iso2 !== iso2) continue
    try {
      for (const a of JSON.parse(r.raw_articles || '[]')) push(a.title, a.date, nameOf(r.country_iso2))
    } catch {
      // bozuk kayıt atlanır
    }
  }
  if (!iso2)
    for (const a of readStoredSerpApi(magazineCacheKey(seriesId))?.raw || []) push(a.title, a.iso_date, 'Türkiye')
  return out
}

async function seasonEvents(seriesId) {
  const key = `tmdb:seasons:v1:${seriesId}`
  let seasons = getCached(key)
  if (!seasons) {
    try {
      seasons = await getSeasonDates(seriesId)
      setCached(key, seasons, CACHE_TTL_MS)
    } catch {
      seasons = []
    }
  }
  return seasons
    .filter((s) => s.airDate && s.seasonNumber > 0)
    .map((s) => ({ ts: Date.parse(`${s.airDate}T00:00:00Z`) / 1000, type: 'sezon başladı', season: s.seasonNumber }))
}

/** Hareket penceresindeki olaylar: hareketin başından 3 hafta önce → bitişinden 1 hafta sonra. */
export function eventsForMove(move, events) {
  const from = move.from - WINDOW_BEFORE_S
  const to = move.to + WINDOW_AFTER_S
  const inWin = events.filter((e) => e.ts >= from && e.ts <= to)
  // Önce liste ve sezon olayları, sonra haberler; çok olayda en fazla MAX_EVENTS_PER_MOVE.
  const rank = { 'sezon başladı': 0, 'listeye girdi': 1, 'listeden çıktı': 1, haber: 2 }
  return inWin.sort((a, b) => rank[a.type] - rank[b.type] || a.ts - b.ts).slice(0, MAX_EVENTS_PER_MOVE)
}

export function describeEvent(e) {
  const gun = isoDay(e.ts)
  if (e.type === 'sezon başladı') return `${gun}: ${e.season}. sezon yayına başladı`
  if (e.type === 'haber') return `${gun}: haber (${e.where}) — "${e.title}"`
  const ulkeler =
    e.countries.slice(0, 6).map(nameOf).join(', ') +
    (e.countries.length > 6 ? ` ve ${e.countries.length - 6} ülke daha` : '')
  return `${gun}: ${e.countries.length} ülkede ${e.type} (${ulkeler})`
}

/** Dil modeli olmadan kurallı not: en önemli olayla, yoksa "kayıtlı gelişme yok". */
export function ruleNote(move, events) {
  const ad = move.kind === 'yükseliş' ? 'yükseliş' : 'düşüş'
  const ile = ad === 'yükseliş' ? 'yükselişle' : 'düşüşle'
  if (!events.length)
    return `Bu ${ad === 'yükseliş' ? 'yükselişe' : 'düşüşe'} denk gelen kayıtlı bir gelişme bulunmuyor.`
  const e = events.find((x) => x.type !== 'haber') ?? events[0]
  const gun = new Date(e.ts * 1000).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
  const ulkeler = (e.countries || []).slice(0, 4).map(nameOf).join(', ')
  if (e.type === 'sezon başladı') return `Bu ${ad} döneminde dizinin ${e.season}. sezonu yayına başladı (${gun}).`
  if (e.type === 'listeye girdi')
    return `Bu ${ile} aynı dönemde dizi ${e.countries.length} ülkede listeye girdi (${ulkeler}; ${gun}).`
  if (e.type === 'listeden çıktı')
    return `Bu ${ile} aynı dönemde dizi ${e.countries.length} ülkede listeden çıktı (${ulkeler}; ${gun}).`
  return `Bu dönemde ${e.where} basınında diziyle ilgili haber çıktı (${gun}).`
}

/**
 * Grafiğin hareketleri + her biri için kayıtlı olaylar ve yorum. `scope`: ülke kodu ya da null (dünya geneli).
 * `deps` testler için.
 */
export async function getTrendMovements(
  seriesId,
  seriesName,
  timeline,
  iso2 = null,
  { cacheOnly = false, deps = {} } = {}
) {
  const {
    readListings = readListingRows,
    readNews = newsEvents,
    readSeasons = seasonEvents,
    llm = generateTrendMovementNotes,
  } = deps
  const moves = detectMovements(timeline)
  if (!moves.length) return { movements: [], summary: null, generatedAt: null }

  const events = [
    ...listingEvents(readListings(seriesId, iso2)),
    ...readNews(seriesId, iso2),
    ...(await readSeasons(seriesId)),
  ]
  const withEvents = moves.map((m) => ({ ...m, events: eventsForMove(m, events) }))
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify(withEvents.map((m) => [m.from, m.to, m.delta, m.events.map(describeEvent)])))
    .digest('hex')
    .slice(0, 16)
  const key = `trend-moves:v2:${seriesId}:${iso2 || 'WW'}:${hash}`
  const cached = getCached(key)
  const build = (notes, summary, source) => ({
    movements: withEvents.map((m, i) => ({
      ...m,
      events: m.events.map((e) => ({ ...e, text: describeEvent(e) })),
      note: notes?.[i] || ruleNote(m, m.events),
    })),
    summary,
    source,
    generatedAt: new Date().toISOString(),
  })
  if (cached) return { ...cached, fromCache: true }
  if (cacheOnly) return { ...build(null, null, 'kural'), pending: true }

  let notes = null
  let summary = null
  let llmError = null
  try {
    const out = await llm(
      seriesName,
      iso2 ? nameOf(iso2) : null,
      withEvents.map((m) => ({
        ...m,
        fromDay: isoDay(m.from),
        toDay: isoDay(m.to),
        eventTexts: m.events.map(describeEvent),
      }))
    )
    notes = withEvents.map((_, i) => (gecerliMetin(out.notes?.[i]) ? out.notes[i].trim() : null))
    summary = gecerliMetin(out.summary) ? out.summary.trim() : null
  } catch (err) {
    console.error(`[trendMovements] "${seriesName}" hareket yorumu üretilemedi:`, err.message)
    llmError = err.message
  }
  const result = { ...build(notes, summary, notes?.some(Boolean) ? 'yapay-zeka' : 'kural'), llmError }
  if (notes?.some(Boolean)) setCached(key, result, CACHE_TTL_MS)
  return result
}
