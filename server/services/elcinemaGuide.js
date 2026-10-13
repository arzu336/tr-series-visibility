import db from '../db.js'
import { getCached } from '../cache.js'
import { getPipelineDb } from './pipelineDb.js'
import { resolveIso2FromEnglish } from './countryLookup.js'

// elcinema.com Arap kanalları yayın akışı (2026-10-09; site yöneticisinin tarama izniyle). ~107 kanalın (MBC 4,
// MBC Drama, OSN Ya Hala, Rotana Drama…) bugünden itibaren 3 günlük akışı günde bir alınır. Türk dizileri eser
// sayfasındaki IMDb kimliğiyle kataloğa bağlanır (yoksa özgün adın birebir eşleşmesiyle) — tahminle eşleştirme yok.
// Yayınlar DStv ile aynı tv_airings tablosuna yazılır (provider 'elcinema'); ülke panelindeki ve dizi raporundaki
// televizyon bölümleri bunları kendiliğinden gösterir. Ülke = kanalın elcinema'daki ülkesi (MBC 4 → Suudi
// Arabistan; uydu yayını bölgeye yayılır). ELCINEMA_ENABLED=0 kapatır.

const BASE = 'https://elcinema.com'
const USER_AGENT = 'Mozilla/5.0 (gorunurluk-platformu; izinli tarama)'
const GAP_MS = 1500
const WORK_RECHECK_DAYS = 60
const PROVIDER = 'elcinema'
const MONTHS = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const decode = (s) =>
  String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

// elcinema kanal ülkesini sahibin ülkesi olarak verir (MBC Iraq → Suudi Arabistan, MBC Masr → Suudi Arabistan).
// Adında yayın ülkesi geçen kanal o ülkeye yazılır (2026-10-13: Irak'ın MBC Iraq yayınları Suudi Arabistan'a düşüyordu).
// Bölge geneli kanallar (MBC 4, MBC Drama…) elcinema'nın ülkesinde kalır — başka ülkeye dağıtılmaz.
const NAME_COUNTRY = [
  [/\biraq/i, 'IQ'],
  [/\b(?:masr|egypt)/i, 'EG'],
  [/\bmorocc/i, 'MA'],
  [/\balgeri/i, 'DZ'],
  [/\btunis/i, 'TN'],
  [/\blibya/i, 'LY'],
  [/\bsyria/i, 'SY'],
  [/\blebanon/i, 'LB'],
  [/\bjordan/i, 'JO'],
  [/\bpalestin/i, 'PS'],
  [/\bkuwait/i, 'KW'],
  [/\bqatar/i, 'QA'],
  [/\bbahrain/i, 'BH'],
  [/\boman\b/i, 'OM'],
  [/\byemen/i, 'YE'],
  [/\bsudan/i, 'SD'],
]

/** Kanalın yayın ülkesi: adında ülke geçiyorsa o, yoksa elcinema'daki ülke. */
export function channelCountry(name, pageCountryIso2) {
  for (const [re, iso2] of NAME_COUNTRY) if (re.test(name)) return iso2
  return pageCountryIso2
}

export function elcinemaEnabled(env = process.env) {
  return env.ELCINEMA_ENABLED !== '0'
}

/** Rehber ana sayfası → kanallar [{ id, name }] (kısaltılmış "…" adlar yerine en uzun ad). */
export function parseChannelList(html) {
  const byId = new Map()
  for (const m of String(html).matchAll(/href="\/en\/tvguide\/(\d+)\/?"[^>]*>([^<]+)</g)) {
    const name = decode(m[2]).replace(/\s*Channel$/, '')
    if (!name || name.endsWith('...')) {
      if (!byId.has(m[1])) byId.set(m[1], name.replace(/\.\.\.$/, ''))
      continue
    }
    const cur = byId.get(m[1])
    if (!cur || name.length > cur.length) byId.set(m[1], name)
  }
  return [...byId].map(([id, name]) => ({ id, name }))
}

/** "Friday  9 October" → ISO tarih; yıl, bugüne en yakın yıl (Aralık→Ocak geçişi). */
export function dayToIso(header, today) {
  const m = String(header).match(/(\d{1,2})\s+([A-Z][a-z]+)/)
  if (!m || !MONTHS[m[2]]) return null
  const t = new Date(`${today}T00:00:00Z`)
  let best = null
  for (const y of [t.getUTCFullYear() - 1, t.getUTCFullYear(), t.getUTCFullYear() + 1]) {
    const d = new Date(Date.UTC(y, MONTHS[m[2]] - 1, Number(m[1])))
    if (!best || Math.abs(d - t) < Math.abs(best - t)) best = d
  }
  return best.toISOString().slice(0, 10)
}

/** Kanal sayfası → { country (etiket), entries: [{ date, workId, title, kind, minutes }] }. */
export function parseChannelPage(html, today) {
  const text = String(html)
  const country = decode(text.replace(/<[^>]+>/g, ' ').match(/country:\s*([A-Za-z .'-]+?)\s+Category:/)?.[1] || '')
  const entries = []
  const parts = text.split(/<div class="\s*dates">/).slice(1)
  for (const part of parts) {
    const date = dayToIso(part.slice(0, 80).replace(/<[^>]+>/g, ' '), today)
    if (!date) continue
    const re =
      /<li>\s*(\d{1,2}:\d{2})\s+(AM|PM)\s*<\/li>\s*<li><span class="subheader">\[(\d+) minutes\]<\/span><\/li>[\s\S]*?<li><a href="\/en\/work\/(\d+)\/">([^<]+)<\/a><\/li>\s*<li>\s*([^<(]+?)\s*(?:\(|<)/g
    for (const m of part.matchAll(re)) {
      entries.push({ date, workId: m[4], title: decode(m[5]), kind: decode(m[6]), minutes: Number(m[3]) })
    }
  }
  return { country, entries }
}

/** Eser sayfası → { title, originalTitle, country (ISO-2), imdbId, kind }. */
export function parseWorkPage(html) {
  const t = String(html)
  return {
    title: decode(t.match(/<span class="left" dir="ltr">([^<]+)<\/span>/)?.[1]),
    originalTitle: decode(t.match(/<span class="right" dir="rtl">([^<]+)<\/span>/)?.[1]),
    country: (t.match(/\/en\/index\/work\/country\/([a-z]{2})"/)?.[1] || '').toUpperCase() || null,
    imdbId: t.match(/imdb\.com\/title\/(tt\d+)/)?.[1] || null,
    kind: decode(t.match(/\/en\/index\/work\/category\/\d+">([^<]+)</)?.[1]),
  }
}

const fold = (s) =>
  String(s || '')
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/**
 * Eserin aday adları: özgün ad ve İngilizce ad, eğik çizgiyle ayrılmış her parça ayrı ("Yargi/ The Judgment"), sezon
 * eki atılmış ("Kurulus: Osman S2", "Ezel S1", "… ج2"). 2026-10-09 ilk taramada 18 Türk eseri bu biçimler yüzünden
 * eşleşmemişti.
 */
export function workNames(work) {
  const out = new Set()
  for (const full of [work.originalTitle, work.title]) {
    for (const part of String(full || '').split('/')) {
      const name = part.replace(/\s+(?:S|Season|ج)\s*\d+\s*$/iu, '').trim()
      if (name) out.add(name)
    }
  }
  return [...out]
}

/**
 * Türk eserini kataloğa bağlar: IMDb kimliği (kayıtlı eşleme), yoksa aday adların birebir eşleşmesi (Türkçe
 * karakterler ve noktalama katlanmış). Adlar birden çok diziye gidiyorsa eşlenmez.
 */
export function matchWork(work, { tmdbByTconst, seriesByName }) {
  if (work.country !== 'TR') return null
  if (work.imdbId && tmdbByTconst.has(work.imdbId)) return tmdbByTconst.get(work.imdbId)
  const ids = new Set()
  for (const n of workNames(work)) for (const id of seriesByName.get(fold(n)) || []) ids.add(id)
  return ids.size === 1 ? [...ids][0] : null
}

const unmatchedWorks = db.prepare("SELECT * FROM elcinema_works WHERE country = 'TR' AND series_id IS NULL")
const setWorkSeries = db.prepare('UPDATE elcinema_works SET series_id = ? WHERE work_id = ?')

/** Kayıtlı eşleşmemiş Türk eserlerini ağa çıkmadan yeniden eşler (katalog ya da kural değişince). */
export function rematchWorks(idx) {
  let n = 0
  for (const w of unmatchedWorks.all()) {
    const sid = matchWork(
      { country: w.country, imdbId: w.imdb_id, originalTitle: w.original_title, title: w.title },
      idx
    )
    if (sid) {
      setWorkSeries.run(sid, w.work_id)
      n++
    }
  }
  return n
}

const getWork = db.prepare('SELECT * FROM elcinema_works WHERE work_id = ?')
const putWork = db.prepare(`
  INSERT INTO elcinema_works (work_id, title, original_title, country, imdb_id, series_id, kind, checked_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(work_id) DO UPDATE SET title = excluded.title, original_title = excluded.original_title,
    country = excluded.country, imdb_id = excluded.imdb_id, series_id = excluded.series_id, kind = excluded.kind,
    checked_at = excluded.checked_at
`)
const upsertAiring = db.prepare(`
  INSERT INTO tv_airings (provider, iso2, channel, series_id, date, slots, title) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(provider, iso2, channel, series_id, date) DO UPDATE SET slots = excluded.slots, title = excluded.title
`)
const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
const metaSet = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)

function matchIndexes(series) {
  const tmdbByTconst = new Map()
  try {
    for (const r of getPipelineDb()?.prepare('SELECT tmdb_id, tconst FROM imdb_title_map').all() || [])
      tmdbByTconst.set(r.tconst, r.tmdb_id)
  } catch {
    // eşleme tablosu yoksa yalnızca adla
  }
  const seriesByName = new Map()
  for (const s of series) {
    const k = fold(s.name)
    if (!seriesByName.has(k)) seriesByName.set(k, [])
    seriesByName.get(k).push(s.id)
  }
  return { tmdbByTconst, seriesByName }
}

let running = false

export async function runElcinemaGuideIfNeeded({
  fetchFn = fetch,
  now = new Date(),
  series = getCached('raw-series-providers')?.series || [],
  gapMs = GAP_MS,
  force = false,
} = {}) {
  if (!elcinemaEnabled() || running || !series.length) return null
  const today = now.toISOString().slice(0, 10)
  if (!force && metaGet.get('elcinemaLastDate')?.value === today) return null
  running = true
  const get = async (path) => {
    const res = await fetchFn(`${BASE}${path}`, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  }
  const idx = matchIndexes(series)
  const rematched = rematchWorks(idx)
  const recheckBefore = new Date(now.getTime() - WORK_RECHECK_DAYS * 86400000).toISOString()
  const result = { channels: 0, airings: 0, series: new Set(), works: 0, errors: [] }
  try {
    const channels = parseChannelList(await get('/en/tvguide/'))
    for (const ch of channels) {
      await sleep(gapMs)
      let page
      try {
        page = parseChannelPage(await get(`/en/tvguide/${ch.id}/`), today)
      } catch (err) {
        result.errors.push(`${ch.name}: ${err.message}`)
        continue
      }
      const iso2 = channelCountry(ch.name, resolveIso2FromEnglish(page.country))
      if (!iso2) continue
      result.channels++
      const counts = new Map() // workId|date → { slots, title }
      for (const e of page.entries) {
        if (!/series/i.test(e.kind)) continue
        const k = `${e.workId}|${e.date}`
        const c = counts.get(k) || { slots: 0, title: e.title, workId: e.workId, date: e.date }
        c.slots++
        counts.set(k, c)
      }
      for (const c of counts.values()) {
        let w = getWork.get(c.workId)
        if (!w || (!w.series_id && w.country === 'TR' && w.checked_at < recheckBefore)) {
          await sleep(gapMs)
          try {
            const parsed = parseWorkPage(await get(`/en/work/${c.workId}/`))
            const sid = matchWork(parsed, idx)
            putWork.run(
              c.workId,
              parsed.title || c.title,
              parsed.originalTitle,
              parsed.country,
              parsed.imdbId,
              sid,
              parsed.kind,
              now.toISOString()
            )
            result.works++
            w = getWork.get(c.workId)
          } catch (err) {
            result.errors.push(`eser ${c.workId}: ${err.message}`)
            continue
          }
        }
        if (!w?.series_id) continue
        upsertAiring.run(PROVIDER, iso2, ch.name, w.series_id, c.date, c.slots, w.original_title || c.title)
        result.airings++
        result.series.add(w.series_id)
      }
    }
    if (result.channels > 0) metaSet.run('elcinemaLastDate', today)
    console.log(
      `[elcinema] yeniden eşlenen eser ${rematched}; ${result.channels} kanal, ${result.airings} Türk dizisi yayını (${result.series.size} dizi), ${result.works} yeni eser; hata ${result.errors.length}`
    )
  } finally {
    running = false
  }
  return { ...result, series: result.series.size }
}
