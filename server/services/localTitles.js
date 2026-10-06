import { getPipelineDb } from './pipelineDb.js'

// Dizinin bir ülkedeki yerel adı (IMDb, ülkeye göre yerel adlar — data-pipeline-python/imdb_sync.py haftalık).
// Basın taraması Türkçe adla yapıldığında, diziyi yerel adıyla haberleştiren basın kaçıyordu ("Kuruluş: Osman"
// yerine "Establishment: Osman", "Основание: Осман"). Türkçe adın aynısı ya da yalnızca Türkçe harfleri
// düşürülmüş hâli ("Kurulus: Osman") yerel ad sayılmaz.

const TR_FOLD = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' }

export function foldTitle(text) {
  return String(text || '')
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (ch) => TR_FOLD[ch])
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

const ASCII_FOLD = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  Ç: 'C',
  Ğ: 'G',
  İ: 'I',
  Ö: 'O',
  Ş: 'S',
  Ü: 'U',
  â: 'a',
  î: 'i',
  û: 'u',
}

/**
 * Türkçe adın yabancı basında yaygın yazımı: Türkçe harfler sadeleşmiş, noktalama boşluğa dönmüş
 * ("Kuruluş: Osman" → "Kurulus Osman"). Türkçe adla aynıysa null.
 */
export function asciiVariant(name) {
  const v = String(name || '')
    .replace(/[çğıöşüÇĞİÖŞÜâîû]/g, (ch) => ASCII_FOLD[ch])
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  return v && v !== String(name).trim() ? v : null
}

/** Aday yerel adlardan Türkçe addan gerçekten farklı olan ilki; yoksa null. */
export function pickLocalTitle(candidates, turkishName) {
  const own = foldTitle(turkishName)
  return candidates.find((t) => t && foldTitle(t) && foldTitle(t) !== own) ?? null
}

/** `getLocalTitle(seriesId, iso2)` — veritabanı yoksa ya da kayıt yoksa null. */
export function getLocalTitle(seriesId, iso2, turkishName, { conn = getPipelineDb() } = {}) {
  if (!conn) return null
  try {
    const rows = conn
      .prepare(
        `SELECT l.title FROM imdb_localized_titles l JOIN imdb_title_map m ON m.tconst = l.tconst
         WHERE m.tmdb_id = ? AND l.region = ? ORDER BY l.is_original, l.title`
      )
      .all(seriesId, String(iso2).toUpperCase())
    return pickLocalTitle(
      rows.map((r) => r.title),
      turkishName
    )
  } catch {
    return null
  }
}

// İngilizce konuşulan bölgeler; eşit oyda bu sıra. XWW IMDb'nin "dünya geneli" adı.
const ENGLISH_REGIONS = ['XWW', 'GB', 'US', 'CA', 'AU', 'IE', 'NZ', 'IN', 'ZA']
const MAX_ENGLISH_TITLES = 2

/**
 * Saf seçim: bölge kayıtlarından ([{ region, title }]) İngilizce adlar, en çok bölgede kullanılan önce. Tek bir
 * bölgenin kaydı yanıltabiliyor (Uzak Şehir'in ABD kaydı İspanyolca "Lejos de ti", dört bölgede "Far Away").
 * Türkçe adın aynısı ya da Türkçe harfsiz yazımı sayılmaz. İkinci ad yalnızca en az iki bölgede geçiyorsa
 * alınır: tek bölgede geçen ikinci ad çoğu zaman o bölgenin Fransızca/İspanyolca kaydıdır.
 */
export function pickEnglishTitles(rows, turkishName, max = MAX_ENGLISH_TITLES) {
  const own = foldTitle(turkishName)
  const votes = new Map()
  for (const r of rows) {
    const k = foldTitle(r.title)
    if (!k || k === own || !ENGLISH_REGIONS.includes(r.region)) continue
    const v = votes.get(k) || { title: r.title, count: 0, first: ENGLISH_REGIONS.length }
    v.count++
    v.first = Math.min(v.first, ENGLISH_REGIONS.indexOf(r.region))
    votes.set(k, v)
  }
  return [...votes.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .filter((v, i) => i === 0 || v.count >= 2)
    .slice(0, max)
    .map((v) => v.title)
}

/**
 * Dizinin İngilizce uluslararası adları (ör. "Uzak Şehir" → "Far Away"), en çok iki; yoksa boş liste. Basın
 * taramasının kaynağı yabancı dildeki haberleri İngilizceye çevirip çeviride arıyor: çeviride Türkçe ad
 * çoğunlukla kayboluyor, dizi İngilizce adıyla geçiyor.
 */
export function getEnglishTitles(seriesId, turkishName, { conn = getPipelineDb() } = {}) {
  if (!conn) return []
  try {
    const rows = conn
      .prepare(
        `SELECT l.region, l.title FROM imdb_localized_titles l JOIN imdb_title_map m ON m.tconst = l.tconst
         WHERE m.tmdb_id = ? AND l.region IN (${ENGLISH_REGIONS.map(() => '?').join(',')})`
      )
      .all(seriesId, ...ENGLISH_REGIONS)
    return pickEnglishTitles(rows, turkishName)
  } catch {
    return []
  }
}
