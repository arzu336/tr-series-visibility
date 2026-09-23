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
  'ingiltere (birleşik krallık)': 'GB',
  'kuzey makedonya cumhuriyeti': 'MK',
  'rusya fed.': 'RU',
  'güney afrika cumhuriyeti': 'ZA',
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
