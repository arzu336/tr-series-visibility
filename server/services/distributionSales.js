import db from '../db.js'
import { getCached } from '../cache.js'
import { resolveIso2FromLabel } from './countryLookup.js'
import { asciiVariant, foldTitle, getEnglishTitles } from './localTitles.js'

// Dağıtımcı satış kayıtları (2026-10-06): Türk dağıtımcıların (Global Agency, Inter Medya, Kanal D International…)
// izinle paylaştığı "hangi dizi, hangi ülke, hangi kanal/platform" tablosu. Televizyon satışları başka hiçbir
// kaynakta görünmüyor. Yönetim ekranından CSV olarak yüklenir; aynı dağıtımcının yeni dosyası eskisinin yerini alır.
//
// Sütunlar (başlık satırı zorunlu, sıra serbest): dizi, ulke, alici, baslangic, bitis
// (İngilizce de olur: series, country, buyer, start, end). Ayraç virgül ya da noktalı virgül.

const HEADER_ALIASES = {
  dizi: 'series',
  series: 'series',
  ulke: 'country',
  ülke: 'country',
  country: 'country',
  alici: 'buyer',
  alıcı: 'buyer',
  kanal: 'buyer',
  buyer: 'buyer',
  channel: 'buyer',
  baslangic: 'start',
  başlangıç: 'start',
  start: 'start',
  bitis: 'end',
  bitiş: 'end',
  end: 'end',
}

/** Basit CSV ayrıştırıcı: tırnaklı alanlar, virgül ya da noktalı virgül (ilk satıra göre). */
export function parseCsv(text) {
  const lines = String(text)
    .replace(BOM, '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
  if (!lines.length) return []
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ','
  return lines.map((line) => {
    const out = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"'
          i++
        } else if (ch === '"') q = false
        else cur += ch
      } else if (ch === '"') q = true
      else if (ch === sep) {
        out.push(cur.trim())
        cur = ''
      } else cur += ch
    }
    out.push(cur.trim())
    return out
  })
}

const BOM = new RegExp('^' + String.fromCharCode(0xfeff))
const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/

function seriesResolver(series, englishTitlesOf) {
  const byKey = new Map()
  for (const s of series) {
    for (const n of [s.name, asciiVariant(s.name), ...englishTitlesOf(s)].filter(Boolean)) {
      const k = foldTitle(n)
      if (k && !byKey.has(k)) byKey.set(k, s.id)
    }
  }
  const ids = new Set(series.map((s) => s.id))
  return (value) => {
    const v = String(value || '').trim()
    if (/^\d+$/.test(v)) return ids.has(Number(v)) ? Number(v) : null
    return byKey.get(foldTitle(v)) ?? null
  }
}

/**
 * CSV'yi doğrular ve yazar. Dönüş: { imported, skipped: [{ line, reason }] }. Hiç geçerli satır yoksa eski
 * kayıtlar silinmez (yanlış dosya yüklemesi veriyi boşaltmasın).
 */
export function importDistributionCsv(
  csv,
  distributor,
  {
    series = getCached('raw-series-providers')?.series || [],
    englishTitlesOf = (s) => getEnglishTitles(s.id, s.name),
    now = new Date(),
  } = {}
) {
  const rows = parseCsv(csv)
  if (rows.length < 2) throw new Error('Dosyada başlık satırı ve en az bir kayıt olmalı')
  const header = rows[0].map((h) => HEADER_ALIASES[h.toLocaleLowerCase('tr').trim()] ?? null)
  for (const need of ['series', 'country', 'buyer']) {
    if (!header.includes(need))
      throw new Error(`Eksik sütun: ${need === 'series' ? 'dizi' : need === 'country' ? 'ulke' : 'alici'}`)
  }
  const col = (r, name) => r[header.indexOf(name)] ?? ''
  const resolveSeries = seriesResolver(series, englishTitlesOf)
  const valid = []
  const skipped = []
  rows.slice(1).forEach((r, i) => {
    const line = i + 2
    const seriesId = resolveSeries(col(r, 'series'))
    const iso2 = /^[A-Za-z]{2}$/.test(col(r, 'country'))
      ? col(r, 'country').toUpperCase()
      : resolveIso2FromLabel(col(r, 'country'))
    const buyer = col(r, 'buyer')
    const start = col(r, 'start') || null
    const end = col(r, 'end') || null
    if (!seriesId) return skipped.push({ line, reason: `dizi tanınmadı: "${col(r, 'series')}"` })
    if (!iso2) return skipped.push({ line, reason: `ülke tanınmadı: "${col(r, 'country')}"` })
    if (!buyer) return skipped.push({ line, reason: 'alıcı (kanal/platform) boş' })
    if ((start && !DATE_RE.test(start)) || (end && !DATE_RE.test(end)))
      return skipped.push({ line, reason: 'tarih YYYY-AA-GG (ya da YYYY-AA, YYYY) biçiminde olmalı' })
    valid.push({ seriesId, iso2, buyer, start, end })
  })
  if (valid.length) {
    const stamp = now.toISOString()
    db.prepare('DELETE FROM distribution_sales WHERE distributor = ?').run(distributor)
    const ins = db.prepare(`
      INSERT INTO distribution_sales (series_id, iso2, buyer, distributor, start_date, end_date, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(series_id, iso2, buyer, distributor) DO UPDATE SET start_date = excluded.start_date,
        end_date = excluded.end_date, imported_at = excluded.imported_at
    `)
    for (const v of valid) ins.run(v.seriesId, v.iso2, v.buyer, distributor, v.start, v.end, stamp)
  }
  return { imported: valid.length, skipped }
}

export function getCountrySales(iso2) {
  return db
    .prepare(
      `SELECT series_id seriesId, buyer, distributor, start_date start, end_date end FROM distribution_sales
       WHERE iso2 = ? ORDER BY COALESCE(start_date, '') DESC`
    )
    .all(String(iso2).toUpperCase())
}

export function getSeriesSales(seriesId) {
  return db
    .prepare(
      `SELECT iso2, buyer, distributor, start_date start, end_date end FROM distribution_sales
       WHERE series_id = ? ORDER BY iso2`
    )
    .all(seriesId)
}

export function distributionStatus() {
  return db
    .prepare(
      `SELECT distributor, COUNT(*) records, COUNT(DISTINCT series_id) series, COUNT(DISTINCT iso2) countries,
       MAX(imported_at) importedAt FROM distribution_sales GROUP BY distributor ORDER BY distributor`
    )
    .all()
}
