import db from '../db.js'

// --- NEDEN BU KATMAN VAR ----------------------------------------------------------------------
// Platformun uluslararası zaman derinliği ölçüldüğünde 63 GÜNDÜ (visibility_history:
// 2026-07-20 -> 2026-09-21; aylık özet tabloda yalnızca 2 tam ay). Gelen geri bildirimlerin
// neredeyse tamamı ise DEĞİŞİM iddiası istiyordu: "şu ülkede artış olmuş", "tarihe ilgi artmış
// mı", "bülten çıkarayım". İki veri noktasıyla bunların hiçbiri dürüstçe kurulamaz.
//
// Zaman derinliği normalde sadece takvimle birikir — ama Wikimedia'nın Pageviews API'si bu
// kuralın istisnası: ücretsiz, anahtarsız, 2015'e kadar geriye gidiyor. Yani geçmiş BEKLENMEDEN
// geri doldurulabiliyor. Canlı ölçüm (Kuruluş Osman, 2021-01 -> 2026-09):
//     ar 69 ay / 2.294.093 okunma      ru 69 ay / 1.120.426
//     tr 69 ay / 1.475.286             fa 35 ay /   324.148
//     es 69 ay /   218.541             ur 69 ay /    21.168
// Ayrıca TMDB'nin hiç göremediği diller sinyal veriyor: tg (Tacikçe), tk (Türkmence),
// crh (Kırım Tatarcası), ckb (Sorani) — tam da haritada boş kalan bölgeler.
//
// --- DÜRÜSTLÜK SINIRI (tasarımın merkezinde) ---------------------------------------------------
// Buradaki birim DİL'dir, ÜLKE DEĞİLDİR. Wikimedia makale bazında ülke kırılımı yayınlamıyor
// (gizlilik gerekçesiyle) ve biz uydurmuyoruz. "Arapça okunma" hangi Arap ülkesi sorusunu
// cevaplamaz. Ham katman dil bazında saklanır; ülke ataması istenirse ayrı bir türetme adımıdır
// ve arayüzde ayrıca "dil bazlı tahmin" olarak etiketlenir.
const PAGEVIEWS_BASE = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article'
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'

// Wikimedia kullanım şartları açık bir User-Agent istiyor; anonim istekler kısıtlanabiliyor.
const UA = 'gorunurluk-platformu/1.0 (kurumsal kultur analizi araci)'

// `agent=user` KRİTİK: bot ve tarayıcı-örümcek trafiğini dışarıda bırakır. `all-agents`
// kullanılsaydı sayılar şişerdi ve "ilgi" ölçüsü olmaktan çıkardı.
const ACCESS = 'all-access'
const AGENT = 'user'

// Wikidata sitelinks anahtarları dil sürümlerinde `<dil>wiki` biçiminde — ama aynı kalıba uyan
// dil-DIŞI projeler de var. Bunlar dil sinyali değildir, elenmeleri gerekir.
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

// Wikidata wbgetentities tek istekte en fazla 50 varlık kabul ediyor.
const WIKIDATA_BATCH = 50

// CANLI ÖLÇÜLDÜ: 4 eşzamanlı istekle 47 çiftin 38'i HTTP 429 ile düştü (tek tek atıldığında
// aynı istekler 200 dönüyordu) — yani sorun adreslerde değil, hızdaydı. Wikimedia anonim
// istemcilere belgelenenden çok daha dar bir pencere tanıyor. 2'ye indirildi ve altına geri
// çekilmeli yeniden deneme kondu; ikisi birlikte olmadan geri doldurma sessizce yarım kalıyor.
const ESZAMANLI = 2

// 429/503 için geri çekilme. Yanıt `Retry-After` verirse ona uyulur, vermezse artan bekleme.
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
    if (res.status === 404) return null // makale yok ya da hiç görüntülenmemiş — hata değil
    if (res.ok) return res.json()

    sonDurum = res.status
    if (res.status !== 429 && res.status !== 503) break // kalıcı hata — yeniden denemek anlamsız
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
  const sonuc = new Map() // qid -> [{ lang, title }]
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

// --- Depolama ---------------------------------------------------------------------------------
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
