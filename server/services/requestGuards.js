import { getRawSeriesDataCached } from '../data-pipeline.js'

// Denetim bulguları G-01 ve B-15: ücretli SerpAPI/LLM çağrısı tetikleyen uçlar ham
// :seriesName / :iso2 parametrelerini doğrudan dış servise geçiriyordu. Önbellek anahtarı ham
// dizeyi içerdiği için HER benzersiz değer yeni bir ücretli çağrıydı — onaylı tek bir kullanıcı
// (hatta yanlışlıkla) aylık bütçeyi saatler içinde bitirebiliyordu. Bu modül iki katman ekler:
//   1) Girdi doğrulama — bilinmeyen dizi adı / geçersiz ülke kodu dış servise HİÇ ulaşmaz (400).
//   2) Kullanıcı başına GÜNLÜK canlı çağrı kotası — services/liveCallQuota.js'te (o modül
//      bilerek yalnızca db.js'e bağımlı, çünkü llm.js de ondan import ediyor).

// 'ZZ' = "Unknown Region" (Intl'in kendi joker kodu) — gerçek bir ülke değil, dışlanır.
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

/**
 * ISO-3166-1 alpha-2 doğrulaması. country-centroids.json'a bakmak yerine Intl'in kendi bölge
 * tablosu kullanılıyor: o dosya 147 ülkeyle sınırlı (İran, Çin, Kosova gibi gerçek ülkeler
 * eksik) ve orada olmamak "geçersiz kod" demek değil — sadece haritada adlandırılamıyor demek.
 */
export function isValidIso2(value) {
  if (typeof value !== 'string') return false
  const code = value.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code) || code === 'ZZ') return false
  try {
    return regionNames.of(code) !== code
  } catch {
    return false
  }
}

export function normalizeIso2(value) {
  return String(value).trim().toUpperCase()
}

/**
 * Dizi adını CANLI listeye (raw-series-providers önbelleği) karşı çözümler ve TMDB'deki
 * kanonik adı döndürür; bulunamazsa null. Küçük/büyük harf ve baştaki/sondaki boşluk farkları
 * tolere edilir (Türkçe yerel karşılaştırmayla) — böylece kullanıcı "yalı çapkını" yazsa da
 * önbellek anahtarı her zaman kanonik "Yalı Çapkını" olur, aynı dizi için ikinci bir ücretli
 * çağrı açılmaz.
 */
export async function resolveKnownSeriesName(rawName) {
  if (typeof rawName !== 'string' || !rawName.trim()) return null
  const needle = rawName.trim().toLocaleLowerCase('tr')
  const raw = await getRawSeriesDataCached()
  const match = raw.series.find((s) => s.name.trim().toLocaleLowerCase('tr') === needle)
  return match ? match.name : null
}

/** Birden çok başlık alan uçlar (share-of-search, regional-breakdown) için. */
export async function resolveKnownSeriesNames(rawNames) {
  const resolved = []
  for (const name of rawNames) {
    const canonical = await resolveKnownSeriesName(name)
    if (!canonical) return { ok: false, unknown: name, titles: [] }
    resolved.push(canonical)
  }
  return { ok: true, unknown: null, titles: resolved }
}
