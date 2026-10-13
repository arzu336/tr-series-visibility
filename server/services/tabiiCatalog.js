import db from '../db.js'
import { getCached, setCached } from '../cache.js'
import { resolveIso2FromEnglish } from './countryLookup.js'

// tabii (TRT'nin uluslararası platformu) kataloğu ve ülkeleri (2026-10-09; site yöneticisinin tarama izniyle).
//   - Katalog: herkese açık site haritası (sitemap-tr.xml) → /tr/detail/<id>/<slug> sayfaları (~1.300 içerik).
//     Katalogdaki dizi, adının slug'ı birebir tutuyorsa tabii'de sayılır ("Teşkilat" → teskilat).
//   - Ülkeler: tabii.com/en sayfasındaki resmî SSS "In which countries can I watch tabii?" cevabı.
// Haftada bir tazelenir; sonuç 'tabii-catalog' önbelleğinde. data-pipeline.applyTabiiAvailability bunu okuyup
// dizinin yayın kaydına bu ülkelerde "tabii" ekler. TABII_ENABLED=0 kapatır.

const BASE = 'https://www.tabii.com'
const USER_AGENT = 'Mozilla/5.0 (gorunurluk-platformu; izinli tarama)'
export const TABII_CACHE_KEY = 'tabii-catalog'
const TTL_MS = 30 * 24 * 60 * 60 * 1000
const INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
// SSS'deki adlardan ISO kodu olmayan ya da sözlükte farklı geçenler.
const NAME_FIX = { Türkiye: 'TR', 'Czech Republic': 'CZ', 'Turkish Republic of Northern Cyprus': null }

export function tabiiEnabled(env = process.env) {
  return env.TABII_ENABLED !== '0'
}

export function slugify(name) {
  return String(name || '')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Site haritası → [{ id, slug }] (yalnızca içerik sayfaları). */
export function parseSitemapDetails(xml) {
  const out = new Map()
  for (const m of String(xml).matchAll(/\/detail\/(\d+)\/([a-z0-9-]+)</g)) if (!out.has(m[1])) out.set(m[1], m[2])
  return [...out].map(([id, slug]) => ({ id: Number(id), slug }))
}

/** Sayfa verisindeki SSS'den ülke listesi → ISO-2 kodları. */
export function parseTabiiCountries(html) {
  const m = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return []
  let data
  try {
    data = JSON.parse(m[1])
  } catch {
    return []
  }
  const faq = data?.props?.pageProps?.data?.faq?.flatMap((f) => f.items || []) || []
  const item = faq.find((it) => /which countries/i.test(it.title || ''))
  if (!item) return []
  const text = String(item.description || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
  const list = text.split(/countries:\s*/i)[1]?.replace(/\.\s*$/, '') || ''
  const out = new Set()
  for (const raw of list.split(/,|\band\b/)) {
    const name = raw.trim().replace(/\.$/, '')
    if (!name) continue
    const iso2 = name in NAME_FIX ? NAME_FIX[name] : resolveIso2FromEnglish(name)
    if (iso2) out.add(iso2)
  }
  return [...out].sort()
}

// Yalnızca TRT 1 ve tabii yapımları eşlenir: başka kanalın aynı adlı dizisi (Kanal 7'nin "Emanet"i, Kanal D'nin
// "Azize"si) tabii'deki farklı bir içerikle karışmasın (2026-10-09 ilk taramada görüldü).
export const TABII_BROADCASTERS = new Set(['TRT 1', 'tabii'])

/** Katalog dizisi → tabii içeriği (slug birebir). Aynı slug'a iki dizi düşerse hiçbiri eşlenmez. */
export function matchTabii(allSeries, details) {
  const series = allSeries.filter((s) => TABII_BROADCASTERS.has(s.broadcaster))
  const bySlug = new Map(details.map((d) => [d.slug, d]))
  const count = new Map()
  for (const s of series) count.set(slugify(s.name), (count.get(slugify(s.name)) || 0) + 1)
  const out = {}
  for (const s of series) {
    const slug = slugify(s.name)
    const d = bySlug.get(slug)
    if (d && count.get(slug) === 1) out[s.id] = { id: d.id, slug: d.slug, url: `${BASE}/tr/detail/${d.id}/${d.slug}` }
  }
  return out
}

const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
const metaSet = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)

export async function runTabiiCatalogIfNeeded({
  fetchFn = fetch,
  now = Date.now(),
  series = getCached('raw-series-providers')?.series || [],
  force = false,
} = {}) {
  if (!tabiiEnabled() || !series.length) return null
  const last = Number(metaGet.get('tabiiCatalogAt')?.value) || 0
  if (!force && now - last < INTERVAL_MS && getCached(TABII_CACHE_KEY)) return null
  const get = async (path) => {
    const res = await fetchFn(`${BASE}${path}`, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  }
  const [xml, html] = await Promise.all([get('/sitemap-tr.xml'), get('/en')])
  const details = parseSitemapDetails(xml)
  const countries = parseTabiiCountries(html)
  if (!details.length || !countries.length) {
    console.error(
      `[tabii] katalog (${details.length}) ya da ülke listesi (${countries.length}) okunamadı; önceki kayıt korunuyor`
    )
    return null
  }
  const matched = matchTabii(series, details)
  setCached(
    TABII_CACHE_KEY,
    { countries, matched, contents: details.length, fetchedAt: new Date(now).toISOString() },
    TTL_MS
  )
  metaSet.run('tabiiCatalogAt', String(now))
  console.log(
    `[tabii] ${details.length} içerik, ${countries.length} ülke; katalogdan ${Object.keys(matched).length} dizi tabii'de`
  )
  return { contents: details.length, countries: countries.length, matched: Object.keys(matched).length }
}
