import zlib from 'node:zlib'
import { Readable } from 'node:stream'
import db from '../db.js'
import { getCached } from '../cache.js'
import { buildMatcherFor, ingestGuideResponses, manualTitleSet } from './tvGuide.js'

// Rusya ve Orta Asya yayın akışı (2026-10-13; kullanıcı onayıyla, izin kapsamında). epg.pw'nin "RU" XMLTV dosyası
// ~4.000 kanal: Rusya'nın yanında Kazakistan, Kırgızistan, Özbekistan… kanalları da içinde (7 канал KZ, КТК, ЭлТР [KG],
// Любимый [KG]). Günde bir kez bugünün programları alınır. Türk dizileri Rusça/yerel adlarıyla, DStv ve mi.tv ile aynı
// eşleyiciyle (Türkçe ad + IMDb'deki yerel adlar, birebir) bağlanır; tahminle eşleme yok. Eşleşmeyen başlıklar Türk
// dizisi yayınlayan kanallarda tv_titles'a düşer (elle bağlanabilir). EPGPW_ENABLED=0 kapatır.

const URL = 'https://epg.pw/xmltv/epg_RU.xml.gz'
const USER_AGENT = 'gorunurluk-platformu/1.0 (izinli rehber toplama)'
const PROVIDER = 'epgpw'

export function epgPwEnabled(env = process.env) {
  return env.EPGPW_ENABLED !== '0'
}

const decode = (s) =>
  String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Rehber başlığını çıplak dizi adına indirger: "т/с Однажды в Чукурова", "Основание Осман. 401 с.",
 * "Алп-Арслан: Великий Сельджук | S01E32", "Иффет (16+)" → ad.
 */
export function cleanEpgTitle(title) {
  return decode(title)
    .replace(/^(?:т\/с|Т\/С|т\.с\.|х\/ф|м\/с|д\/с|сериал)\s*/i, '')
    .replace(/\s*\|\s*S\d+\s*E\d+.*$/i, '')
    .replace(/\s*\(\d{1,2}\+\)\s*/g, ' ')
    .replace(/[.,]?\s*\d+(?:\s*[-–]\s*\d+)?\s*(?:-?я)?\s*(?:с\.|с|серия|серии|qism|бөлім|bölüm)\.?\s*$/i, '')
    .replace(/\s*\(\s*\d+\s*\)\s*$/, '')
    .replace(/[.\s]+$/, '')
    .trim()
}

// Etiketsiz Kazakistan kanalları (ulusal ve bölgesel).
const KZ_CHANNELS = new Set(
  [
    'AQJAIYQ',
    'Qyzyljar',
    'Mangystay',
    'Ontustik',
    'ERTIS',
    'Kokshe',
    'Semei',
    'Saryarqa',
    'Хабар',
    'Хабар 24',
    'Казахстан',
    'КТК',
    '7 канал KZ',
    'Достық',
    '31 канал',
    'Астана',
    'Алматы',
    'Atameken Business',
    'Jibek Joly',
    'Balapan',
    'Ел арна',
    'Новое телевидение',
    'НТК',
    'Первый канал Евразия',
    'Евразия',
    'AQTOBE',
  ].map((s) => s.toLocaleLowerCase('ru'))
)
// Latin harfli etiketsiz kanallar ancak burada varsa sayılır (dosyada Rusya dışından kanallar da var: TV Puls, Zee-TV…).
const LATIN_CHANNELS = new Map([
  ['start world', 'RU'],
  ['kinojam 1', 'RU'],
  ['kinojam 2', 'RU'],
  ['kinojam 3', 'RU'],
  ['timeless dizi channel', 'RU'],
  ['tv puls', 'PL'],
  ['tv3 life', 'LV'],
])
// Türk dizisi yayınlamayan ya da ülkesi tartışmalı kanallar: eşleşmeleri sayılmaz.
const SKIP_CHANNELS = new Set(['zee-tv', 'миллет'])
const TAG_COUNTRY = { UK: 'GB' }
const WORD_COUNTRY = [
  [/казахстан|qazaqstan|\bkz\b/i, 'KZ'],
  [/кыргызстан|kyrgyz|\bkg\b/i, 'KG'],
  [/узбекистан|o'zbekiston|uzbek|\buz\b/i, 'UZ'],
  [/эстони/i, 'EE'],
  [/беларус/i, 'BY'],
  [/украин/i, 'UA'],
  [/армени/i, 'AM'],
  [/азербайджан/i, 'AZ'],
  [/грузи/i, 'GE'],
  [/молдов/i, 'MD'],
  [/латви/i, 'LV'],
  [/литв/i, 'LT'],
]

// Program adlarının yazısından dil: Kazakça ve Ukraynaca harfler (dosyada etiketsiz Ukrayna kanalları da var:
// "Бiгудi", "М1", "Сонце+"; adları "Пані Фазілет і її доньки").
const SCRIPT_COUNTRY = [
  [/[әғқңөұүһ]/i, 'KZ'],
  [/[їєґ]|(?:^|[\s,.])і(?:[\s,.]|$)|[а-я]і[а-я]/i, 'UA'],
  [/ў/i, 'BY'],
]

/** Kanalın program adlarının en az beşte biri bir dilin harflerini taşıyorsa o ülke. */
export function scriptCountry(titles = []) {
  if (!titles.length) return null
  for (const [re, iso2] of SCRIPT_COUNTRY)
    if (titles.filter((t) => re.test(t)).length / titles.length >= 0.2) return iso2
  return null
}

/**
 * Kanalın ülkesi: köşeli parantez etiketi ("Любимый [KG]"), adında geçen ülke ("7 канал KZ", "ETV+ Эстония"),
 * etiketsiz Kazakistan kanalları listesi, program adlarının dili (Kazakça/Ukraynaca); kalan Kiril adlı kanallar
 * Rusya (dosya Rusya rehberi). `titles`: kanalın o günkü program adları.
 */
export function epgChannelCountry(name, titles = []) {
  const n = String(name || '').trim()
  const low = n.toLocaleLowerCase('ru')
  if (SKIP_CHANNELS.has(low)) return null
  const tag = n.match(/\[([A-Z]{2})\]\s*$/)?.[1]
  if (tag) return TAG_COUNTRY[tag] || tag
  if (/\sTR$/.test(n)) return 'TR' // Türkiye kanalları ("Star TV HD TR")
  if (KZ_CHANNELS.has(low)) return 'KZ'
  for (const [re, iso2] of WORD_COUNTRY) if (re.test(n)) return iso2
  if (LATIN_CHANNELS.has(low)) return LATIN_CHANNELS.get(low)
  const byScript = scriptCountry(titles)
  if (byScript) return byScript
  return /[а-яё]/i.test(n) ? 'RU' : null
}

/**
 * Tek kelimelik ad ("Месть", "Клуб", "Республика") filmlerle ve başka yapımlarla çok sık çakışıyor: yalnızca kesin
 * (çok kelimeli) bir Türk dizisi eşleşmesi görülen kanalda kabul edilir (tvGuide'daki güvenilir kanal kuralı).
 */
export function strictMatcher(match, manual = new Set()) {
  return (title, opts = {}) => {
    const single = cleanEpgTitle(title).split(/\s+/).filter(Boolean).length < 2
    if (single && !opts.allowAmbiguous && !manual.has(title)) return null
    return match(title, opts)
  }
}

/**
 * XMLTV metnini (parça parça) okuyup yalnızca `date` (UTC, YYYYMMDD) günü başlayan programları kanal başına sayar.
 * Dönen: { channels: Map<id, ad>, titles: Map<kanalId, Map<başlık, adet>> }. Saf; testler doğrudan çağırır.
 */
export function createXmltvCollector(date) {
  const channels = new Map()
  const titles = new Map()
  let buf = ''
  const chRe = /<channel id="([^"]+)"[^>]*>\s*<display-name[^>]*>([^<]*)<\/display-name>/g
  const prRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g
  const take = (final) => {
    let last = 0
    for (const m of buf.matchAll(chRe)) {
      channels.set(m[1], decode(m[2]))
      last = Math.max(last, m.index + m[0].length)
    }
    for (const m of buf.matchAll(prRe)) {
      last = Math.max(last, m.index + m[0].length)
      const start = m[1].match(/start="(\d{8})/)?.[1]
      if (start !== date) continue
      const ch = m[1].match(/channel="([^"]+)"/)?.[1]
      const title = cleanEpgTitle(m[2].match(/<title[^>]*>([^<]*)<\/title>/)?.[1])
      if (!ch || !title) continue
      if (!titles.has(ch)) titles.set(ch, new Map())
      const t = titles.get(ch)
      t.set(title, (t.get(title) || 0) + 1)
    }
    // Yarım kalan son öğe bir sonraki parçayla tamamlanır.
    buf = final ? '' : buf.slice(last)
  }
  return {
    push(text) {
      buf += text
      if (buf.length > 4_000_000) take(false)
    },
    end() {
      take(true)
      return { channels, titles }
    },
  }
}

/** Toplanan programları ülke başına DStv yanıt biçimine çevirir. */
export function toCountryResponses({ channels, titles }) {
  const byCountry = new Map()
  for (const [id, counts] of titles) {
    const name = channels.get(id) || id
    const iso2 = epgChannelCountry(name, [...counts.keys()])
    if (!iso2 || iso2 === 'TR') continue // ülkesi bilinmeyen ve Türkiye kanalları
    if (!byCountry.has(iso2)) byCountry.set(iso2, [])
    const Programmes = []
    for (const [Title, n] of counts) for (let i = 0; i < n; i++) Programmes.push({ Title })
    byCountry.get(iso2).push({ Name: name, Programmes })
  }
  return [...byCountry].map(([iso2, Channels]) => ({ iso2, body: { Channels } }))
}

const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
const metaSet = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)

let running = false

export async function runEpgPwGuideIfNeeded({
  fetchFn = fetch,
  now = new Date(),
  series = getCached('raw-series-providers')?.series || [],
  force = false,
} = {}) {
  if (!epgPwEnabled() || running || !series.length) return null
  const date = now.toISOString().slice(0, 10)
  if (!force && metaGet.get('epgpwLastDate')?.value === date) return null
  running = true
  const result = { countries: 0, airings: 0, series: new Set(), channels: 0, errors: [] }
  try {
    const res = await fetchFn(URL, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const collector = createXmltvCollector(date.replaceAll('-', ''))
    const gunzip = Readable.fromWeb(res.body).pipe(zlib.createGunzip())
    gunzip.setEncoding('utf8')
    for await (const chunk of gunzip) collector.push(chunk)
    const parsed = collector.end()
    result.channels = parsed.channels.size
    ingestGuideResponses(
      PROVIDER,
      toCountryResponses(parsed),
      date,
      strictMatcher(buildMatcherFor(PROVIDER, series), manualTitleSet(PROVIDER)),
      result
    )
    metaSet.run('epgpwLastDate', date)
    console.log(
      `[epgpw] ${result.channels} kanal, ${result.countries} ülke, ${result.airings} Türk dizisi yayını (${result.series.size} dizi)`
    )
  } catch (err) {
    result.errors.push(err.message)
    console.error('[epgpw] rehber alınamadı:', err.message)
  } finally {
    running = false
  }
  return { ...result, series: result.series.size }
}
