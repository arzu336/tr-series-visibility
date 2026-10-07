import { cacheFirstSerpApi, serpapiGet, getSerpApiUsageThisMonth, refreshSerpApiAccountUsage } from './serpApiCache.js'
import { fetchNewsArticlesGdeltCached } from './gdeltNews.js'
import { flattenNewsResults } from './magazineNews.js'
import { languagesOfCountry } from '../../src/lib/langCountries.js'

// Basın taraması kaynağı (2026-10-07, kullanıcı kararı): Google Haberler (SerpApi google_news), ülke sürümünde
// (gl) ve ülkenin dilinde (hl). GDELT yabancı haberleri İngilizce çevirisinde aradığı ve bu IP'ye çoğu isteği
// geri çevirdiği için (saatte ~6 tarama) yalnızca yedek: SerpApi anahtarı yoksa, aylık kotanın basına ayrılan
// payı dolduysa ya da Google o ülke sürümünü desteklemiyorsa GDELT kullanılır.

export const GOOGLE_NEWS_SOURCE = 'google_news'
export const GDELT_SOURCE = 'gdelt'
const NEWS_TTL_MS = 14 * 24 * 60 * 60 * 1000
const MAX_ARTICLES = 40
const WINDOW_DAYS = 92 // GDELT'teki 3 aylık pencereyle aynı
// Aylık SerpApi kotasının en fazla bu kadarı basın taramasına gider; kalan pay arama ilgisi ve diğer işlere kalır.
export const NEWS_BUDGET_SHARE = 0.85

// Google'ın dil kodları wiki dil kodlarından birkaç yerde ayrılır.
const HL_ALIASES = { zh: 'zh-cn', he: 'iw', nb: 'no', jv: 'id' }

/** Ülkenin haber dili: tek ülkeye özgü dil önce, yoksa ilk iki harfli dil; bilinmiyorsa İngilizce. */
export function newsLanguageOf(iso2) {
  const langs = languagesOfCountry(iso2).filter((l) => /^[a-z]{2}$/.test(l.lang))
  const pick = langs.find((l) => !l.regional) ?? langs[0]
  const hl = pick?.lang ?? 'en'
  return HL_ALIASES[hl] ?? hl
}

/** Kota payı kontrolü; `usage` hesabın gerçek kullanımını içerir (bkz. getSerpApiUsageThisMonth). */
export function googleNewsAvailable(usage = getSerpApiUsageThisMonth()) {
  return Boolean(process.env.SERPAPI_API_KEY) && usage.used < usage.budget * NEWS_BUDGET_SHARE
}

const fold = (s) =>
  String(s || '')
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')

// Genel adların yanına eklenen "Türk" kelimesi, haberin dilinde (Google kelimeyi metnin tamamında arar).
const TURKISH_WORD = {
  en: 'Turkish',
  es: 'turca',
  pt: 'turca',
  it: 'turca',
  fr: 'turque',
  de: 'türkische',
  nl: 'Turkse',
  ru: 'турецкий',
  uk: 'турецький',
  bg: 'турски',
  sr: 'турска',
  mk: 'турска',
  hr: 'turska',
  bs: 'turska',
  sl: 'turška',
  ro: 'turcesc',
  hu: 'török',
  pl: 'turecki',
  cs: 'turecký',
  sk: 'turecký',
  el: 'τουρκική',
  sq: 'turk',
  ar: 'تركي',
  fa: 'ترکی',
  ur: 'ترک',
  az: 'türk',
  ka: 'თურქული',
  hy: 'թուրքական',
  kk: 'түрік',
  uz: 'turk',
  sv: 'turkisk',
  da: 'tyrkisk',
  no: 'tyrkisk',
  fi: 'turkkilainen',
  et: 'türgi',
  lt: 'turkų',
  lv: 'turku',
  iw: 'טורקית',
  hi: 'तुर्की',
  bn: 'তুর্কি',
  id: 'Turki',
  ms: 'Turki',
  vi: 'Thổ Nhĩ Kỳ',
  th: 'ตุรกี',
  ja: 'トルコ',
  ko: '터키',
  'zh-cn': '土耳其',
  sw: 'Kituruki',
}
const MIN_DISTINCT_LENGTH = 5 // "Ezel", "Aile", "Gupi" gibi kısa adlar da tek başına genel sayılır

export function turkishWordOf(hl) {
  return TURKISH_WORD[hl] ?? 'Turkish'
}

const quote = (p) => `"${p.replace(/"/g, '')}"`

/**
 * Google Haberler sorgusu. Dizinin Türkçe adı (ve Türkçe harfsiz yazımı) tek başına ayırt edicidir. Yerel ad
 * ("Una nueva vida", "Te conozco") ve kısa adlar genel ifadeler olabildiği için haberin dilindeki "Türk"
 * kelimesiyle birlikte aranır. İngilizce uluslararası ad yalnızca İngilizce sürümde aranır (diğer dillerde
 * yerel ad zaten o ülkedeki karşılığıdır). 2026-10-07 canlı deneme: "Una nueva vida" bağlamsız 40 alakasız haber.
 */
export function buildGoogleNewsQuery({ phrases, englishTitles = [], turkishNames = [], hl }) {
  const en = new Set(englishTitles)
  const tr = new Set(turkishNames)
  const kelime = turkishWordOf(hl)
  const parts = []
  for (const p of phrases) {
    if (en.has(p) && hl !== 'en') continue
    const ayirtEdici = tr.has(p) && p.length >= MIN_DISTINCT_LENGTH
    parts.push(ayirtEdici ? quote(p) : `(${quote(p)} ${kelime})`)
  }
  return [...new Set(parts)].join(' OR ')
}

/**
 * Sonuçları ortak biçime indirir ({ title, source, date, url, snippet, language }) ve süzer: başlıkta dizinin
 * adlarından biri geçmeli, haber son WINDOW_DAYS gün içinde olmalı. Haber metni alınmaz (snippet: null).
 */
export function normalizeGoogleNews(newsResults, { phrases, hl, now = Date.now() }) {
  const names = phrases.map(fold).filter((p) => p.length >= 3)
  const since = now - WINDOW_DAYS * 86400000
  const seen = new Set()
  const out = []
  for (const r of flattenNewsResults(newsResults)) {
    if (seen.has(r.link)) continue
    seen.add(r.link)
    const t = fold(r.title)
    if (!names.some((n) => t.includes(n))) continue
    const ms = r.iso_date ? Date.parse(r.iso_date) : NaN
    if (Number.isFinite(ms) && ms < since) continue
    out.push({
      title: r.title,
      source: r.source?.name ?? null,
      date: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
      url: r.link,
      snippet: null,
      language: hl,
    })
    if (out.length >= MAX_ARTICLES) break
  }
  return out
}

const NO_RESULTS = /hasn't returned any results/i

export function googleNewsCacheKey(phrases, iso2) {
  return `serp:gnews:v2:${phrases.map(fold).join(' | ')}::${String(iso2).toUpperCase()}`
}

async function fetchGoogleNews({ phrases, englishTitles, turkishNames, iso2 }, get = serpapiGet) {
  const hl = newsLanguageOf(iso2)
  const q = buildGoogleNewsQuery({ phrases, englishTitles, turkishNames, hl })
  let data
  try {
    data = await get({ engine: 'google_news', q, gl: iso2.toLowerCase(), hl })
  } catch (err) {
    // SerpApi sonuçsuz aramayı hata olarak döndürüyor; bu "haber yok" demektir, arıza değil (önceden GDELT'e
    // düşülüyordu ve her sonuçsuz çift dakikalar harcıyordu).
    if (NO_RESULTS.test(err.message)) return { unsupported: false, news: [], hl }
    throw err
  }
  return { unsupported: false, news: normalizeGoogleNews(data.news_results, { phrases, hl }), hl }
}

/**
 * Bir ülke × dizi için basın haberleri: önce Google Haberler (14 gün önbellek), olmazsa GDELT.
 * Dönüş: { unsupported, news, source }.
 */
export async function fetchPressArticles(
  { phrases, englishTitles = [], turkishNames = phrases.slice(0, 2), iso2, priority, context },
  {
    get = serpapiGet,
    gdelt = fetchNewsArticlesGdeltCached,
    available = googleNewsAvailable,
    refreshUsage = refreshSerpApiAccountUsage,
  } = {}
) {
  // Karar hesabın gerçek kullanımına göre verilir (10 dk'da bir tazelenir; kendi sayacımız eksik sayıyor).
  await refreshUsage().catch(() => null)
  if (available()) {
    try {
      const sonuc = await cacheFirstSerpApi(googleNewsCacheKey(phrases, iso2), NEWS_TTL_MS, () =>
        fetchGoogleNews({ phrases, englishTitles, turkishNames, iso2 }, get)
      )
      return { ...sonuc, source: GOOGLE_NEWS_SOURCE }
    } catch (err) {
      // Kota, desteklenmeyen ülke sürümü ya da geçici hata: tarama GDELT ile sürer.
      console.error(`[googleNews] ${iso2} Google Haberler alınamadı (${err.message}); GDELT'e geçiliyor.`)
    }
  }
  const sonuc = await gdelt(phrases, iso2, { priority, context })
  return { ...sonuc, source: GDELT_SOURCE }
}
