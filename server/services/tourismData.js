import * as XLSX from 'xlsx'
import db, { inTransaction } from '../db.js'
import { resolveIso2FromLabel } from './countryLookup.js'

const EXTERNAL_TIMEOUT_MS = 15000

const INDEX_URL = 'https://yigm.ktb.gov.tr/TR-249702/sinir-istatistikleri.html'
const SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const META_KEY = 'lastTourismSyncAt'
const SHEET_NAME = 'Milliyet'
const SUBTOTAL_ROW_RE = /^TOPLAM|^DİĞ\.|^YABANCI TOPLAM/

const TURKISH_MONTHS = {
  ocak: 1, şubat: 2, mart: 3, nisan: 4, mayıs: 5, haziran: 6,
  temmuz: 7, ağustos: 8, eylül: 9, ekim: 10, kasım: 11, aralık: 12,
}

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)
const upsertArrivalStmt = db.prepare(`
  INSERT INTO tourist_arrivals (iso2, year, month, visitor_count, source_bulletin, imported_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(iso2, year, month) DO UPDATE SET
    visitor_count = excluded.visitor_count,
    source_bulletin = excluded.source_bulletin,
    imported_at = excluded.imported_at
`)
const selectSeriesStmt = db.prepare(
  'SELECT year, month, visitor_count FROM tourist_arrivals WHERE iso2 = ? ORDER BY year, month'
)
const selectTrackedIso2Stmt = db.prepare('SELECT DISTINCT iso2 FROM tourist_arrivals')

export async function findLatestBulletin() {
  const res = await fetch(INDEX_URL, { signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Sınır istatistikleri sayfası alınamadı (${res.status})`)
  const html = await res.text()

  const anchorRe = /<a[^>]+href="([^"]+\.xls[^"]*)"[^>]*>([^<]*)<\/a>/gi
  let match
  while ((match = anchorRe.exec(html))) {
    const [, href, text] = match
    if (!/HABER\s*BÜLTEN/i.test(text)) continue
    const monthMatch = Object.keys(TURKISH_MONTHS).find((m) =>
      text.toLocaleLowerCase('tr').includes(m)
    )
    const yearMatch = text.match(/\d{4}/)
    if (!monthMatch || !yearMatch) continue
    return {
      url: new URL(href, INDEX_URL).toString(),
      month: TURKISH_MONTHS[monthMatch],
      year: Number(yearMatch[0]),
      title: text.trim(),
    }
  }
  throw new Error('Güncel sınır bülteni linki sayfada bulunamadı (site yapısı değişmiş olabilir)')
}

export function parseBulletin(buffer, bulletinMonth) {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheet = workbook.Sheets[SHEET_NAME]
  if (!sheet) throw new Error(`Bültende "${SHEET_NAME}" sayfası bulunamadı`)

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true })
  const headerRowIdx = rows.findIndex((r) => typeof r[0] === 'string' && r[0].trim() === 'MİLLİYET')
  if (headerRowIdx === -1) throw new Error('Bültende MİLLİYET başlık satırı bulunamadı')

  const headerRow = rows[headerRowIdx]
  const years = [1, 2, 3].map((i) => headerRow[i]).filter((y) => typeof y === 'number')
  if (years.length === 0) throw new Error('Bültende yıl sütunları okunamadı')

  const entries = []
  const unresolvedNames = new Set()

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const name = row[0]
    if (typeof name !== 'string' || !name.trim()) continue
    const trimmed = name.trim()
    if (SUBTOTAL_ROW_RE.test(trimmed)) continue
    const hasNumericYear = years.some((_, idx) => typeof row[1 + idx] === 'number')
    if (!hasNumericYear) continue

    const iso2 = resolveIso2FromLabel(trimmed)
    if (!iso2) {
      unresolvedNames.add(trimmed)
      continue
    }

    years.forEach((year, idx) => {
      const value = row[1 + idx]
      if (typeof value === 'number' && Number.isFinite(value)) {
        entries.push({ iso2, year, month: bulletinMonth, visitorCount: Math.round(value) })
      }
    })
  }

  return { entries, unresolvedNames: Array.from(unresolvedNames) }
}

async function downloadAndParseBulletin(bulletin) {
  const res = await fetch(bulletin.url, { signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Bülten dosyası indirilemedi (${res.status}): ${bulletin.url}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  return parseBulletin(buffer, bulletin.month)
}

export async function syncTourismData() {
  const bulletin = await findLatestBulletin()
  const { entries, unresolvedNames } = await downloadAndParseBulletin(bulletin)

  const now = new Date().toISOString()
  inTransaction(() => {
    for (const e of entries) {
      upsertArrivalStmt.run(e.iso2, e.year, e.month, e.visitorCount, bulletin.url, now)
    }
  })

  if (unresolvedNames.length > 0) {
    console.warn('[tourismData] eşleşmeyen ülke adları (atlandı):', unresolvedNames.join(', '))
  }
  console.log(`[tourismData] "${bulletin.title}" işlendi — ${entries.length} kayıt upsert edildi`)

  return { bulletin, importedCount: entries.length, unresolvedNames }
}

export async function syncTourismDataIfNeeded() {
  const row = getMetaStmt.get(META_KEY)
  const lastRunAt = row ? Number(row.value) : 0
  if (Date.now() - lastRunAt < SYNC_INTERVAL_MS) return null

  const result = await syncTourismData()
  setMetaStmt.run(META_KEY, String(Date.now()))
  return result
}

export function getVisitorSeries(iso2) {
  return selectSeriesStmt.all(iso2).map((r) => ({ year: r.year, month: r.month, visitorCount: r.visitor_count }))
}

export function getTrackedIso2s() {
  return new Set(selectTrackedIso2Stmt.all().map((r) => r.iso2))
}

export function pickBeforeAfterPair(series) {
  const byMonth = new Map()
  for (const s of series) {
    if (!byMonth.has(s.month)) byMonth.set(s.month, [])
    byMonth.get(s.month).push(s)
  }
  let best = null
  for (const list of byMonth.values()) {
    if (list.length >= 2 && (!best || list.length > best.length)) best = list
  }
  if (!best) return null
  const sorted = [...best].sort((a, b) => a.year - b.year)
  const after = sorted[sorted.length - 1]
  const before = sorted[sorted.length - 2]
  return { before: before.visitorCount, after: after.visitorCount, beforeYear: before.year, afterYear: after.year, month: before.month }
}

function round1(n) {
  return Math.round(n * 10) / 10
}

export function getAllLatestArrivals() {
  const items = []
  for (const iso2 of getTrackedIso2s()) {
    const pair = pickBeforeAfterPair(getVisitorSeries(iso2))
    if (!pair) continue
    const changePct = pair.before === 0 ? null : round1(((pair.after - pair.before) / pair.before) * 100)
    items.push({
      iso2,
      month: pair.month,
      beforeYear: pair.beforeYear,
      afterYear: pair.afterYear,
      visitorCount: pair.after,
      previousVisitorCount: pair.before,
      changePct,
    })
  }
  return items
}
