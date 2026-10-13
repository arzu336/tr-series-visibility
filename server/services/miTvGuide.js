import db from '../db.js'
import { getCached, setCached } from '../cache.js'
import { buildMatcherFor, ingestGuideResponses } from './tvGuide.js'

// mi.tv Latin Amerika yayın akışı (2026-10-09; site yöneticisinin izniyle — akış verisi robots'ta kapalı /async/
// adreslerinden gelir, izin bunu kapsıyor). 10 ülke. Program sayfasında yapım ülkesi ya da IMDb kimliği YOK; eşleştirme
// DStv ile aynı: yerel (İspanyolca/Portekizce) ad, dizinin IMDb'deki yerel adlarıyla birebir; başka yapımlarla ortak
// genel adlar yalnızca kesin Türk dizisi görülen kanalda (bkz. tvGuide.buildTvMatcher). Ülke başına ~250 kanal (Brezilya
// 825) olduğundan: Türk dizisi görülmüş kanallar her gün, kalanlar 7 güne bölünüp dönüşümlü (her kanal haftada bir).
// Yalnızca dizi/telenovela kayıtları dikkate alınır (haber, reality, spor atlanır). MITV_ENABLED=0 kapatır.

const BASE = 'https://mi.tv'
const USER_AGENT = 'Mozilla/5.0 (gorunurluk-platformu; izinli tarama)'
const PROVIDER = 'mitv'
const GAP_MS = 1000
const ROTATION_DAYS = 7
const CHANNELS_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Ülke → { yol öneki, kanal yolu, saat dilimi farkı (dk, async uç parametresi) }
export const MITV_COUNTRIES = {
  AR: { cc: 'ar', path: 'canales', tz: 180 },
  BR: { cc: 'br', path: 'canais', tz: 180 },
  CL: { cc: 'cl', path: 'canales', tz: 180 },
  CO: { cc: 'co', path: 'canales', tz: 300 },
  GT: { cc: 'gt', path: 'canales', tz: 360 },
  HN: { cc: 'hn', path: 'canales', tz: 360 },
  MX: { cc: 'mx', path: 'canales', tz: 360 },
  PE: { cc: 'pe', path: 'canales', tz: 300 },
  PY: { cc: 'py', path: 'canales', tz: 180 },
  SV: { cc: 'sv', path: 'canales', tz: 360 },
}
// Dizi sayılan alt başlıklar: tür ("Telenovela", "Serie", "Novela", "Drama") ya da bölüm ("Episodio 38").
const SERIES_SUBTITLE = /telenovela|novela|serie|drama|episodio|episódio|cap[ií]tulo/i

export function miTvEnabled(env = process.env) {
  return env.MITV_ENABLED !== '0'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const decode = (s) =>
  String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

/** Ülke site haritası → kanal slug'ları. */
export function parseChannelSlugs(html, { cc, path }) {
  const re = new RegExp(`href="/${cc}/${path}/([a-z0-9-]+)"`, 'g')
  return [...new Set([...String(html).matchAll(re)].map((m) => m[1]))]
}

/** Kanalın günlük akışı → { name, programmes: [{ time, title, subtitle }] }. */
export function parseChannelSchedule(html) {
  const t = String(html)
  const name = decode(t.match(/<img[^>]+title="([^"]+)"/)?.[1] || '')
  const programmes = []
  const re = /<span class="time">([^<]+)<\/span>\s*<h2>([\s\S]*?)<\/h2>\s*(?:<span class="sub-title">([^<]*)<\/span>)?/g
  for (const m of t.matchAll(re)) {
    programmes.push({ time: decode(m[1]), title: decode(m[2].replace(/<[^>]+>/g, ' ')), subtitle: decode(m[3]) })
  }
  return { name, programmes }
}

/** Akışı DStv yanıt biçimine çevirir; yalnızca dizi/telenovela kayıtları. */
export function toGuideChannel(schedule) {
  return {
    Name: schedule.name,
    Programmes: schedule.programmes.filter((p) => SERIES_SUBTITLE.test(p.subtitle)).map((p) => ({ Title: p.title })),
  }
}

/** Bugün taranacak kanallar: Türk dizisi görülmüş kanallar + dönüşümdeki dilim. */
export function channelsForToday(slugs, knownSlugs, dayIndex, rotation = ROTATION_DAYS) {
  return slugs.filter((s, i) => knownSlugs.has(s) || i % rotation === dayIndex % rotation)
}

const knownStmt = db.prepare(
  `SELECT DISTINCT channel FROM tv_airings WHERE provider = '${PROVIDER}' AND iso2 = ? AND date >= ?`
)
const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
const metaSet = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)

let running = false

export async function runMiTvGuideIfNeeded({
  fetchFn = fetch,
  now = new Date(),
  series = getCached('raw-series-providers')?.series || [],
  gapMs = GAP_MS,
  force = false,
  full = false, // ilk kurulum: bütün kanallar (dönüşüm yok)
  countries = Object.keys(MITV_COUNTRIES),
} = {}) {
  if (!miTvEnabled() || running || !series.length) return null
  const date = now.toISOString().slice(0, 10)
  if (!force && metaGet.get('mitvLastDate')?.value === date) return null
  running = true
  const get = async (path) => {
    const res = await fetchFn(`${BASE}${path}`, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  }
  const match = buildMatcherFor(PROVIDER, series)
  const dayIndex = Math.floor(now.getTime() / 86400000)
  const since = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)
  const result = { countries: 0, airings: 0, series: new Set(), pages: 0, errors: [] }
  try {
    const responses = []
    for (const iso2 of countries) {
      const c = MITV_COUNTRIES[iso2]
      const key = `mitv-channels:${c.cc}`
      let slugs = getCached(key)
      if (!slugs) {
        try {
          slugs = parseChannelSlugs(await get(`/${c.cc}/sitemap`), c)
          if (slugs.length) setCached(key, slugs, CHANNELS_TTL_MS)
        } catch (err) {
          result.errors.push(`${iso2} kanal listesi: ${err.message}`)
          continue
        }
      }
      // Kanal adı → slug: bilinen kanallar akış sayfasındaki adla kayıtlı; slug'ı ad önbelleğinden bul.
      const nameKey = `mitv-channel-names:${c.cc}`
      const names = getCached(nameKey) || {}
      const knownNames = new Set(knownStmt.all(iso2, since).map((r) => r.channel))
      const knownSlugs = new Set(
        Object.entries(names)
          .filter(([, n]) => knownNames.has(n))
          .map(([s]) => s)
      )
      const channels = []
      for (const slug of full ? slugs : channelsForToday(slugs, knownSlugs, dayIndex)) {
        await sleep(gapMs)
        try {
          const sch = parseChannelSchedule(await get(`/${c.cc}/async/channel/${slug}/${c.tz}`))
          result.pages++
          if (!sch.name) continue
          names[slug] = sch.name
          const ch = toGuideChannel(sch)
          if (ch.Programmes.length) channels.push(ch)
        } catch (err) {
          result.errors.push(`${iso2}/${slug}: ${err.message}`)
        }
      }
      setCached(nameKey, names, 90 * 86400000)
      responses.push({ iso2, body: { Channels: channels } })
    }
    ingestGuideResponses(PROVIDER, responses, date, match, result)
    if (result.countries > 0) metaSet.run('mitvLastDate', date)
    console.log(
      `[mi.tv] ${result.countries} ülke, ${result.pages} kanal sayfası, ${result.airings} Türk dizisi yayını (${result.series.size} dizi); hata ${result.errors.length}`
    )
  } finally {
    running = false
  }
  return { ...result, series: result.series.size }
}
