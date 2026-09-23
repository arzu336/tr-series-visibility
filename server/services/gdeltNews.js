import { fetch as undiciFetch, Agent } from 'undici'
import { getCached, setCached } from '../cache.js'

const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc'

const REQUEST_TIMEOUT_MS = 90000

const gdeltAgent = new Agent({
  connect: { timeout: 30000 },
  headersTimeout: REQUEST_TIMEOUT_MS,
  bodyTimeout: REQUEST_TIMEOUT_MS,
})
const MIN_GAP_MS = 20000
const MAX_ATTEMPTS = 3
const BACKOFF_MS = [30000, 60000]

const NEWS_TTL_MS = 14 * 24 * 60 * 60 * 1000
const MAX_ARTICLES = 40
const TIMESPAN = '3m'

/**
 * Önbellek anahtarları `gdelt:news:*` ad alanında ayrıldı: SerpAPI döneminden kalan `serp:*`
 * kayıtlarıyla asla çakışmaz. Sağlayıcı değiştiğinde eski kayıtlar okunmaz ve yeni şemadaki
 * veriymiş gibi davranmaz — kendi hâllerinde süreleri dolana kadar dururlar.
 */
export function gdeltNewsCacheKey(query, iso2) {
  return `gdelt:news:${String(query).trim().toLocaleLowerCase('tr')}::${String(iso2).toUpperCase()}`
}

let kuyruk = Promise.resolve()
let sonIstekZamani = 0

function sirayaAl(fn) {
  const sonuc = kuyruk.then(async () => {
    const gecen = Date.now() - sonIstekZamani
    if (gecen < MIN_GAP_MS) await new Promise((r) => setTimeout(r, MIN_GAP_MS - gecen))
    try {
      return await fn()
    } finally {
      sonIstekZamani = Date.now()
    }
  })
  kuyruk = sonuc.then(
    () => {},
    () => {}
  )
  return sonuc
}

async function gdeltGet(query) {
  const url = new URL(GDELT_URL)
  url.searchParams.set('query', query)
  url.searchParams.set('mode', 'artlist')
  url.searchParams.set('format', 'json')
  url.searchParams.set('maxrecords', String(MAX_ARTICLES))
  url.searchParams.set('timespan', TIMESPAN)
  url.searchParams.set('sort', 'datedesc')

  let sonHata
  for (let deneme = 0; deneme < MAX_ATTEMPTS; deneme++) {
    try {
      const res = await sirayaAl(() =>
        undiciFetch(url, {
          dispatcher: gdeltAgent,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { 'User-Agent': 'gorunurluk-platformu/1.0 (kurumsal analiz araci)' },
        })
      )
      const text = await res.text()
      if (text.trim().startsWith('{')) {
        return JSON.parse(text)
      }
      sonHata = new Error(`GDELT hız sınırı veya beklenmeyen yanıt (${res.status})`)
    } catch (err) {
      sonHata = err
    }
    if (deneme < BACKOFF_MS.length) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[deneme]))
    }
  }
  throw sonHata || new Error('GDELT isteği başarısız')
}

export const ISO2_TO_FIPS = {
  AD: 'AN', AE: 'AE', AF: 'AF', AG: 'AC', AL: 'AL', AM: 'AM', AO: 'AO', AR: 'AR', AT: 'AU',
  AU: 'AS', AZ: 'AJ', BA: 'BK', BB: 'BB', BD: 'BG', BE: 'BE', BF: 'UV', BG: 'BU', BH: 'BA',
  BI: 'BY', BJ: 'BN', BN: 'BX', BO: 'BL', BR: 'BR', BS: 'BF', BT: 'BT', BW: 'BC', BY: 'BO',
  BZ: 'BH', CA: 'CA', CD: 'CG', CF: 'CT', CG: 'CF', CH: 'SZ', CI: 'IV', CL: 'CI', CM: 'CM',
  CN: 'CH', CO: 'CO', CR: 'CS', CU: 'CU', CV: 'CV', CY: 'CY', CZ: 'EZ', DE: 'GM', DJ: 'DJ',
  DK: 'DA', DO: 'DR', DZ: 'AG', EC: 'EC', EE: 'EN', EG: 'EG', ER: 'ER', ES: 'SP', ET: 'ET',
  FI: 'FI', FJ: 'FJ', FR: 'FR', GA: 'GB', GB: 'UK', GE: 'GG', GH: 'GH', GL: 'GL', GM: 'GA',
  GN: 'GV', GQ: 'EK', GR: 'GR', GT: 'GT', GW: 'PU', GY: 'GY', HN: 'HO', HR: 'HR', HT: 'HA',
  HU: 'HU', ID: 'ID', IE: 'EI', IL: 'IS', IN: 'IN', IQ: 'IZ', IR: 'IR', IS: 'IC', IT: 'IT',
  JM: 'JM', JO: 'JO', JP: 'JA', KE: 'KE', KG: 'KG', KH: 'CB', KM: 'CN', KP: 'KN', KR: 'KS',
  KW: 'KU', KZ: 'KZ', LA: 'LA', LB: 'LE', LK: 'CE', LR: 'LI', LS: 'LT', LT: 'LH', LU: 'LU',
  LV: 'LG', LY: 'LY', MA: 'MO', MD: 'MD', ME: 'MJ', MG: 'MA', MK: 'MK', ML: 'ML', MM: 'BM',
  MN: 'MG', MR: 'MR', MT: 'MT', MU: 'MP', MV: 'MV', MW: 'MI', MX: 'MX', MY: 'MY', MZ: 'MZ',
  NA: 'WA', NE: 'NG', NG: 'NI', NI: 'NU', NL: 'NL', NO: 'NO', NP: 'NP', NZ: 'NZ', OM: 'MU',
  PA: 'PM', PE: 'PE', PG: 'PP', PH: 'RP', PK: 'PK', PL: 'PL', PR: 'RQ', PT: 'PO', PY: 'PA',
  QA: 'QA', RO: 'RO', RS: 'RI', RU: 'RS', RW: 'RW', SA: 'SA', SD: 'SU', SE: 'SW', SG: 'SN',
  SI: 'SI', SK: 'LO', SL: 'SL', SN: 'SG', SO: 'SO', SR: 'NS', SS: 'OD', SV: 'ES', SY: 'SY',
  SZ: 'WZ', TD: 'CD', TG: 'TO', TH: 'TH', TJ: 'TI', TM: 'TX', TN: 'TS', TR: 'TU', TT: 'TD',
  TW: 'TW', TZ: 'TZ', UA: 'UP', UG: 'UG', US: 'US', UY: 'UY', UZ: 'UZ', VE: 'VE', VN: 'VM',
  XK: 'KV', YE: 'YM', ZA: 'SF', ZM: 'ZA', ZW: 'ZI',
  BM: 'BD', GF: 'FG', GG: 'GK', GI: 'GI', HK: 'HK', LC: 'ST', LI: 'LS', MC: 'MN', PF: 'FP',
  SC: 'SE', SM: 'SM', TC: 'TK', VA: 'VT',
}

/**
 * Bu ülke için basın taraması yapılabilir mi? FIPS kodu bilinmiyorsa GDELT'e ülke filtresi
 * gönderilemez; filtresiz sorgu küresel gelir ve ad doğrulamasından hiçbir şey geçmez. Böyle bir
 * durumu "haber yok" gibi kaydetmek yanlış olur — çağıran taraf bunu ayrı ele almalı.
 */
export function isGdeltSupportedCountry(iso2) {
  return Boolean(ISO2_TO_FIPS[String(iso2).toUpperCase()])
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

function normalizeAd(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '')
}

const GDELT_AD_ISTISNALARI = {
  TR: ['Turkey'],
  SK: ['Slovak Republic'],
  MK: ['Macedonia'],
  GB: ['UK'],
  US: ['United States of America', 'USA'],
  RU: ['Russian Federation'],
  KR: ['Korea, South', 'South Korea'],
  KP: ['Korea, North', 'North Korea'],
  CZ: ['Czech Republic'],
  MM: ['Burma'],
  AE: ['UAE'],
  CD: ['Congo, Democratic Republic of the', 'Congo Kinshasa'],
  CG: ['Congo, Republic of the', 'Congo Brazzaville'],
  LA: ['Laos'],
  SY: ['Syria'],
  VN: ['Vietnam'],
  IR: ['Iran'],
  MD: ['Moldova'],
  TZ: ['Tanzania'],
  VE: ['Venezuela'],
  BO: ['Bolivia'],
  CI: ['Cote dIvoire', "Cote d'Ivoire", 'Ivory Coast'],
  CV: ['Cape Verde'],
  TL: ['East Timor', 'Timor-Leste'],
  SZ: ['Swaziland', 'Eswatini'],
}

/**
 * Bir ISO2 için GDELT yanıtında kabul edilebilir ülke adlarının normalize kümesi.
 * Boş küme dönerse (tanınmayan kod) doğrulama yapılamaz demektir.
 */
function kabulEdilenAdlar(iso2) {
  const kod = String(iso2).toUpperCase()
  const kume = new Set()
  try {
    const intlAdi = regionNames.of(kod)
    if (intlAdi && intlAdi !== kod) kume.add(normalizeAd(intlAdi))
  } catch {
  }
  for (const ad of GDELT_AD_ISTISNALARI[kod] || []) kume.add(normalizeAd(ad))
  return kume
}

function ulkeEslesiyorMu(sourcecountry, kabulKumesi) {
  if (!sourcecountry || kabulKumesi.size === 0) return false
  return kabulKumesi.has(normalizeAd(sourcecountry))
}

/** GDELT'in `20260907T203000Z` biçimini ISO 8601'e çevirir; tanınmazsa ham değeri döner. */
export function seendateToIso(seendate) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(seendate || ''))
  if (!m) return seendate || null
  const [, yil, ay, gun, saat, dk, sn] = m
  return `${yil}-${ay}-${gun}T${saat}:${dk}:${sn}Z`
}

/** Ham GDELT makale listesini uygulamanın ortak biçimine çevirir (test edilebilir olsun diye ayrı). */
export function normalizeGdeltArticles(articles, iso2) {
  const kabul = kabulEdilenAdlar(iso2)
  const hepsi = articles || []
  const suzulmus = hepsi.filter((a) => ulkeEslesiyorMu(a.sourcecountry, kabul))

  if (hepsi.length > 0 && suzulmus.length === 0) {
    const gorulen = [...new Set(hepsi.map((a) => a.sourcecountry).filter(Boolean))].slice(0, 5)
    console.warn(
      `[gdelt] ${iso2} için ${hepsi.length} makale döndü ama hiçbiri bu ülkeyle eşleşmedi — atlanıyor. ` +
        `Yanıttaki ülkeler: ${gorulen.join(', ') || '(boş)'}. Beklenen: ${[...kabul].join(' / ') || '(kod tanınmadı)'}`
    )
  }

  return suzulmus.slice(0, MAX_ARTICLES).map((a) => ({
    title: a.title || '',
    source: a.domain || null,
    date: seendateToIso(a.seendate),
    url: a.url || null,
    snippet: null,
    language: a.language || null,
  }))
}

/**
 * fetchNewsArticlesRaw (SerpAPI google_news) ile AYNI dizi biçimini döner:
 *   [{ title, source, date, url, snippet, language }]
 * `source` olarak yayının alan adı (domain) kullanılıyor — başlık ve alan adı, analize giren iki
 * gerçek alan.
 */
export async function fetchNewsArticlesGdelt(query, countryIso2) {
  const iso2 = String(countryIso2).toUpperCase()
  const fips = ISO2_TO_FIPS[iso2]

  if (!fips) {
    return { unsupported: true, news: [] }
  }

  const data = await gdeltGet(`"${String(query).trim()}" sourcecountry:${fips}`)
  return { unsupported: false, news: normalizeGdeltArticles(data.articles, iso2) }
}

/** 14 günlük önbellek katmanı — `gdelt:news:*` ad alanında (bkz. gdeltNewsCacheKey). */
export async function fetchNewsArticlesGdeltCached(query, countryIso2) {
  const key = gdeltNewsCacheKey(query, countryIso2)
  const cached = getCached(key)
  if (cached) return Array.isArray(cached) ? { unsupported: false, news: cached } : cached

  const sonuc = await fetchNewsArticlesGdelt(query, countryIso2)
  if (!sonuc.unsupported) setCached(key, sonuc, NEWS_TTL_MS)
  return sonuc
}
