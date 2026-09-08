import db from './db.js'
import { serpapiGet } from './services/serpApiCache.js'

const CACHE_KEY = 'turkish-learning-index'
// Denetim bulgusu B-19: bu önbellekte hiç son kullanma yoktu — İLK başarılı çekimden sonra tablo
// sonsuza kadar donuyordu ve "Türkçe Dil Öğrenim İlgisi" kartı yıllar önceki veriyi güncelmiş
// gibi gösterebilirdi. Diğer Trends önbellekleriyle (serpApiCache.js TRENDS_TTL_MS) aynı ritim:
// 30 gün. Google Trends'in kendi verisi zaten haftalık çözünürlükte, daha sık tazelemek ücretli
// çağrıyı boşa harcar.
const TTL_MS = 30 * 24 * 60 * 60 * 1000
// Türkçe dizilerinin kültürel etkisini "Türkçe öğrenme ilgisi" üzerinden ölçmek için gerçek
// Google Trends arama hacmi çekilen terimler — server/serpapi.js'teki queryTrends ile aynı
// desen (google_trends engine, GEO_MAP_0, tek terim), tek fark burada dizi adı değil sabit
// 3 terim ayrı ayrı sorgulanıp birleştiriliyor (bkz. aşağıdaki not).
const SEARCH_TERMS = ['learn Turkish', 'Türkçe kursu', 'Turkish language course']

const getStmt = db.prepare('SELECT queried_at, by_country FROM turkish_learning_cache WHERE key = ?')
// TTL geldiğine göre bu satır artık YENİDEN yazılıyor — düz INSERT ikinci tazelemede
// `key` PRIMARY KEY'ine takılıp UNIQUE hatası verirdi (B-19'un sessiz yan etkisi).
const upsertStmt = db.prepare(`
  INSERT INTO turkish_learning_cache (key, queried_at, by_country) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET queried_at = excluded.queried_at, by_country = excluded.by_country
`)

// Denetim bulgusu B-19 (ikinci yarısı): burası kendi çıplak `fetch`'ini kuruyor, SerpAPI'ye
// doğrudan gidiyordu — yani ne AYLIK KURUM BÜTÇESİ sayacına ne de kullanıcı başına günlük kotaya
// (G-01) yazılıyordu. Üç terim × her tazeleme = 3 ücretli çağrı, muhasebe dışı. Artık ortak
// serpapiGet üzerinden geçiyor: rezervasyon, kota kontrolü, hata durumunda rezervasyonun geri
// alınması ve zaman aşımı hepsi oradan geliyor (bu yüzden yerel EXTERNAL_TIMEOUT_MS de kalktı).
async function fetchRegionInterest(term) {
  const data = await serpapiGet({
    engine: 'google_trends',
    q: term,
    data_type: 'GEO_MAP_0',
    hl: 'tr',
  })

  const byCountry = new Map()
  for (const r of data.interest_by_region || []) {
    const country = r.geo || r.location
    const value = r.extracted_value ?? r.value
    if (country != null && typeof value === 'number') byCountry.set(country, value)
  }
  return byCountry
}

// Not: SerpAPI'nin çoklu terim karşılaştırması (data_type=GEO_MAP, q="a,b,c") her bölgede
// terimler arasındaki GÖRELİ PAYI döner (bölge başına toplam ~100) — bu, ülkeler arası bir
// "hangi ülke daha çok ilgileniyor" kıyaslaması için kullanılamaz (her ülke ortalamada aynı
// ~33.3'e yakınsar). Bunun yerine 3 terimi server/serpapi.js'teki gibi AYRI AYRI sorgulayıp
// (her biri kendi 0-100 küresel skalasında), ortak çıkan ülkelerde ortalamasını alıyoruz —
// tek bir sayı üreten dürüst bir birleştirme, uydurma bir normalizasyon değil.
export async function getTurkishLearningIndex() {
  const row = getStmt.get(CACHE_KEY)
  const ageMs = row?.queried_at ? Date.now() - new Date(row.queried_at).getTime() : null
  if (row && ageMs != null && ageMs < TTL_MS) {
    return { queriedAt: row.queried_at, byCountry: JSON.parse(row.by_country), fromCache: true }
  }

  let perTermResults
  try {
    perTermResults = await Promise.all(SEARCH_TERMS.map((term) => fetchRegionInterest(term)))
  } catch (err) {
    // Tazeleme başarısız (kota/ağ/zaman aşımı). Elde süresi geçmiş bir kayıt varsa onu dürüstçe
    // `stale: true` ile döneriz — kartı boşaltmak yerine "eski ama var" demek daha faydalı;
    // hiç kayıt yoksa hata yukarı çıkar (serpApiCache.js'teki aynı dayanıklılık deseni).
    if (row) {
      console.error(`[turkish-learning] tazeleme başarısız (${err.message}), eski önbellek dönülüyor.`)
      return {
        queriedAt: row.queried_at,
        byCountry: JSON.parse(row.by_country),
        fromCache: true,
        stale: true,
      }
    }
    throw err
  }

  const allCountries = new Set(perTermResults.flatMap((m) => [...m.keys()]))
  const byCountry = [...allCountries]
    .map((country) => {
      const values = perTermResults.map((m) => m.get(country)).filter((v) => typeof v === 'number')
      const value = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
      return { country, value, matchedTermCount: values.length }
    })
    .sort((a, b) => b.value - a.value)

  const entry = {
    queriedAt: new Date().toISOString(),
    byCountry,
  }

  upsertStmt.run(CACHE_KEY, entry.queriedAt, JSON.stringify(byCountry))

  return { ...entry, fromCache: false }
}
