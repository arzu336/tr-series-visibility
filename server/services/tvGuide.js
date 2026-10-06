import db from '../db.js'
import { getCached } from '../cache.js'
import { getPipelineDb } from './pipelineDb.js'
import { asciiVariant, foldTitle } from './localTitles.js'

// Televizyon yayın akışları (2026-10-06). Afrika'da Türk dizileri büyük ölçüde televizyonda, yerel dile dublajlı
// izleniyor; yayın platformu kataloğu ve Netflix listesi bunu görmüyor. DStv (MultiChoice) rehberi 49 Afrika
// ülkesinde kanal kanal o günün programını verir; Türk dizileri yerel adlarıyla (Portekizce, Fransızca,
// İngilizce…) IMDb yerel başlıklarına tam ad eşitliğiyle eşlenir.
//
// İZİN: DStv ve StarTimes'ın kullanım koşulları rehber içeriğinin yazılı izin olmadan kaydedilmesini yasaklar.
// Kurumun bu kaynaklar için yazılı izni sağladığı 2026-10-06'da kullanıcı tarafından bildirildi. İzin geri
// alınırsa TV_GUIDE_ENABLED=false ile toplama durdurulur. Yalnızca program adı ve yayın sayısı saklanır;
// açıklama, görsel ya da başka içerik alınmaz.

const DSTV_API = 'https://www.dstv.com/umbraco/api/TvGuide/GetProgrammes'
const USER_AGENT = 'gorunurluk-platformu/1.0 (T.C. Iletisim Baskanligi; izinli rehber toplama)'
const REQUEST_GAP_MS = 1500
const RETENTION_DAYS = 400

// DStv ülke kodları (rehber ucunun beklediği üç harfli kod) → ISO2
export const DSTV_COUNTRIES = {
  ago: 'AO',
  ben: 'BJ',
  bwa: 'BW',
  bfa: 'BF',
  bdi: 'BI',
  cmr: 'CM',
  cpv: 'CV',
  tcd: 'TD',
  caf: 'CF',
  com: 'KM',
  cod: 'CD',
  dji: 'DJ',
  gnq: 'GQ',
  eri: 'ER',
  swz: 'SZ',
  eth: 'ET',
  gab: 'GA',
  gmb: 'GM',
  gha: 'GH',
  gin: 'GN',
  gnb: 'GW',
  civ: 'CI',
  ken: 'KE',
  lbr: 'LR',
  mdg: 'MG',
  mwi: 'MW',
  mli: 'ML',
  mrt: 'MR',
  mus: 'MU',
  moz: 'MZ',
  nam: 'NA',
  ner: 'NE',
  nga: 'NG',
  cog: 'CG',
  rwa: 'RW',
  stp: 'ST',
  sen: 'SN',
  syc: 'SC',
  sle: 'SL',
  som: 'SO',
  zaf: 'ZA',
  ssd: 'SS',
  sdn: 'SD',
  tza: 'TZ',
  tgo: 'TG',
  uga: 'UG',
  zmb: 'ZM',
  zwe: 'ZW',
}

export function tvGuideEnabled(env = process.env) {
  return String(env.TV_GUIDE_ENABLED ?? 'true').toLowerCase() !== 'false'
}

// ---------------------------------------------------------------------------------------------- eşleme

/** Rehber başlığından sezon/bölüm ekini atar: "Amor Proibido S2", "Le Clan - Saison 3" → çıplak ad. */
export function cleanProgramTitle(title) {
  return String(title || '')
    .replace(/\s*[-–:]?\s*(S\d+(\s*E\d+)?|Season\s*\d+|Saison\s*\d+|Temporada\s*\d+|Ep(isode)?\.?\s*\d+)\s*$/i, '')
    .trim()
}

/**
 * Tam ad eşleyici: Türkçe ad, Türkçe harfsiz yazımı ve IMDb'deki bütün yerel adlar (her dil). Birden çok diziye
 * giden ad (ör. iki dizinin ortak çevirisi) belirsiz sayılıp atılır. Elle eşlenen başlıklar önce gelir.
 * `localized`: [{ seriesId, title }].
 */
export function buildTvMatcher(series, localized = [], manual = new Map(), ambiguous = new Set()) {
  const byKey = new Map()
  const loose = new Set() // yalnızca güvenilir kanalda geçerli anahtarlar
  const add = (title, id, foreign) => {
    const k = foldTitle(title)
    if (k.length < 4) return
    const set = byKey.get(k) || new Set()
    set.add(id)
    byKey.set(k, set)
    if (foreign && ambiguous.has(k)) loose.add(k)
  }
  for (const s of series) {
    add(s.name, s.id, false)
    const a = asciiVariant(s.name)
    if (a) add(a, s.id, false)
  }
  for (const l of localized) add(l.title, l.seriesId, true)
  const exact = new Map([...byKey].filter(([, ids]) => ids.size === 1).map(([k, ids]) => [k, [...ids][0]]))
  /**
   * `allowAmbiguous`: IMDb'de başka yapımlarla paylaşılan yabancı ad ("The Agency", "Amor Proibido") yalnızca
   * kesin bir Türk dizisi eşleşmesi görülmüş kanalda kabul edilir.
   */
  return (title, { allowAmbiguous = false } = {}) => {
    if (manual.has(title)) return manual.get(title)
    const k = foldTitle(cleanProgramTitle(title))
    if (loose.has(k) && !allowAmbiguous) return null
    return exact.get(k) ?? null
  }
}

function ambiguousKeys() {
  try {
    return new Set(
      db
        .prepare('SELECT fold_key FROM tv_title_ambiguity')
        .all()
        .map((r) => r.fold_key)
    )
  } catch {
    return new Set() // tablo henüz hesaplanmadı (server/scripts/tv-title-ambiguity.js)
  }
}

function localizedTitles(conn = getPipelineDb()) {
  if (!conn) return []
  try {
    return conn
      .prepare(
        `SELECT m.tmdb_id AS seriesId, l.title FROM imdb_localized_titles l JOIN imdb_title_map m ON m.tconst = l.tconst`
      )
      .all()
  } catch {
    return []
  }
}

function manualMappings(provider) {
  return new Map(
    db
      .prepare('SELECT title, series_id FROM tv_titles WHERE provider = ? AND manual = 1')
      .all(provider)
      .map((r) => [r.title, r.series_id])
  )
}

// ---------------------------------------------------------------------------------------------- toplama

const upsertAiring = db.prepare(`
  INSERT INTO tv_airings (provider, iso2, channel, series_id, date, slots, title) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(provider, iso2, channel, series_id, date) DO UPDATE SET slots = excluded.slots, title = excluded.title
`)
const upsertTitle = db.prepare(`
  INSERT INTO tv_titles (provider, channel, title, series_id, countries, first_seen, last_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(provider, channel, title) DO UPDATE SET
    series_id = CASE WHEN tv_titles.manual = 1 THEN tv_titles.series_id ELSE excluded.series_id END,
    countries = MAX(tv_titles.countries, excluded.countries), last_seen = excluded.last_seen
`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Tek günün rehber yanıtından: kanal başına eşleşen diziler (yayın sayısıyla) ve Türk dizisi yayınlayan
 * kanallardaki bütün başlıklar (eşleşmeyenler elle bağlanabilsin diye). Saf; testler doğrudan çağırır.
 */
export function extractAirings(response, match, trustedChannels = new Set()) {
  const airings = []
  const titlesByChannel = new Map()
  for (const ch of response?.Channels || []) {
    const opts = { allowAmbiguous: trustedChannels.has(ch.Name) }
    const counts = new Map()
    for (const p of ch.Programmes || []) {
      const t = String(p.Title || '').trim()
      if (t) counts.set(t, (counts.get(t) || 0) + 1)
    }
    let any = false
    const perSeries = new Map()
    for (const [title, n] of counts) {
      const id = match(title, opts)
      if (id == null) continue
      any = true
      const cur = perSeries.get(id) || { slots: 0, title }
      cur.slots += n
      perSeries.set(id, cur)
    }
    for (const [seriesId, v] of perSeries) airings.push({ channel: ch.Name, seriesId, slots: v.slots, title: v.title })
    if (any)
      titlesByChannel.set(
        ch.Name,
        [...counts.keys()].map((title) => ({ title, seriesId: match(title, opts) }))
      )
  }
  return { airings, titlesByChannel }
}

/** Kesin (belirsiz olmayan) bir Türk dizisi eşleşmesi görülen kanallar — bütün ülkelerin yanıtları üzerinden. */
export function trustedChannelsOf(responses, match) {
  const out = new Set()
  for (const r of responses)
    for (const ch of r?.Channels || [])
      if ((ch.Programmes || []).some((p) => match(String(p.Title || '').trim()) != null)) out.add(ch.Name)
  return out
}

let running = false

/** Günde bir kez: 49 ülkenin bugünkü rehberi. `force` yönetim ekranından elle başlatma. */
export async function runTvGuideIfNeeded({
  fetchFn = fetch,
  now = new Date(),
  series = getCached('raw-series-providers')?.series || [],
  localized = null,
  gapMs = REQUEST_GAP_MS,
  force = false,
  countries = Object.keys(DSTV_COUNTRIES),
} = {}) {
  if (!tvGuideEnabled() || running) return null
  const date = now.toISOString().slice(0, 10)
  const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
  if (!force && metaGet.get('tvGuideLastDate')?.value === date) return null
  running = true
  const provider = 'dstv'
  const match = buildTvMatcher(series, localized ?? localizedTitles(), manualMappings(provider), ambiguousKeys())
  const result = { countries: 0, airings: 0, series: new Set(), errors: [] }
  const seen = new Map() // kanal|başlık → ülke sayısı
  try {
    // Önce bütün ülkelerin yanıtı: hangi kanalın Türk dizisi yayınladığı ülkeler arası birlikte belirlenir.
    const responses = []
    for (const [i, code] of countries.entries()) {
      if (i > 0 && gapMs) await sleep(gapMs)
      try {
        const res = await fetchFn(`${DSTV_API}?d=${date}&country=${code}`, { headers: { 'User-Agent': USER_AGENT } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        responses.push({ iso2: DSTV_COUNTRIES[code], body: await res.json() })
      } catch (err) {
        result.errors.push(`${DSTV_COUNTRIES[code]}: ${err.message}`)
      }
    }
    const trusted = trustedChannelsOf(
      responses.map((r) => r.body),
      match
    )
    for (const { iso2, body } of responses) {
      {
        const { airings, titlesByChannel } = extractAirings(body, match, trusted)
        for (const a of airings) {
          upsertAiring.run(provider, iso2, a.channel, a.seriesId, date, a.slots, a.title)
          result.series.add(a.seriesId)
        }
        for (const [channel, titles] of titlesByChannel) {
          for (const t of titles) {
            const k = `${channel}|${t.title}`
            seen.set(k, (seen.get(k) || 0) + 1)
            upsertTitle.run(provider, channel, t.title, t.seriesId, seen.get(k), date, date)
          }
        }
        result.airings += airings.length
        result.countries++
      }
    }
    db.prepare('DELETE FROM tv_airings WHERE date < ?').run(
      new Date(now.getTime() - RETENTION_DAYS * 86400000).toISOString().slice(0, 10)
    )
    if (result.countries > 0) {
      db.prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run('tvGuideLastDate', date)
    }
  } finally {
    running = false
  }
  return { ...result, series: result.series.size }
}

// ---------------------------------------------------------------------------------------------- okuma

const since = (now, days) => new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10)

/** Ülke paneli: son `days` günde televizyonda yayınlanan Türk dizileri (kanallarıyla). */
export function getCountryTv(iso2, { now = new Date(), days = 30 } = {}) {
  const rows = db
    .prepare(
      `SELECT series_id, channel, SUM(slots) slots, MAX(date) last, MIN(title) title FROM tv_airings
       WHERE iso2 = ? AND date >= ? GROUP BY series_id, channel ORDER BY slots DESC`
    )
    .all(String(iso2).toUpperCase(), since(now, days))
  const bySeries = new Map()
  for (const r of rows) {
    const s = bySeries.get(r.series_id) || {
      seriesId: r.series_id,
      localTitle: r.title,
      slots: 0,
      last: r.last,
      channels: [],
    }
    s.slots += r.slots
    if (r.last > s.last) s.last = r.last
    s.channels.push(r.channel)
    bySeries.set(r.series_id, s)
  }
  return [...bySeries.values()].sort((a, b) => b.slots - a.slots)
}

/** Dizi sayfası: son `days` günde televizyonda yayınlandığı ülkeler. */
export function getSeriesTv(seriesId, { now = new Date(), days = 30 } = {}) {
  return db
    .prepare(
      `SELECT iso2, GROUP_CONCAT(DISTINCT channel) channels, SUM(slots) slots, MAX(date) last, MIN(title) title
       FROM tv_airings WHERE series_id = ? AND date >= ? GROUP BY iso2 ORDER BY slots DESC`
    )
    .all(seriesId, since(now, days))
    .map((r) => ({ iso2: r.iso2, channels: r.channels.split(','), slots: r.slots, last: r.last, localTitle: r.title }))
}

/** Yönetim ekranı: son toplama, kapsam ve Türk dizisi kanallarında eşleşmeyen başlıklar. */
export function tvGuideStatus() {
  const lastDate = db.prepare("SELECT value FROM meta WHERE key = 'tvGuideLastDate'").get()?.value ?? null
  const totals = db
    .prepare(
      'SELECT COUNT(DISTINCT iso2) countries, COUNT(DISTINCT series_id) series, COUNT(DISTINCT channel) channels FROM tv_airings'
    )
    .get()
  const unmatched = db
    .prepare(
      `SELECT provider, channel, title, countries, last_seen FROM tv_titles WHERE series_id IS NULL
       ORDER BY countries DESC, last_seen DESC LIMIT 40`
    )
    .all()
  return { enabled: tvGuideEnabled(), lastDate, ...totals, unmatched }
}

/** Eşleşmeyen başlığı elle bir diziye bağlar (null: bağlantıyı kaldırır); geçmiş yayınlar sonraki toplamada yazılır. */
export function setTitleMapping(provider, channel, title, seriesId) {
  const r = db
    .prepare('UPDATE tv_titles SET series_id = ?, manual = ? WHERE provider = ? AND channel = ? AND title = ?')
    .run(seriesId ?? null, seriesId == null ? 0 : 1, provider, channel, title)
  return r.changes > 0
}
