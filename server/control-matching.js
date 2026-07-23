import { getCached, setCached } from './cache.js'

// GSYH/gelir grubu/bölge sınıflandırması sık değişmez — 30 günlük cache yeterli
// ve World Bank'ın günlük istek limitini boşuna zorlamaz.
const WB_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const META_CACHE_KEY = 'worldbank-country-meta'
const GDP_CACHE_KEY = 'worldbank-gdp-per-capita'

async function fetchWorldBankJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`World Bank isteği başarısız (${res.status})`)
  return res.json()
}

async function fetchCountryMetaFresh() {
  const data = await fetchWorldBankJson('https://api.worldbank.org/v2/country?format=json&per_page=400')
  const rows = data[1] || []
  const meta = {}
  for (const row of rows) {
    // region.id === 'NA' => "Africa", "Arab World", "World" gibi bölge/gelir grubu
    // toplamları — gerçek bir ülke değil, eleniyor.
    if (!row.iso2Code || row.region?.id === 'NA') continue
    meta[row.iso2Code] = {
      name: row.name,
      region: row.region?.value || null,
      incomeLevel: row.incomeLevel?.value || null,
    }
  }
  return meta
}

async function fetchGdpPerCapitaFresh() {
  const data = await fetchWorldBankJson(
    'https://api.worldbank.org/v2/country/all/indicator/NY.GDP.PCAP.CD?format=json&per_page=20000&mrv=1'
  )
  const rows = data[1] || []
  const gdp = {}
  for (const row of rows) {
    if (row.value == null || !row.country?.id) continue
    gdp[row.country.id] = row.value
  }
  return gdp
}

// "Single-flight": 5 yükselen ülke için eşzamanlı 5 suggestControlCountry() çağrısı
// aynı anda cache'i boş bulup 5 ayrı World Bank isteği atmasın diye, devam eden
// bir fetch varsa yeni çağrılar onu bekler, ayrı bir istek başlatmaz.
let countryMetaInFlight = null
async function getCountryMeta() {
  const cached = getCached(META_CACHE_KEY)
  if (cached) return cached
  if (!countryMetaInFlight) {
    countryMetaInFlight = fetchCountryMetaFresh()
      .then((meta) => {
        setCached(META_CACHE_KEY, meta, WB_CACHE_TTL_MS)
        return meta
      })
      .finally(() => {
        countryMetaInFlight = null
      })
  }
  return countryMetaInFlight
}

let gdpInFlight = null
async function getGdpPerCapita() {
  const cached = getCached(GDP_CACHE_KEY)
  if (cached) return cached
  if (!gdpInFlight) {
    gdpInFlight = fetchGdpPerCapitaFresh()
      .then((gdp) => {
        setCached(GDP_CACHE_KEY, gdp, WB_CACHE_TTL_MS)
        return gdp
      })
      .finally(() => {
        gdpInFlight = null
      })
  }
  return gdpInFlight
}

// Proje raporunun §4.5'inde tanımlanan Difference-in-Differences yöntemi için
// "kontrol ülkesi" seçimini otomatikleştirir: hedef ülkeye bölge + gelir grubu +
// kişi başı GSYH bakımından en yakın, ama aynı dönemde kendi dizi trendi
// yaşamayan (excludeIso2Set'te olmayan) ülkeyi bulur. Ücretli bir kaynak
// gerekmiyor — World Bank açık verisi anahtarsız ve ücretsiz.
//
// Not: Bu sadece EŞLEŞTİRMEYİ otomatikleştirir. differenceInDifferences()
// (impact.js) hâlâ gerçek turist/ihracat before/after verisi bekliyor —
// gerçek veri gelene kadar bu öneri "hangi ülkeyle kıyaslanmalı" sorusuna
// cevap verir, "ne kadar etki oldu" sorusuna değil.
export async function suggestControlCountry(targetIso2, excludeIso2Set) {
  const [meta, gdp] = await Promise.all([getCountryMeta(), getGdpPerCapita()])
  const target = meta[targetIso2]
  const targetGdp = gdp[targetIso2]
  if (!target) return null

  let best = null
  for (const [iso2, candidate] of Object.entries(meta)) {
    if (iso2 === targetIso2 || excludeIso2Set.has(iso2)) continue

    const reasons = []
    let score = 0
    if (candidate.region === target.region) {
      score += 2
      reasons.push('aynı bölge')
    }
    if (candidate.incomeLevel === target.incomeLevel) {
      score += 2
      reasons.push('aynı gelir grubu')
    }
    const candidateGdp = gdp[iso2]
    if (targetGdp && candidateGdp) {
      // GSYH dağılımı çok geniş (yüzlerden yüz binlere $) — log ölçeğinde
      // yakınlık bakmak, doğrusal farkın zengin ülkelerde yanıltıcı
      // büyümesini önler.
      const logDiff = Math.abs(Math.log(targetGdp) - Math.log(candidateGdp))
      const gdpScore = Math.max(0, 2 - logDiff)
      if (gdpScore > 1) reasons.push('benzer kişi başı GSYH')
      score += gdpScore
      score += 0.01 // eşit puanlı adaylar arasında GSYH verisi eksik olmayanı tercih et
    }

    if (!best || score > best.score) {
      best = { iso2, name: candidate.name, score, reasons }
    }
  }

  // Hiçbir ortak boyutta eşleşme yoksa (score sadece gürültüden geliyorsa)
  // öneri sunmuyoruz — zayıf bir eşleşmeyi güvenilir gibi göstermemek için.
  if (!best || best.reasons.length === 0) return null
  return { iso2: best.iso2, name: best.name, reason: best.reasons.join(', ') }
}
