import { fetch as undiciFetch, Agent } from 'undici'
import { getCached, setCached } from '../cache.js'

// Denetim raporu D.6: haber taraması SerpAPI'nin `google_news` motorundan GDELT DOC 2.0'a
// taşındı. Gerekçe rapordan: bu tek kalem aylık ~1.875 ücretli SerpAPI çağrısıydı; GDELT
// ücretsiz ve anahtarsız. Karşılığında iki GERÇEK ödün var, ikisi de aşağıda açıkça ele alınıyor:
//   1) GDELT makale ÖZETİ (snippet) DÖNDÜRMEZ — canlı yanıtla doğrulandı, dönen alanlar yalnızca
//      url / url_mobile / title / seendate / socialimage / domain / language / sourcecountry.
//      Duygu analizi bu yüzden başlık + yayının alan adı üzerinden çalışır (llm.js zaten
//      snippet'i opsiyonel tutuyordu, kod kırılmıyor — ama analizin girdisi daha zayıf; bu
//      bilinçli bir takas, gizlenmemeli).
//   2) GDELT'in genel ucu AGRESİF hız sınırlıdır. Belgesi "one every 5 seconds" diyor; canlı
//      ölçümde 15 sn aralıkta bile 429 alındı ve arada bağlantı tamamen reddedildi, başarılı
//      yanıtlar 11-21 sn sürdü. Bu yüzden aşağıda tek-uçuşlu global kuyruk + geri çekilmeli
//      yeniden deneme var; çağıran taraf hatayı "haber yok" değil, "şimdilik tazeleyemedik"
//      olarak ele almalıdır.
const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc'

// Ölçülen ilk-bayt süreleri 11-21 sn — projedeki 15 sn'lik genel dış servis zaman aşımı
// (denetim B-12) buraya YETMEZ, bu yüzden bilinçli olarak daha yüksek tutuldu.
const REQUEST_TIMEOUT_MS = 90000

// CANLI OLARAK TEŞHİS EDİLDİ — bu blok olmadan entegrasyon HİÇ çalışmıyor:
// GDELT'in TLS el sıkışması bu ağdan 9,5-10,2 saniye sürüyor (curl ile üç ölçüm: tls=9.47s,
// 10.17s, 10.23s). Node'un YERLEŞİK fetch'i undici'nin varsayılan 10 sn'lik `connect` zaman
// aşımını kullanıyor; el sıkışma tam o sınırda olduğu için istekler daha başlamadan
// `UND_ERR_CONNECT_TIMEOUT` ile düşüyordu (curl aynı adrese sorunsuz ulaşırken).
// Node'un global fetch'ine harici bir dispatcher geçirilemiyor (`UND_ERR_INVALID_ARG` —
// yerleşik undici ile paket sürümü aynı sınıfı paylaşmıyor), bu yüzden undici'nin KENDİ
// fetch'i kullanılıyor. undici zaten doğrudan bir bağımlılık (package.json), yeni paket yok.
const gdeltAgent = new Agent({
  connect: { timeout: 30000 },
  headersTimeout: REQUEST_TIMEOUT_MS,
  bodyTimeout: REQUEST_TIMEOUT_MS,
})
// Ardışık iki GDELT isteği arasındaki en az bekleme (belgelenen sınır 5 sn, ölçümde yetmedi).
const MIN_GAP_MS = 20000
const MAX_ATTEMPTS = 3
const BACKOFF_MS = [30000, 60000]

// newsSentiment.js'teki NEWS_SENTIMENT_TTL_MS ile aynı ritim.
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

// --- Hız sınırı: tek uçuşlu global kuyruk -----------------------------------------------------
// GDELT'i paralel çağırmak garanti 429 demek. Tüm istekler bu zincirden geçer: eşzamanlı 10 ülke
// talebi gelse bile dışarıya sırayla ve aralıklı çıkar.
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
  // Kuyruk tek bir hatayla kopmamalı — sıradaki iş yine çalışsın.
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
      // GDELT hız sınırını JSON ile DEĞİL düz metinle bildiriyor ("Please limit requests to one
      // every 5 seconds...") ve bunu 200 durum koduyla da dönebiliyor — yani duruma güvenilemez,
      // gövdenin gerçekten JSON olup olmadığına bakmak gerekiyor (canlı doğrulandı).
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

// --- Ülke eşlemesi ----------------------------------------------------------------------------
// GDELT'in `sourcecountry:` operatörü ISO-3166 DEĞİL, FIPS 10-4 kodu bekler (Almanya "GM",
// Rusya "RS", Türkiye "TU"; bazı ülkelerde ISO2 ile aynı, bazılarında değil). Elle tutulan böyle
// bir tablo sessizce YANLIŞ ülkeye kayabilir, bu yüzden tek başına ona güvenilmiyor: yanıttaki
// `sourcecountry` alanı (tam İngilizce ülke adı — canlı doğrulandı) beklenen ülke adıyla
// karşılaştırılıyor ve tutmayan makaleler ATILIYOR. Kod yanlışsa sonuç boş kalır; BAŞKA bir
// ülkenin haberleri asla bu ülkenin basın algısı olarak kaydedilmez.
const ISO2_TO_FIPS = {
  AE: 'AE', AR: 'AR', AT: 'AU', AU: 'AS', AZ: 'AJ', BA: 'BK', BE: 'BE', BG: 'BU', BR: 'BR',
  CA: 'CA', CH: 'SZ', CL: 'CI', CN: 'CH', CZ: 'EZ', DE: 'GM', DK: 'DA', DZ: 'AG', EG: 'EG',
  ES: 'SP', FR: 'FR', GB: 'UK', GR: 'GR', HR: 'HR', HU: 'HU', ID: 'ID', IN: 'IN', IQ: 'IZ',
  IR: 'IR', IT: 'IT', JO: 'JO', JP: 'JA', KG: 'KG', KR: 'KS', KZ: 'KZ', LB: 'LE', MA: 'MO',
  MX: 'MX', MY: 'MY', NL: 'NL', NO: 'NO', PK: 'PK', PL: 'PL', PT: 'PO', RO: 'RO', RS: 'RI',
  RU: 'RS', SA: 'SA', SE: 'SW', TJ: 'TI', TM: 'TX', TN: 'TS', TR: 'TU', UA: 'UP', US: 'US',
  UZ: 'UZ', VE: 'VE', ZA: 'SF',
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

/** Beklenen İngilizce ülke adı — yanıttaki `sourcecountry` bununla doğrulanır. */
function beklenenUlkeAdi(iso2) {
  try {
    const ad = regionNames.of(iso2.toUpperCase())
    return ad && ad !== iso2.toUpperCase() ? ad : null
  } catch {
    return null
  }
}

// GDELT bazı ülkeleri kendi kısa adıyla yazıyor ve Intl'in resmî adıyla birebir tutmayabilir.
// Bunlar UYDURMA eşleşme değil, aynı ülkenin bilinen yazım varyantları.
const ULKE_ADI_ESLERI = {
  'United Kingdom': ['United Kingdom', 'UK'],
  'United States': ['United States', 'United States of America', 'USA'],
  Russia: ['Russia', 'Russian Federation'],
  'South Korea': ['South Korea', 'Korea, South', 'Republic of Korea'],
  Czechia: ['Czechia', 'Czech Republic'],
  'Bosnia & Herzegovina': ['Bosnia & Herzegovina', 'Bosnia and Herzegovina'],
  'United Arab Emirates': ['United Arab Emirates', 'UAE'],
}

function ulkeEslesiyorMu(sourcecountry, beklenen) {
  if (!sourcecountry || !beklenen) return false
  const kabul = ULKE_ADI_ESLERI[beklenen] || [beklenen]
  return kabul.some((a) => a.toLowerCase() === String(sourcecountry).toLowerCase())
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
  const beklenen = beklenenUlkeAdi(iso2)
  const hepsi = articles || []
  const suzulmus = beklenen ? hepsi.filter((a) => ulkeEslesiyorMu(a.sourcecountry, beklenen)) : []

  if (hepsi.length > 0 && suzulmus.length === 0) {
    console.warn(
      `[gdelt] ${iso2} için ${hepsi.length} makale döndü ama hiçbiri beklenen ülkeyle (${beklenen || '?'}) eşleşmedi — atlanıyor.`
    )
  }

  return suzulmus.slice(0, MAX_ARTICLES).map((a) => ({
    title: a.title || '',
    source: a.domain || null,
    date: seendateToIso(a.seendate),
    url: a.url || null,
    // GDELT özet döndürmüyor — uydurma bir özet üretmek yerine açıkça null (bkz. dosya başı notu).
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

  const parcalar = [`"${String(query).trim()}"`]
  if (fips) parcalar.push(`sourcecountry:${fips}`)
  const data = await gdeltGet(parcalar.join(' '))
  return normalizeGdeltArticles(data.articles, iso2)
}

/** 14 günlük önbellek katmanı — `gdelt:news:*` ad alanında (bkz. gdeltNewsCacheKey). */
export async function fetchNewsArticlesGdeltCached(query, countryIso2) {
  const key = gdeltNewsCacheKey(query, countryIso2)
  const cached = getCached(key)
  if (cached) return cached
  const articles = await fetchNewsArticlesGdelt(query, countryIso2)
  setCached(key, articles, NEWS_TTL_MS)
  return articles
}
