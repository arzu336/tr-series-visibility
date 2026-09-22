import db from '../db.js'
import { getCached } from '../cache.js'
import { getExternalIds } from '../tmdb.js'
import {
  fetchSitelinks,
  fetchMonthlyPageviews,
  saveArticles,
  saveMonthlyViews,
  havuzdaCalistir,
} from './wikipediaPageviews.js'

// Wikipedia Pageviews API'si 2015-07'den itibaren veri veriyor; öncesi için boş döner.
const EN_ERKEN = new Date(Date.UTC(2015, 6, 1))

const sayArticlesStmt = db.prepare('SELECT COUNT(*) n FROM series_wiki_articles WHERE tmdb_id = ?')
const sayViewsStmt = db.prepare('SELECT COUNT(*) n FROM series_language_interest WHERE tmdb_id = ? AND lang = ?')

/**
 * 1. aşama — dizileri Wikidata kimliğine, oradan dil başına makale başlığına bağlar.
 * Zaten çözülmüş diziler atlanır (yeniden çalıştırmak ucuz ve güvenli).
 */
export async function resolveArticles({ force = false, limit } = {}) {
  const raw = getCached('raw-series-providers')
  let seri = raw?.series || []
  if (!seri.length) throw new Error('raw-series-providers önbelleği boş — önce veri hattını çalıştır')
  if (!force) seri = seri.filter((s) => sayArticlesStmt.get(s.id).n === 0)
  if (limit) seri = seri.slice(0, limit)
  if (!seri.length) return { cozulen: 0, wikidatasiz: 0, makale: 0, atlanan: 0 }

  // TMDB external_ids: dizi başına 1 istek. TMDB'nin aylık bütçe sayacı yok (bkz. scheduler.js
  // yorumu) — SerpAPI kotasına dokunmaz.
  const kimlikler = await havuzdaCalistir(seri, async (s) => {
    const { wikidataId } = await getExternalIds(s.id)
    return { tmdbId: s.id, ad: s.name, wikidataId }
  })

  const wikidatali = kimlikler.filter((k) => k && !k.hata && k.wikidataId)
  const wikidatasiz = kimlikler.length - wikidatali.length

  const sitelinks = await fetchSitelinks(wikidatali.map((k) => k.wikidataId))

  let makale = 0
  for (const k of wikidatali) {
    const satirlar = sitelinks.get(k.wikidataId) || []
    if (satirlar.length) {
      saveArticles(k.tmdbId, k.wikidataId, satirlar)
      makale += satirlar.length
    }
  }

  return { cozulen: wikidatali.length, wikidatasiz, makale }
}

/**
 * 2. aşama — her (dizi, dil) için aylık okunma serisini çeker.
 * Makalesi olmayan dil yoktur (1. aşamadan gelir); okunması olmayan makale BOŞ döner ve
 * hiçbir satır yazılmaz — "veri yok" ile "sıfır ilgi" ayrı tutulur.
 */
export async function backfillPageviews({ force = false, limit, onProgress } = {}) {
  let hedefler = db.prepare('SELECT tmdb_id, lang, title FROM series_wiki_articles').all()
  if (!force) hedefler = hedefler.filter((h) => sayViewsStmt.get(h.tmdb_id, h.lang).n === 0)
  if (limit) hedefler = hedefler.slice(0, limit)

  const bitis = new Date()
  let yazilanSatir = 0
  let veriliCift = 0
  let bosCift = 0
  let hatali = 0
  let islenen = 0
  // Hataları sessizce saymak yetmiyor: ilk denemede 45 çiftin 36'sı düştü ve sebebi ancak
  // mesajlar görülünce anlaşıldı. Örnek tutuluyor ki bir daha kör kalınmasın.
  const hataOrnekleri = []

  await havuzdaCalistir(hedefler, async (h) => {
    try {
      const satirlar = await fetchMonthlyPageviews(h.lang, h.title, EN_ERKEN, bitis)
      if (satirlar.length) {
        saveMonthlyViews(h.tmdb_id, h.lang, satirlar)
        yazilanSatir += satirlar.length
        veriliCift++
      } else {
        bosCift++
      }
    } catch (err) {
      hatali++
      if (hataOrnekleri.length < 5) hataOrnekleri.push(`${h.lang}/${h.title}: ${err.message}`)
    }
    islenen++
    if (onProgress && islenen % 100 === 0) onProgress(islenen, hedefler.length)
  })

  return { cift: hedefler.length, veriliCift, bosCift, hatali, yazilanSatir, hataOrnekleri }
}
