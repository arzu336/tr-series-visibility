import db from '../db.js'

const PAGEVIEWS_BASE = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article'
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'

const UA = 'gorunurluk-platformu/1.0 (kurumsal kultur analizi araci)'

const ACCESS = 'all-access'
const AGENT = 'user'

const DIL_OLMAYAN_WIKILER = new Set([
  'commonswiki',
  'metawiki',
  'specieswiki',
  'incubatorwiki',
  'sourceswiki',
  'outreachwiki',
  'mediawikiwiki',
  'wikidatawiki',
  'foundationwiki',
])

const WIKIDATA_BATCH = 50

const ESZAMANLI = 2

const YENIDEN_DENEME = 4
const GERI_CEKILME_MS = [1000, 3000, 8000, 20000]

/**
 * `arwiki` -> `ar`. Dil sürümü değilse null döner (çağıran taraf atlar).
 */
export function siteKeyToLang(siteKey) {
  if (typeof siteKey !== 'string') return null
  if (DIL_OLMAYAN_WIKILER.has(siteKey)) return null
  const m = /^([a-z0-9-]+)wiki$/.exec(siteKey)
  return m ? m[1] : null
}

/**
 * Pageviews API başlıkları alt çizgili ve URL-kodlu bekler. Başlıkta eğik çizgi varsa
 * (örn. "Dizi/Bölümler") kodlanmazsa yol ayracı sanılır ve 404 döner.
 */
export function encodeArticleTitle(title) {
  return encodeURIComponent(String(title).replace(/ /g, '_'))
}

function ymd(date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}01`
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms))

async function jsonGet(url) {
  let sonDurum = 0
  for (let deneme = 0; deneme <= YENIDEN_DENEME; deneme++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
    if (res.status === 404) return null
    if (res.ok) return res.json()

    sonDurum = res.status
    if (res.status !== 429 && res.status !== 503) break
    if (deneme === YENIDEN_DENEME) break

    const retryAfter = Number(res.headers.get('retry-after'))
    await bekle(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : GERI_CEKILME_MS[deneme])
  }
  throw new Error(`${sonDurum} ${url.slice(0, 120)}`)
}

/**
 * Wikidata kimliklerinden dil -> makale başlığı eşlemesi. 50'lik gruplar hâlinde sorgulanır:
 * 399 dizi için ~8 istek eder, dizi başına ayrı istek atmak yerine.
 */
export async function fetchSitelinks(qids) {
  const sonuc = new Map()
  for (let i = 0; i < qids.length; i += WIKIDATA_BATCH) {
    const grup = qids.slice(i, i + WIKIDATA_BATCH)
    const url = `${WIKIDATA_API}?action=wbgetentities&ids=${grup.join('|')}&props=sitelinks&format=json`
    const data = await jsonGet(url)
    for (const qid of grup) {
      const sitelinks = data?.entities?.[qid]?.sitelinks || {}
      const satirlar = []
      for (const [siteKey, bilgi] of Object.entries(sitelinks)) {
        const lang = siteKeyToLang(siteKey)
        if (lang && bilgi?.title) satirlar.push({ lang, title: bilgi.title })
      }
      sonuc.set(qid, satirlar)
    }
  }
  return sonuc
}

/**
 * Tek bir makalenin aylık okunma serisi. Makale yoksa/hiç okunmamışsa BOŞ dizi döner —
 * sıfır uydurulmaz, "veri yok" ile "sıfır ilgi" karıştırılmaz.
 */
export async function fetchMonthlyPageviews(lang, title, baslangic, bitis) {
  const url = `${PAGEVIEWS_BASE}/${lang}.wikipedia/${ACCESS}/${AGENT}/${encodeArticleTitle(title)}/monthly/${ymd(baslangic)}00/${ymd(bitis)}00`
  const data = await jsonGet(url)
  if (!data?.items) return []
  return data.items.map((it) => ({
    year: Number(it.timestamp.slice(0, 4)),
    month: Number(it.timestamp.slice(4, 6)),
    views: Number(it.views) || 0,
  }))
}

/**
 * Sınırlı eşzamanlılıkla iş kuyruğu — Promise.all ile binlerce isteği aynı anda açmak
 * Wikimedia tarafında da bizde de sorun çıkarır.
 */
async function havuzdaCalistir(isler, isci) {
  const sonuclar = []
  let sira = 0
  async function tuket() {
    while (sira < isler.length) {
      const i = sira++
      try {
        sonuclar[i] = await isci(isler[i], i)
      } catch (err) {
        sonuclar[i] = { hata: err.message }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(ESZAMANLI, isler.length) }, tuket))
  return sonuclar
}

const upsertArticleStmt = db.prepare(`
  INSERT INTO series_wiki_articles (tmdb_id, lang, wikidata_id, title, resolved_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(tmdb_id, lang) DO UPDATE SET
    wikidata_id = excluded.wikidata_id,
    title = excluded.title,
    resolved_at = excluded.resolved_at
`)

const upsertViewsStmt = db.prepare(`
  INSERT INTO series_language_interest (tmdb_id, lang, year, month, views)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(tmdb_id, lang, year, month) DO UPDATE SET views = excluded.views
`)

export function saveArticles(tmdbId, wikidataId, satirlar) {
  const now = new Date().toISOString()
  for (const s of satirlar) upsertArticleStmt.run(tmdbId, s.lang, wikidataId, s.title, now)
}

export function saveMonthlyViews(tmdbId, lang, satirlar) {
  for (const s of satirlar) upsertViewsStmt.run(tmdbId, lang, s.year, s.month, s.views)
}

export const listArticlesStmt = db.prepare('SELECT tmdb_id, lang, title FROM series_wiki_articles')

export { havuzdaCalistir }
