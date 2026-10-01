import { cacheFirstSerpApi, serpapiGet } from './serpApiCache.js'

// Dizi ayrıntısındaki "Magazin" bölümü: dizi ve başrol oyuncuları hakkında güncel haber başlıkları
// (SerpApi Google News motoru). Yanlış haber riskini azaltan üç kural:
//   1. Yalnızca izinli ulusal yayın kuruluşları (TRUSTED_NEWS_DOMAINS, kullanıcı onayıyla).
//   2. Başlıkta dizinin ya da oyuncunun TAM adı geçmeli; kısa/yaygın dizi adlarında ayrıca "dizi"
//      kelimesi ya da bir oyuncu adı aranır ("Kulüp", "Terim" gibi adlar başka haberlere karışmasın).
//   3. Haber değiştirilmeden gösterilir: başlık, kaynak, tarih ve haberin kendi sitesine bağlantı.
//      Özet ya da yeniden yazım yok — iddia platformun değil, haberi yayımlayan kuruluşundur.
//   4. Yayın rehberi / arama motoru içerikleri ("full izle", "saat kaçta", "kimdir, kaç yaşında") ve
//      hukuki süreç haberleri (gözaltı, soruşturma, dava…) gösterilmez: ilki magazin değil, ikincisi
//      gerçek kişiler hakkında kesinleşmemiş iddia — resmî bir platformda itibar riski (kullanıcı kararı).
// Maliyet: dizi başına 2 arama (dizi adı + başrol oyuncuları), 2 gün önbellek; yalnızca dizi
// ayrıntısı açıldığında çağrılır. Aylık bütçe ve kullanıcı kotası serpapiGet içinde uygulanır.

export const MAGAZINE_TTL_MS = 2 * 24 * 60 * 60 * 1000
export const MAX_ITEMS = 10 // dizi sayfasında gösterilen sayı; dizi/oyuncu dengesi bu sayı üzerinden kurulur
export const LEAD_CAST_COUNT = 3

export const TRUSTED_NEWS_DOMAINS = [
  'hurriyet.com.tr',
  'milliyet.com.tr',
  'sabah.com.tr',
  'haberturk.com',
  'sozcu.com.tr',
  'cnnturk.com',
  'ntv.com.tr',
]

const SOURCE_NAMES = {
  'hurriyet.com.tr': 'Hürriyet',
  'milliyet.com.tr': 'Milliyet',
  'sabah.com.tr': 'Sabah',
  'haberturk.com': 'Habertürk',
  'sozcu.com.tr': 'Sözcü',
  'cnnturk.com': 'CNN Türk',
  'ntv.com.tr': 'NTV',
}

/** Önbellekte HAM sonuçlar tutulur (süzgeç değişince yeni arama gerekmez); sürüm, ham biçim değişirse artar. */
export function magazineCacheKey(seriesId) {
  return `serp:magazine:v2:${seriesId}`
}

const TR_FOLD = { ç: 'c', ğ: 'g', ı: 'i', i̇: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' }

/** Karşılaştırma için sadeleştirme: Türkçe küçük harf, aksan katlama, noktalama → boşluk. */
export function normalizeText(text) {
  return String(text || '')
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]|i̇/g, (ch) => TR_FOLD[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function containsPhrase(haystackNorm, phrase) {
  const p = normalizeText(phrase)
  return p.length > 0 && ` ${haystackNorm} `.includes(` ${p} `)
}

/** Haberin bağlantısı izinli bir yayın kuruluşuna mı ait (alt alan adları dahil). */
export function isTrustedSource(link, domains = TRUSTED_NEWS_DOMAINS) {
  let host
  try {
    host = new URL(link).hostname.toLowerCase()
  } catch {
    return false
  }
  return domains.some((d) => host === d || host.endsWith(`.${d}`))
}

// normalizeText sonrası (küçük harf, aksansız) başlıkta aranır; kelime başından eşleşir.
const GUIDE_RE =
  /(^| )(izle|izleme|canli|full|tek parca|saat kacta|var mi|yayin akisi|tv rehberi|fragman\w*|reyting\w*|kimdir|kac yasinda|\d+ bolum\w*)( |$)/
const LEGAL_RE =
  /(^| )(gozalti\w*|tutuklan\w*|tutuklama\w*|sorusturma\w*|uyusturucu\w*|operasyon\w*|dava\w*|mahkeme\w*|savcilik\w*|ifade\w*|hapis\w*|saliverildi|cikis yasag\w*|sucla\w*|iddianame\w*)( |$)/

/** Başlık yayın rehberi / SEO içeriği ya da hukuki süreç haberi mi (gösterilmez). */
export function excludedReason(title) {
  const t = normalizeText(title)
  if (LEGAL_RE.test(t)) return 'hukuki'
  if (GUIDE_RE.test(t)) return 'rehber'
  return null
}

/** Kısa ya da tek kelimelik dizi adları başka haberlerle karışabilir; bunlarda ek kanıt aranır. */
export function isAmbiguousTitle(seriesName) {
  const n = normalizeText(seriesName)
  return n.split(' ').length === 1 && n.length < 8
}

/** Oyuncu adı yalnızca en az iki kelimeyse (ad + soyad) eşleştirmede kullanılır. */
export function leadCastNames(cast = [], count = LEAD_CAST_COUNT) {
  return cast
    .map((c) => c?.name)
    .filter((n) => typeof n === 'string' && normalizeText(n).split(' ').length >= 2)
    .slice(0, count)
}

/**
 * Başlık diziyle ilgili mi? Dönüş: { about: 'dizi' | <oyuncu adı> } ya da null.
 * Dizi adı geçiyorsa ve ad belirsiz değilse → dizi. Belirsiz adda "dizi" kelimesi ya da oyuncu adı
 * da geçmeli. Dizi adı geçmiyorsa başlıkta bir başrol oyuncusunun tam adı aranır.
 */
export function relevanceOf(title, seriesName, castNames) {
  const t = normalizeText(title)
  const actor = castNames.find((n) => containsPhrase(t, n)) ?? null
  if (containsPhrase(t, seriesName)) {
    if (!isAmbiguousTitle(seriesName)) return { about: 'dizi' }
    if (/\bdizi/.test(t) || actor) return { about: 'dizi' }
  }
  return actor ? { about: actor } : null
}

/** SerpApi Google News tarih alanı → ISO. "10/01/2026, 07:12 AM, +0000 UTC" biçimi ya da iso_date. */
export function parseNewsDate(item) {
  if (item?.iso_date) {
    const d = new Date(item.iso_date)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  const m = /^(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(item?.date || '')
  if (!m) return null
  let hour = Number(m[4]) % 12
  if (m[6].toUpperCase() === 'PM') hour += 12
  return new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5]))).toISOString()
}

/** news_results içindeki öğeleri, öne çıkan habere ve küme (stories) içindekilere açarak düzleştirir. */
export function flattenNewsResults(newsResults = []) {
  const out = []
  for (const r of newsResults) {
    if (r?.link && r?.title) out.push(r)
    if (r?.highlight?.link && r?.highlight?.title) out.push(r.highlight)
    for (const s of r?.stories || []) if (s?.link && s?.title) out.push(s)
  }
  return out
}

function sourceNameOf(link, fallback) {
  try {
    const host = new URL(link).hostname.toLowerCase()
    const domain = TRUSTED_NEWS_DOMAINS.find((d) => host === d || host.endsWith(`.${d}`))
    if (domain) return SOURCE_NAMES[domain]
  } catch {
    // geçersiz bağlantı zaten isTrustedSource'ta elenir
  }
  return fallback || null
}

/**
 * Ham sonuçları süzer, tekilleştirir ve seçer. Dizi haberleri (bölüm, olay örgüsü) çok sık yayımlandığı
 * için yalnızca tarihe göre sıralamak oyuncu haberlerini dışarıda bırakıyordu: dizi haberleri listenin en
 * çok yarısını (aşağı yuvarlanmış) alır, kalan yer oyuncu haberleriyle dolar (bir taraf yetmezse diğeri tamamlar).
 */
export function buildMagazineItems(rawItems, seriesName, castNames, { limit = MAX_ITEMS } = {}) {
  const seen = new Set()
  const items = []
  for (const r of rawItems) {
    if (!isTrustedSource(r.link)) continue
    if (excludedReason(r.title)) continue
    const rel = relevanceOf(r.title, seriesName, castNames)
    if (!rel) continue
    const key = normalizeText(r.title)
    if (seen.has(r.link) || seen.has(key)) continue
    seen.add(r.link)
    seen.add(key)
    items.push({
      title: r.title,
      source: sourceNameOf(r.link, r.source?.name),
      link: r.link,
      date: parseNewsDate(r),
      thumbnail: typeof r.thumbnail === 'string' ? r.thumbnail : null,
      about: rel.about,
    })
  }
  const byDate = (a, b) => (b.date || '').localeCompare(a.date || '')
  const dizi = items.filter((i) => i.about === 'dizi').sort(byDate)
  const oyuncu = items.filter((i) => i.about !== 'dizi').sort(byDate)
  const diziPay = Math.min(dizi.length, Math.max(Math.floor(limit / 2), limit - oyuncu.length))
  return [...dizi.slice(0, diziPay), ...oyuncu.slice(0, limit - diziPay)].sort(byDate)
}

/** Önbelleğe yazılacak en küçük ham alanlar (SerpApi yanıtının tamamı değil). */
function compactRaw(r) {
  return {
    title: r.title,
    link: r.link,
    date: r.date ?? null,
    iso_date: r.iso_date ?? null,
    thumbnail: typeof r.thumbnail === 'string' ? r.thumbnail : null,
    source: r.source?.name ? { name: r.source.name } : null,
  }
}

/** İki arama (dizi adı + başrol oyuncuları); biri başarısız olursa diğeriyle devam eder. Ham sonuç döner. */
export async function fetchMagazineNewsRaw(series, get = serpapiGet) {
  const castNames = leadCastNames(series.cast)
  const queries = [`"${series.name}"`]
  if (castNames.length) queries.push(castNames.map((n) => `"${n}"`).join(' OR '))
  const results = await Promise.allSettled(queries.map((q) => get({ engine: 'google_news', q, hl: 'tr', gl: 'tr' })))
  const ok = results.filter((r) => r.status === 'fulfilled')
  if (!ok.length) throw results[0].reason
  return {
    seriesId: series.id,
    raw: ok.flatMap((r) => flattenNewsResults(r.value?.news_results)).map(compactRaw),
    fetchedAt: new Date().toISOString(),
  }
}

/** Önbellekteki ham sonuçlara güncel süzgeç uygulanır; yanıtta yalnızca seçilmiş haberler döner. */
export async function getMagazineNews(series) {
  const cached = await cacheFirstSerpApi(magazineCacheKey(series.id), MAGAZINE_TTL_MS, () =>
    fetchMagazineNewsRaw(series)
  )
  const { raw = [], ...meta } = cached
  return { ...meta, items: buildMagazineItems(raw, series.name, leadCastNames(series.cast)) }
}
