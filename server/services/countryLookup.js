import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const countryNames = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'data', 'country-centroids.json'), 'utf-8')
)

const ISO2_BY_NAME = new Map(
  Object.entries(countryNames).map(([iso2, entry]) => [entry.name.toLocaleLowerCase('tr'), iso2])
)

// yigm.ktb.gov.tr'nin aylık sınır bülteni (server/services/tourismData.js), country-centroids.json'daki
// kısa resmi adın YANINDA parantezli/uzun bir varyant kullanıyor (ör. "İngiltere (Birleşik
// Krallık)", "Rusya Fed."). Bunlar GERÇEKTEN aynı ülke — country-centroids.json'da zaten karşılığı
// var, sadece yazım farklı. Yeni bir ülke EKLEMİYOR, sadece bilinen bir eşleşmeyi tarif ediyor.
// country-centroids.json'da hiç karşılığı olmayan isimler (ör. bültendeki "Sudan", "İran", "Çin
// Halk Cumhuriyeti", "Kosova" — bu dosyada iso2'leri hiç yok) burada da bilinçli olarak
// eklenmiyor: haritanın/uygulamanın geri kalanı zaten o ülkeleri tanımıyor, sadece turizm
// verisinde "çözüldü" gibi göstermek yanıltıcı olurdu.
const NAME_ALIASES = {
  'beyaz rusya (belarus)': 'BY',
  'güney kıbrıs rum kesimi': 'CY',
  'çek cumhuriyeti (çekya)': 'CZ',
  'ingiltere (birleşik krallık)': 'GB',
  'kuzey makedonya cumhuriyeti': 'MK',
  'rusya fed.': 'RU',
  'güney afrika cumhuriyeti': 'ZA',
}

// src/lib/continents.js'teki resolveIso2FromLabel ile birebir aynı eşleme mantığı: SerpAPI/
// Google Trends bölge etiketleri bazen ISO2 kod, bazen (hl=tr'ye göre) yerelleştirilmiş ülke
// adı olarak dönüyor. server/ ve src/ ayrı çalışma zamanları olduğu için (client bundle'a
// server-only kod sızmasın) burada tekrarlanıyor — server/services/proxyScore.js'in ürettiği
// fallback ülkeleri gerçek TMDB ülkeleriyle birleştirmek (bkz. aggregate.js mergeProxyFallback)
// için kullanılıyor. Eşleşme yoksa null döner, uydurma bir eşleşme yapılmaz.
export function resolveIso2FromLabel(label) {
  if (!label) return null
  const trimmed = String(label).trim()
  if (trimmed.length === 2 && countryNames[trimmed.toUpperCase()]) {
    return trimmed.toUpperCase()
  }
  const lower = trimmed.toLocaleLowerCase('tr')
  return ISO2_BY_NAME.get(lower) || NAME_ALIASES[lower] || null
}
