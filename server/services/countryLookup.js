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

const NAME_ALIASES = {
  'bosna-hersek': 'BA',
  'beyaz rusya (belarus)': 'BY',
  'güney kıbrıs rum kesimi': 'CY',
  'çek cumhuriyeti (çekya)': 'CZ',
  // Eski yıllık sınır bültenlerindeki adlar (2016–2019)
  'çek cumhuriyeti': 'CZ',
  'çin halk cumhuriyeti': 'CN',
  makedonya: 'MK',
  'ingiltere (birleşik krallık)': 'GB',
  'kuzey makedonya cumhuriyeti': 'MK',
  'rusya fed.': 'RU',
  'güney afrika cumhuriyeti': 'ZA',
}

// İngilizce ülke adları (elcinema, tabii gibi yabancı siteler): Intl bölge adlarından + yaygın farklı yazımlar.
const EN_ALIASES = {
  'czech republic': 'CZ',
  turkey: 'TR',
  palestine: 'PS',
  'state of palestine': 'PS',
  'ivory coast': 'CI',
  'democratic republic of the congo': 'CD',
  'republic of the congo': 'CG',
  'south korea': 'KR',
  'north macedonia': 'MK',
  usa: 'US',
  uk: 'GB',
  uae: 'AE',
}
let iso2ByEnglish = null
function englishIndex() {
  if (iso2ByEnglish) return iso2ByEnglish
  iso2ByEnglish = new Map(Object.entries(EN_ALIASES))
  const dn = new Intl.DisplayNames(['en'], { type: 'region' })
  for (const iso2 of Object.keys(countryNames)) {
    try {
      const n = dn.of(iso2)
      if (n && n !== iso2) iso2ByEnglish.set(n.toLowerCase(), iso2)
    } catch {
      // bilinmeyen kod
    }
  }
  return iso2ByEnglish
}

/** İngilizce ülke adı → ISO-2 (bulunamazsa Türkçe çözümleyiciye düşer). */
export function resolveIso2FromEnglish(label) {
  if (!label) return null
  return englishIndex().get(String(label).trim().toLowerCase()) ?? resolveIso2FromLabel(label)
}

export function resolveIso2FromLabel(label) {
  if (!label) return null
  const trimmed = String(label).trim()
  if (trimmed.length === 2 && countryNames[trimmed.toUpperCase()]) {
    return trimmed.toUpperCase()
  }
  const lower = trimmed.toLocaleLowerCase('tr')
  return ISO2_BY_NAME.get(lower) || NAME_ALIASES[lower] || null
}

/**
 * ISO2 → Türkçe ülke adı. Ülke bazlı zaman serisi uçlarının (bkz. server/index.js
 * /api/trends/timeseries) LLM yorumuna ve hata mesajlarına okunabilir bir kapsam etiketi
 * verebilmesi için. country-centroids.json'da karşılığı yoksa kodun KENDİSİ döner — uydurma
 * bir ad üretilmez (resolveIso2FromLabel'ın null dönme ilkesiyle aynı çizgi).
 */
export function countryNameFromIso2(iso2) {
  if (!iso2) return null
  const code = String(iso2).trim().toUpperCase()
  return countryNames[code]?.name || code
}
