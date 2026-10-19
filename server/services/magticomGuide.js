import db from '../db.js'
import { getCached } from '../cache.js'
import { buildMatcherFor, ingestGuideResponses, manualTitleSet } from './tvGuide.js'
import { cleanEpgTitle, strictMatcher } from './epgPwGuide.js'

// Gürcistan yayın akışı (2026-10-13; kullanıcı onayıyla, izin kapsamında): Magticom'un rehber sayfası (kanal listesi)
// ve kanal başına JSON program ucu. Yalnızca Gürcüce adlı kanallar (Imedi, Rustavi 2, 1TV, Ajara…) sayılır; operatörün
// taşıdığı Rus ve uluslararası kanallar kendi ülkelerinin rehberinde zaten var. Türk dizileri Gürcüce adlarıyla geçer;
// eşleme Türkçe ad, IMDb yerel adları ve ansiklopedi maddesinin Gürcüce adıyla birebir (tvGuide); tek kelimelik ad
// yalnızca kesin Türk dizisi görülen kanalda. MAGTICOM_ENABLED=0 kapatır.

// Askıda kalan istek zincirdeki diğer işleri bloklamasın (2026-10-16): her istek için süre sınırı.
const FETCH_TIMEOUT_MS = 30000

const BASE = 'https://www.magticom.ge'
const USER_AGENT = 'gorunurluk-platformu/1.0 (izinli rehber toplama)'
const PROVIDER = 'magticom'
const GAP_MS = 800
const TZ_HOURS = 4
const GEORGIAN = /[ა-ჿ]/

export function magticomEnabled(env = process.env) {
  return env.MAGTICOM_ENABLED !== '0'
}

/** Rehber sayfası → Gürcüce adlı kanallar [{ id, name }]. */
export function parseMagticomChannels(html) {
  const out = new Map()
  const re = /class="tv-guide-channel[^"]*"\s+data-id="(\d+)"[\s\S]*?alt="([^"]+)"/g
  for (const m of String(html).matchAll(re)) {
    const name = m[2].trim()
    if (GEORGIAN.test(name) && !out.has(m[1])) out.set(m[1], name)
  }
  return [...out].map(([id, name]) => ({ id, name }))
}

/** "ლეილა (43)", "შუა ქალაქში (გ/ჩ)", "მემკვიდრე 58" → çıplak ad. */
export function cleanGeorgianTitle(title) {
  let t = String(title || '').trim()
  for (let i = 0; i < 3; i++) t = t.replace(/\s*\([^()]*\)\s*$/u, '').trim()
  return cleanEpgTitle(t)
}

/** Program yanıtı → DStv kanal biçimi. */
export function toGuideChannel(name, programmes) {
  return {
    Name: name,
    Programmes: (Array.isArray(programmes) ? programmes : [])
      .map((p) => cleanGeorgianTitle(p.title))
      .filter(Boolean)
      .map((Title) => ({ Title })),
  }
}

const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
const metaSet = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let running = false

export async function runMagticomGuideIfNeeded({
  fetchFn = fetch,
  now = new Date(),
  series = getCached('raw-series-providers')?.series || [],
  gapMs = GAP_MS,
  force = false,
} = {}) {
  if (!magticomEnabled() || running || !series.length) return null
  const date = now.toISOString().slice(0, 10)
  if (!force && metaGet.get('magticomLastDate')?.value === date) return null
  running = true
  const result = { countries: 0, airings: 0, series: new Set(), channels: 0, errors: [] }
  try {
    const page = await fetchFn(`${BASE}/en/tv/tv-services/tv-guide`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!page.ok) throw new Error(`HTTP ${page.status}`)
    const channels = parseMagticomChannels(await page.text())
    // Tiflis günü (UTC+4).
    const start = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000) - TZ_HOURS * 3600
    const Channels = []
    for (const ch of channels) {
      await sleep(gapMs)
      try {
        const res = await fetchFn(`${BASE}/request/channel-program.php`, {
          method: 'POST',
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Referer: `${BASE}/en/tv/tv-services/tv-guide`,
          },
          body: new URLSearchParams({ channelId: ch.id, start: String(start), end: String(start + 86400) }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        Channels.push(toGuideChannel(ch.name, await res.json()))
        result.channels++
      } catch (err) {
        result.errors.push(`${ch.name}: ${err.message}`)
      }
    }
    ingestGuideResponses(
      PROVIDER,
      [{ iso2: 'GE', body: { Channels } }],
      date,
      strictMatcher(buildMatcherFor(PROVIDER, series), manualTitleSet(PROVIDER)),
      result
    )
    if (result.channels > 0) metaSet.run('magticomLastDate', date)
    console.log(
      `[magticom] ${result.channels} kanal, ${result.airings} Türk dizisi yayını (${result.series.size} dizi)`
    )
  } finally {
    running = false
  }
  return { ...result, series: result.series.size }
}
