import db from '../db.js'
import { getCached } from '../cache.js'
import countryNames from '../../src/data/country-centroids.json' with { type: 'json' }
import { getEnglishTitles } from './localTitles.js'

// Dizi satışları (2026-10-16; kullanıcı onayıyla, izin kapsamında): hangi dizi hangi ülkeye, kime satıldı/yayınlandı.
// Kaynaklar: dağıtımcıların kendi haber sayfaları (Kanal D International, Inter Medya, Eccho Rights), sektör basını
// (Señal News, TodoTV) ve ansiklopedinin "International broadcast" tabloları. Haber metninden yalnızca olgu çıkarılır:
// aynı cümlede dizi adı + ülke (+ varsa alıcı) → (dizi, ülke, alıcı, tarih, kaynak). Haber metni saklanmaz; kaynak adı
// ekranda gösterilmez (yalnızca kayıt). Haftada bir, çalıştırma başına sınırlı sayfa; kaldığı yerden sürer.

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36'
const GAP_MS = 2500
const FETCH_TIMEOUT_MS = 30000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const MIN_NAME = 6
export const RUN_PAGE_BUDGET = 400 // çalıştırma başına makale/sayfa isteği (~17 dk)

db.exec(`
  CREATE TABLE IF NOT EXISTS series_sales_news (
    series_id INTEGER NOT NULL,
    iso2 TEXT NOT NULL,
    buyer TEXT,
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    date TEXT,
    found_at TEXT NOT NULL,
    PRIMARY KEY (series_id, iso2, source, url)
  );
  CREATE INDEX IF NOT EXISTS idx_sales_news_iso2 ON series_sales_news (iso2);
`)

const decode = (s) =>
  String(s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#8217;|&#8216;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()

// ---------------------------------------------------------------------------------------------- eşleyiciler

/** Ülke adları (İngilizce, İspanyolca, Türkçe) → ISO-2; Türkiye hariç; uzun adlar önce. */
export function buildCountryMatcher(iso2s = Object.keys(countryNames)) {
  const pairs = []
  for (const lang of ['en', 'es', 'tr']) {
    const dn = new Intl.DisplayNames([lang], { type: 'region' })
    for (const iso2 of iso2s) {
      if (iso2 === 'TR') continue
      let n
      try {
        n = dn.of(iso2)
      } catch {
        continue
      }
      if (n && n !== iso2 && n.length >= 4) pairs.push([n, iso2])
    }
  }
  for (const iso2 of iso2s) if (iso2 !== 'TR' && countryNames[iso2]?.name) pairs.push([countryNames[iso2].name, iso2])
  // Sık geçen kısaltma ve takma adlar
  pairs.push(
    ['USA', 'US'],
    ['U.S.', 'US'],
    ['UK', 'GB'],
    ['UAE', 'AE'],
    ['Czechia', 'CZ'],
    ['Russia', 'RU'],
    ['Iran', 'IR'],
    ['Syria', 'SY'],
    ['Vietnam', 'VN'],
    ['South Korea', 'KR'],
    ['Korea', 'KR'],
    ['Bosnia', 'BA'],
    ['Macedonia', 'MK'],
    ['Kosovo', 'XK'],
    ['Palestine', 'PS'],
    ['Ivory Coast', 'CI'],
    ['Myanmar', 'MM'],
    ['Laos', 'LA'],
    ['Moldova', 'MD']
  )
  const uniq = [...new Map(pairs.map(([n, i]) => [n.toLocaleLowerCase('en'), [n, i]])).values()].sort(
    (a, b) => b[0].length - a[0].length
  )
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?<![\\p{L}])(${uniq.map(([n]) => esc(n)).join('|')})(?![\\p{L}])`, 'giu')
  const byName = new Map(uniq.map(([n, i]) => [n.toLocaleLowerCase('en'), i]))
  const fn = (text) => [...new Set([...String(text).matchAll(re)].map((m) => byName.get(m[1].toLocaleLowerCase('en'))))]
  fn.names = new Set(byName.keys())
  return fn
}

/** Eşleme için metin: küçük harf, Türkçe harfler sadeleşmiş, noktalama tek boşluk. */
export const normText = (t) =>
  ` ${String(t || '')
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (ch) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' })[ch])
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `

// Tek kelimelik dizi adları ("Halef", "Kuma", "Ezel") ancak metinde büyük harfle başlıyorsa ve cümlede satış/yayın
// sözcüğü varsa sayılır; sık İngilizce/İspanyolca sözcüklerle çakışanlar hiç sayılmaz.
const SINGLE_STOP = new Set([
  'kara',
  'masum',
  'kiralik',
  'intikam',
  'sen',
  'ask',
  'kalp',
  'hayat',
  'sila',
  'persona',
  'ruya',
  'gonul',
  'leyla',
  'elif',
  'ada',
  'kim',
  'ver',
  'son',
  'yol',
  'ates',
  'nisan',
  'cocuk',
  'anne',
  'baba',
  'kardes',
])

/** Metinde, sadeleşmiş hâli `key` olan ve büyük harfle başlayan bir sözcük var mı ("Halef", "HALEF", "Fatmagul")? */
function capitalized(text, key) {
  for (const m of String(text).matchAll(/\p{Lu}[\p{L}\p{N}'’]*/gu)) if (normText(m[0]).trim() === key) return true
  return false
}

/**
 * Dizi adı eşleyici: Türkçe ad, IMDb İngilizce adları; metin ve adlar aynı biçime indirgenip aranır
 * ("Kuruluş: Osman" = "Kurulus Osman" = "KURULUŞ OSMAN"). `series`: [{ id, name, englishTitles }].
 * Dönen: (cümle) → [{ id, name, single }].
 */
export function buildSeriesMatcher(series) {
  const entries = []
  for (const s of series)
    for (const n of new Set([s.name, ...(s.englishTitles || [])].filter(Boolean))) {
      const key = normText(n).trim()
      if (!key) continue
      const single = !key.includes(' ')
      if (single && (key.length < 4 || SINGLE_STOP.has(key))) continue
      if (!single && key.length < MIN_NAME) continue
      entries.push([n, key, s.id, single])
    }
  const idsByKey = new Map()
  for (const [, k, id] of entries) idsByKey.set(k, new Set([...(idsByKey.get(k) || []), id]))
  const unique = entries.filter(([, k]) => idsByKey.get(k).size === 1)
  const byKey = new Map(unique.map(([n, k, id, single]) => [k, { id, name: n, single }]))
  const re = new RegExp(
    ` (${[...new Set(unique.map(([, k]) => k))].sort((a, b) => b.length - a.length).join('|')}) `,
    'g'
  )
  return (text) => {
    const out = new Map()
    const norm = normText(text)
    let m
    re.lastIndex = 0
    while ((m = re.exec(norm))) {
      re.lastIndex = m.index + m[0].length - 1 // bitiş boşluğu bir sonraki adın başı olabilir
      const hit = byKey.get(m[1])
      if (!hit || out.has(hit.id)) continue
      // Tek kelimelik ad: metinde büyük harfle başlayan ("Halef", "HALEF") bir geçişi olmalı.
      if (hit.single && !capitalized(text, m[1])) continue
      out.set(hit.id, hit)
    }
    return [...out.values()]
  }
}

const SALE_WORDS =
  /\b(sold|sells|selling|joins?|joined|added|available|licen[cs]ed|licen[cs]es|licensing|acquired?|acquires|acquisition|picked up|picks up|deal|deals|agreement|bought|buys|premieres?|premiered|airs?|aired|airing|debuts?|debuted|launch(?:es|ed|ing)?|lands?|landed|arrives?|arriving|broadcast|distribut|vendi[óo]|vende|adquiri[óo]|adquiere|estren[ao]|llega|emit[ie]|satıldı|satış|yayınlan)/i
const BUYER_RE =
  /\b(?:to|on|by|with|for|at|[Jj]oins?|[Jj]oined)\s+((?:\p{Lu}[\p{L}\p{N}'’&+.-]*|TV|HD|1|2|3|4|5|7|8|24|360)(?:\s+(?:\p{Lu}[\p{L}\p{N}'’&+.-]*|TV|HD|Channel|1|2|3|4|5|7|8|24|360)){0,3})/gu
// Satıcı tarafı (dağıtımcılar, yapımcılar) alıcı değildir.
const SELLERS =
  /^(Inter Medya|Kanal D|Kanal D International|Eccho Rights|Calinos|Global Agency|Madd Entertainment|ATV|ATV Distribution|OGM|OGM Universe|Mistco|TRT|TIMS&B|TIMS&B Productions|Ay Yapım|Ay Yapim|MF Yapım|Medyapım|Gold Film|Tims Productions|O3 Medya|Bi Yapım|NTC Medya|Süreç Film|Pastel Film|Most Production|Pana Film|Tekden Film|Yesil Yapim|Yeşil Yapım|Content Americas|MIPCOM|MIP|NATPE|Series Mania|Netflix in|Disney)\b/i
/** Cümledeki olası alıcı adı (ülke adları ve dizi adları hariç); bulunamazsa null. */
export function guessBuyer(sentence, { countryText = [], seriesText = [] } = {}) {
  const skip = new Set([...countryText, ...seriesText].map((s) => s.toLowerCase()))
  const bad =
    /^(The|A|An|In|Its|Air|Airs|Premiere|Premieres|Launch|Launches|Broadcast|Stream|Streaming|Debut|Their|This|That|Turkish|Turkey|Series|Drama|Dramas|Season|Episode|Spanish|Italian|Panamanian|Mexican|Brazilian|Argentine|Chilean|Colombian|German|French|Greek|Romanian|Bulgarian|Serbian|Croatian|Hungarian|Polish|Russian|Arabic|Latin|America|Europe|MENA|Asia|Africa|January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i
  for (const m of sentence.matchAll(BUYER_RE)) {
    // "starring Murat Yıldırım", "produced by …": kişi ve yapımcı adı alıcı değil
    if (
      /\b(starring|starred|stars?|led|actor|actress|cast|produced|directed|written|created|distributed)\b[^.]{0,12}$/i.test(
        sentence.slice(Math.max(0, m.index - 24), m.index)
      )
    )
      continue
    // "Spain's Antena 3" → "Antena 3"; "Air", "Premiere" gibi fiil kalıntıları alıcı değil
    const cand = m[1]
      .replace(/^(.+?)['’]s\s+/u, (p, c) => (skip.has(c.toLowerCase()) ? '' : p))
      .replace(/\s+(Deal|Deals|During|Agreement|Partnership|Licen[cs]e)\b.*$/i, '') // "Caracol Televisión Deal"
      .replace(/[.,;:]+$/, '')
      .trim()
    if (cand.length < 3 || bad.test(cand) || SELLERS.test(cand) || skip.has(cand.toLowerCase())) continue
    if (/^(Turkish|Turkey)\b/i.test(cand) || /['’]s$/u.test(cand)) continue
    // Üç ve daha çok kelimelik BÜYÜK HARFLİ aday dizi adı parçasıdır ("THE GIRL OF THE")
    if (cand.split(/\s+/).length >= 3 && cand === cand.toLocaleUpperCase('en')) continue
    return cand
  }
  return null
}

/**
 * Metinden olgular: aynı cümlede dizi + ülke (+ satış/yayın sözcüğü — dağıtımcı kaynağında aranmaz).
 * Dönen: [{ seriesId, iso2, buyer }].
 */
export function extractFacts(text, { matchSeries, matchCountries, requireVerb = true }) {
  const out = new Map()
  for (const sentence of String(text).split(/(?<=[.!?])\s+|\n+/)) {
    const hasVerb = SALE_WORDS.test(sentence)
    if (requireVerb && !hasVerb) continue
    const series = matchSeries(sentence).filter((s) => hasVerb || !s.single)
    if (!series.length) continue
    const countries = matchCountries(sentence)
    if (!countries.length) continue
    const buyer = guessBuyer(sentence, {
      seriesText: series.map((s) => s.name),
      countryText: [...(matchCountries.names || [])],
    })
    for (const iso2 of countries)
      for (const s of series) {
        const k = `${s.id}|${iso2}`
        if (!out.has(k) || (buyer && !out.get(k).buyer)) out.set(k, { seriesId: s.id, iso2, buyer })
      }
  }
  return [...out.values()]
}

// ---------------------------------------------------------------------------------------------- kaynaklar

const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
const metaSet = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)
const put = db.prepare(
  `INSERT INTO series_sales_news (series_id, iso2, buyer, source, url, date, found_at) VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(series_id, iso2, source, url) DO UPDATE SET buyer = COALESCE(excluded.buyer, series_sales_news.buyer),
     date = COALESCE(excluded.date, series_sales_news.date)`
)
const seenUrl = db.prepare('SELECT 1 FROM series_sales_news WHERE url = ? LIMIT 1')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function textOfHtml(html) {
  const h = String(html).replace(
    /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi,
    ' '
  )
  const main = h.match(/<article[\s\S]*?<\/article>/i)?.[0] || h.match(/<main[\s\S]*?<\/main>/i)?.[0] || h
  return decode(main)
}

export function dateOfHtml(html) {
  const h = String(html)
  const iso =
    h.match(/datetime="(\d{4}-\d{2}-\d{2})/)?.[1] ||
    h.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/)?.[1] ||
    h.match(/article:published_time"\s+content="(\d{4}-\d{2}-\d{2})/)?.[1]
  if (iso) return iso
  const m = h.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

/** WordPress JSON (Kanal D International, Inter Medya): bütün yazılar, sayfa sayfa. */
async function wpSource({ base, label, requireVerb }, ctx) {
  let page = Number(metaGet.get(`salesNews:${label}:page`)?.value || 1)
  for (; ctx.budget > 0; page++) {
    const url = `${base}/wp-json/wp/v2/posts?per_page=50&page=${page}&_fields=id,date,link,title,content`
    const res = await ctx.get(url)
    if (res.status === 400 || res.status === 404) break // sayfa aralığı dışı
    if (!res.ok) throw new Error(`${label} HTTP ${res.status}`)
    const posts = await res.json()
    if (!posts.length) break
    for (const p of posts) {
      const text = `${decode(p.title?.rendered)}.\n${decode(p.content?.rendered)}`
      ctx.save(extractFacts(text, { ...ctx.matchers, requireVerb }), {
        source: label,
        url: p.link,
        date: String(p.date || '').slice(0, 10) || null,
      })
    }
    metaSet.run(`salesNews:${label}:page`, String(page + 1))
    if (posts.length < 50) break
  }
}

/** Liste sayfası → makale bağlantıları → makale metni. `pages(n)`: n. liste sayfası adresi. */
async function listSource({ label, pages, linkRe, requireVerb, maxPages }, ctx) {
  let page = Number(metaGet.get(`salesNews:${label}:page`)?.value || 1)
  for (; page <= maxPages && ctx.budget > 0; page++) {
    const res = await ctx.get(pages(page))
    if (!res.ok) throw new Error(`${label} liste HTTP ${res.status}`)
    const html = await res.text()
    const links = [...new Set([...html.matchAll(linkRe)].map((m) => m[1]))]
    if (!links.length) break
    for (const link of links) {
      if (ctx.budget <= 0) return
      if (seenUrl.get(link)) continue
      const art = await ctx.get(link)
      if (!art.ok) continue
      const body = await art.text()
      const facts = extractFacts(textOfHtml(body), { ...ctx.matchers, requireVerb })
      ctx.save(facts, { source: label, url: link, date: dateOfHtml(body) })
      // Olgusuz makale de bir daha açılmasın: boş kayıt yerine ziyaret listesi
      ctx.visited.add(link)
    }
    metaSet.run(`salesNews:${label}:page`, String(page + 1))
  }
}

const SENAL_TAGS = [
  'inter-medya',
  'kanal-d-international',
  'calinos-entertainment',
  'eccho-rights',
  'madd-entertainment',
  'global-agency',
  'atv-distribution',
  'ogm-universe',
  'mistco',
  'trt-sales',
  'turkish-drama',
]

export const SOURCES = [
  {
    key: 'kanald',
    kind: 'wp',
    base: 'https://kanald.international',
    label: 'kanald-international',
    requireVerb: false,
  },
  { key: 'intermedya', kind: 'wp', base: 'https://intermedya.tv', label: 'inter-medya', requireVerb: false },
  {
    key: 'eccho',
    kind: 'list',
    label: 'eccho-rights',
    pages: () => 'https://ecchorights.com/articles',
    linkRe: /href="(https:\/\/ecchorights\.com\/articles\/show\/[^"]+)"/g,
    requireVerb: false,
    maxPages: 1,
  },
  ...SENAL_TAGS.map((tag) => ({
    key: `senal:${tag}`,
    kind: 'list',
    label: `senal:${tag}`,
    pages: (n) => `https://senalnews.com/en/tags/${tag}?pagina=${n}`,
    linkRe: /href="(https:\/\/senalnews\.com\/en\/content\/[a-z0-9-]{20,})"/g,
    requireVerb: true,
    maxPages: 60,
  })),
  {
    key: 'todotv',
    kind: 'list',
    label: 'todotv',
    pages: (n) => `https://todotvnews.com/en/page/${n}/?s=turkish`,
    linkRe: /href="(https:\/\/todotvnews\.com\/en\/[a-z0-9-]{12,}\/)"/g,
    requireVerb: true,
    maxPages: 170,
  },
]

/** Ansiklopedi "International broadcast" tabloları: ülke, kanal, prömiyer. Dizinin İngilizce maddesi gerekir. */
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/** Tablo hücresindeki tarih: data-sort / ISO / "24 April 2020" / yalnızca yıl; yoksa null. */
export function cellDate(rawHtml) {
  const raw = String(rawHtml || '')
  const sorted = raw.match(/data-sort(?:-value)?="(\d{4}-\d{2}-\d{2})/)?.[1]
  if (sorted) return sorted
  const text = decode(raw)
  const iso = text.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
  if (iso) return iso
  const dmy = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/) || text.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/)
  if (dmy) {
    const [d, mon] = /^\d/.test(dmy[1]) ? [dmy[1], dmy[2]] : [dmy[2], dmy[1]]
    const mi = MONTHS.indexOf(mon.toLowerCase())
    if (mi >= 0) return `${dmy[3]}-${String(mi + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return text.match(/(\d{4})/)?.[1] || null
}

export function parseBroadcastTable(sectionHtml, matchCountries) {
  const out = []
  for (const row of String(sectionHtml).matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const raw = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => m[1])
    if (raw.length < 2) continue
    const iso2 = matchCountries(decode(raw[0]))[0]
    if (!iso2) continue
    out.push({ iso2, buyer: decode(raw[1]).split(/,|;/)[0]?.trim() || null, date: cellDate(raw[2]) })
  }
  return out
}

async function wikipediaSource(ctx) {
  const rows = db.prepare("SELECT tmdb_id, title FROM series_wiki_articles WHERE lang = 'en'").all()
  const done = new Set(
    db
      .prepare("SELECT DISTINCT series_id FROM series_sales_news WHERE source = 'wikipedia'")
      .all()
      .map((r) => r.series_id)
  )
  const checked = new Set(
    String(metaGet.get('salesNews:wikipedia:checked')?.value || '')
      .split(',')
      .filter(Boolean)
  )
  for (const r of rows) {
    if (ctx.budget <= 0) break
    if (done.has(r.tmdb_id) || checked.has(String(r.tmdb_id)) || !ctx.catalog.has(r.tmdb_id)) continue
    const api = 'https://en.wikipedia.org/w/api.php'
    const page = encodeURIComponent(r.title)
    const sec = await ctx.get(`${api}?action=parse&page=${page}&prop=sections&format=json`)
    checked.add(String(r.tmdb_id))
    if (!sec.ok) continue
    const sections = (await sec.json())?.parse?.sections || []
    const target = sections.find((s) => /broadcast/i.test(s.line) && /international|abroad|foreign/i.test(s.line))
    if (!target) continue
    const res = await ctx.get(`${api}?action=parse&page=${page}&section=${target.index}&prop=text&format=json`)
    if (!res.ok) continue
    const html = (await res.json())?.parse?.text?.['*'] || ''
    const url = `https://en.wikipedia.org/wiki/${page}#${encodeURIComponent(target.line.replace(/ /g, '_'))}`
    ctx.save(
      parseBroadcastTable(html, ctx.matchers.matchCountries).map((x) => ({ seriesId: r.tmdb_id, ...x })),
      { source: 'wikipedia', url, date: null, perRowDate: true }
    )
  }
  metaSet.run('salesNews:wikipedia:checked', [...checked].join(','))
}

let running = false

export async function runSalesNewsIfNeeded({
  fetchFn = fetch,
  now = new Date(),
  series = getCached('raw-series-providers')?.series || [],
  force = false,
  budget = RUN_PAGE_BUDGET,
  gapMs = GAP_MS,
  sources = SOURCES,
  wikipedia = true,
} = {}) {
  if (running || !series.length) return null
  const last = Number(metaGet.get('salesNewsAt')?.value || 0)
  if (!force && now.getTime() - last < WEEK_MS) return null
  running = true
  const result = { requests: 0, facts: 0, errors: [] }
  const withTitles = series.map((s) => ({ id: s.id, name: s.name, englishTitles: getEnglishTitles(s.id, s.name) }))
  const ctx = {
    budget,
    catalog: new Set(series.map((s) => s.id)),
    matchers: { matchSeries: buildSeriesMatcher(withTitles), matchCountries: buildCountryMatcher() },
    visited: new Set(),
    async get(url) {
      ctx.budget--
      result.requests++
      await sleep(gapMs)
      return fetchFn(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    },
    save(facts, { source, url, date, perRowDate = false }) {
      for (const f of facts) {
        put.run(f.seriesId, f.iso2, f.buyer || null, source, url, perRowDate ? f.date : date, now.toISOString())
        result.facts++
      }
    },
  }
  try {
    for (const src of sources) {
      if (ctx.budget <= 0) break
      try {
        if (src.kind === 'wp') await wpSource(src, ctx)
        else await listSource(src, ctx)
      } catch (err) {
        result.errors.push(`${src.label}: ${err.message}`)
      }
    }
    if (wikipedia && ctx.budget > 0) {
      try {
        await wikipediaSource(ctx)
      } catch (err) {
        result.errors.push(`wikipedia: ${err.message}`)
      }
    }
    // Bütçe bitmeden bütün kaynaklar tükendiyse tur tamamlandı; yoksa bir sonraki hafta kaldığı yerden sürer.
    if (ctx.budget > 0) {
      metaSet.run('salesNewsAt', String(now.getTime()))
      for (const src of sources) db.prepare('DELETE FROM meta WHERE key = ?').run(`salesNews:${src.label}:page`)
    }
    console.log(`[salesNews] ${result.requests} istek, ${result.facts} olgu, hata ${result.errors.length}`)
  } finally {
    running = false
  }
  return result
}

// ---------------------------------------------------------------------------------------------- okuma

/** Dizinin satıldığı/yayınlandığı ülkeler: ülke başına ilk tarih, alıcılar, kaç kaynak. */
export function getSeriesSales(seriesId) {
  const rows = [
    ...db.prepare('SELECT iso2, buyer, source, date FROM series_sales_news WHERE series_id = ?').all(seriesId),
    ...db
      .prepare('SELECT iso2, buyer, distributor source, start_date date FROM distribution_sales WHERE series_id = ?')
      .all(seriesId),
  ]
  const by = new Map()
  for (const r of rows) {
    const c = by.get(r.iso2) || { iso2: r.iso2, buyers: new Set(), sources: new Set(), firstDate: null }
    if (r.buyer) c.buyers.add(r.buyer)
    c.sources.add(r.source)
    if (r.date && (!c.firstDate || r.date < c.firstDate)) c.firstDate = r.date
    by.set(r.iso2, c)
  }
  return [...by.values()]
    .map((c) => ({ iso2: c.iso2, buyers: [...c.buyers].slice(0, 3), sources: c.sources.size, firstDate: c.firstDate }))
    .sort((a, b) => (b.firstDate || '').localeCompare(a.firstDate || '') || a.iso2.localeCompare(b.iso2))
}

/** Ülkeye satılan/orada yayınlanan diziler. */
export function getCountrySales(iso2) {
  const code = String(iso2).toUpperCase()
  const rows = [
    ...db.prepare('SELECT series_id, buyer, source, date FROM series_sales_news WHERE iso2 = ?').all(code),
    ...db
      .prepare('SELECT series_id, buyer, distributor source, start_date date FROM distribution_sales WHERE iso2 = ?')
      .all(code),
  ]
  const by = new Map()
  for (const r of rows) {
    const c = by.get(r.series_id) || { seriesId: r.series_id, buyers: new Set(), sources: new Set(), firstDate: null }
    if (r.buyer) c.buyers.add(r.buyer)
    c.sources.add(r.source)
    if (r.date && (!c.firstDate || r.date < c.firstDate)) c.firstDate = r.date
    by.set(r.series_id, c)
  }
  return [...by.values()]
    .map((c) => ({
      seriesId: c.seriesId,
      buyers: [...c.buyers].slice(0, 3),
      sources: c.sources.size,
      firstDate: c.firstDate,
    }))
    .sort((a, b) => (b.firstDate || '').localeCompare(a.firstDate || ''))
}
