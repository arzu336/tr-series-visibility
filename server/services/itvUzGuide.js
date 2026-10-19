import db from '../db.js'
import { getCached } from '../cache.js'
import { buildMatcherFor, ingestGuideResponses, manualTitleSet } from './tvGuide.js'
import { cleanEpgTitle, strictMatcher } from './epgPwGuide.js'

// Özbekistan yayın akışı (2026-10-13; kullanıcı onayıyla, izin kapsamında): itv.uz'un açık JSON uçları — kanal listesi
// ve kanal başına bugünün programı. Türk dizileri Özbekçe adlarıyla geçer ("Uzoq shahar"); eşleme Türkçe ad, IMDb
// yerel adları ve dizinin ansiklopedi maddesinin Özbekçe adıyla birebir (tvGuide). Tek kelimelik ad yalnızca kesin
// Türk dizisi görülen kanalda sayılır. Eşleşmeyen başlıklar Türk dizisi yayınlayan kanallarda tv_titles'a düşer.
// ITVUZ_ENABLED=0 kapatır.

// Askıda kalan istek zincirdeki diğer işleri bloklamasın (2026-10-16): her istek için süre sınırı.
const FETCH_TIMEOUT_MS = 30000

const API = 'https://gw.itv.uz/api/v1'
const USER_AGENT = 'gorunurluk-platformu/1.0 (izinli rehber toplama)'
const PROVIDER = 'itvuz'
const GAP_MS = 800
const TZ_HOURS = 5

export function itvUzEnabled(env = process.env) {
  return env.ITVUZ_ENABLED !== '0'
}

/** get-channels yanıtı → [{ id, name }] (bütün gruplar, tekilleştirilmiş). Kazakistan kanalları ("… KZ") atlanır. */
export function parseItvChannels(body) {
  const byId = new Map()
  for (const list of Object.values(body?.data || {}))
    if (Array.isArray(list))
      for (const c of list) if (c?.channelId && c.channelTitle) byId.set(c.channelId, String(c.channelTitle).trim())
  return [...byId].filter(([, name]) => !/\bKZ\b/.test(name)).map(([id, name]) => ({ id, name }))
}

/** EPG yanıtı → DStv kanal biçimi; yer tutucu ("iTV", kanal adı) programlar atlanır. */
export function toGuideChannel(name, body) {
  const Programmes = []
  for (const p of body?.data || []) {
    const t = cleanEpgTitle(p.programTitle)
    if (!t || t === 'iTV' || t.toLowerCase() === name.toLowerCase()) continue
    Programmes.push({ Title: t })
  }
  return { Name: name, Programmes }
}

const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
const metaSet = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let running = false

export async function runItvUzGuideIfNeeded({
  fetchFn = fetch,
  now = new Date(),
  series = getCached('raw-series-providers')?.series || [],
  gapMs = GAP_MS,
  force = false,
} = {}) {
  if (!itvUzEnabled() || running || !series.length) return null
  const date = now.toISOString().slice(0, 10)
  if (!force && metaGet.get('itvuzLastDate')?.value === date) return null
  running = true
  const get = async (path) => {
    const res = await fetchFn(`${API}${path}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }
  const result = { countries: 0, airings: 0, series: new Set(), channels: 0, errors: [] }
  try {
    const channels = parseItvChannels(await get('/home/get-channels?moduleId=1'))
    // Bugünün Taşkent günü ortası: uç, verilen zamanın gününü döner.
    const ts = Math.floor(Date.parse(`${date}T12:00:00Z`) / 1000) - TZ_HOURS * 3600
    const Channels = []
    for (const ch of channels) {
      await sleep(gapMs)
      try {
        Channels.push(
          toGuideChannel(
            ch.name,
            await get(`/iptv/channels/epg/get-items?channelId=${ch.id}&timeDifference=${TZ_HOURS}&timestamp=${ts}`)
          )
        )
        result.channels++
      } catch (err) {
        result.errors.push(`${ch.name}: ${err.message}`)
      }
    }
    ingestGuideResponses(
      PROVIDER,
      [{ iso2: 'UZ', body: { Channels } }],
      date,
      strictMatcher(buildMatcherFor(PROVIDER, series), manualTitleSet(PROVIDER)),
      result
    )
    if (result.channels > 0) metaSet.run('itvuzLastDate', date)
    console.log(`[itvuz] ${result.channels} kanal, ${result.airings} Türk dizisi yayını (${result.series.size} dizi)`)
  } finally {
    running = false
  }
  return { ...result, series: result.series.size }
}
