import * as XLSX from 'xlsx'
import db from '../db.js'
import { resolveIso2FromLabel } from './countryLookup.js'

const INDEX_URL = 'https://yigm.ktb.gov.tr/TR-249702/sinir-istatistikleri.html'
const SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000 // bülten ayda bir yayınlanıyor, günlük kontrol gereksiz
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
const selectOneStmt = db.prepare(
  'SELECT visitor_count FROM tourist_arrivals WHERE iso2 = ? AND year = ? AND month = ?'
)
const selectTrackedIso2Stmt = db.prepare('SELECT DISTINCT iso2 FROM tourist_arrivals')

// yigm.ktb.gov.tr/TR-249702/sinir-istatistikleri.html her ay milliyet bazında bir .xls bülteni
// yayınlıyor — sayfada güncel bülten linki düz HTML olarak var, metni her zaman
// "<AY> <YIL> HABER BÜLTENİ" formatında (ör. "HAZİRAN 2026 HABER BÜLTENİ"), doğrulandı. Aynı
// sayfada eski bir "flipbook" widget'ının içinde METİNSİZ, boş bir <a> de var (bir önceki
// bültene ait kalıntı) — bu yüzden sadece HREF'e değil, görünür metne "HABER BÜLTENİ" geçen
// linke bakıyoruz, karışmasın diye.
export async function findLatestBulletin() {
  const res = await fetch(INDEX_URL)
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

// Not: TR-249703/onceki-donemlere-ait-istatistikler.html (arşiv sayfası) geçmiş ayların
// listesini bir Telerik RadComboBox (AJAX) bileşeniyle dolduruyor — düz `fetch` + HTML ile
// taranamıyor (JS çalıştırmadan içerik gelmiyor). Bu yüzden geriye dönük otomatik toplu alım
// YAPILMIYOR; bunun yerine her bülten zaten SON 3 YILIN aynı ayını içeriyor (bkz.
// parseBulletin) — bu, en azından yıl-yıl aynı ay kıyaslaması için anında geçmiş veri sağlıyor.
// İleri dönük her senkronizasyon yeni bir ay ekler.
export async function findArchivedBulletins() {
  return []
}

// "Milliyet" sayfası: satır 2 başlık (MİLLİYET | YIL1 | YIL2 | YIL3 | ...), sonraki satırlar
// ülke adı + o 3 yılın aynı ayına ait ziyaretçi sayısı. "TOPLAM ..."/"DİĞ. ... ÜLKELERİ" satırları
// kıta/grup alt toplamı — gerçek bir ülke değil, atlanıyor. Eşleşmeyen ülke adları (bkz.
// countryLookup.js'teki not) sessizce atlanır, uydurma bir iso2 üretilmez.
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
    // Sayfa altındaki dipnot/iletişim satırları da col0'da metin taşıyor ama hiçbir yıl
    // sütununda sayı yok — gerçek bir ülke satırı değiller, sessizce atlanır (unresolved
    // listesine bile eklenmez, gürültü olmasın diye).
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
  const res = await fetch(bulletin.url)
  if (!res.ok) throw new Error(`Bülten dosyası indirilemedi (${res.status}): ${bulletin.url}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  return parseBulletin(buffer, bulletin.month)
}

// Kalıcı senkronizasyon: en güncel bülteni bulur, indirir, parse eder ve tourist_arrivals'a
// upsert eder. Tek bir hata (site erişilemez, format değişmiş, .xls bozuk) her şeyi düşürmez —
// çağıran (scheduler.js) zaten try/catch içinde, burada sadece anlamlı bir hata fırlatılır.
export async function syncTourismData() {
  const bulletin = await findLatestBulletin()
  const { entries, unresolvedNames } = await downloadAndParseBulletin(bulletin)

  const now = new Date().toISOString()
  for (const e of entries) {
    upsertArrivalStmt.run(e.iso2, e.year, e.month, e.visitorCount, bulletin.url, now)
  }

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

export function getVisitorCount(iso2, year, month) {
  const row = selectOneStmt.get(iso2, year, month)
  return row ? row.visitor_count : null
}

// impact.js'in korelasyon adayı ülkeleri seçerken kullanır: bültende ayrı satırı olmayan
// (küçük/az turistli, "DİĞER ÜLKELER" alt toplamına giren) ülkeler için World Bank kontrol-ülkesi
// aramasına hiç girmeye gerek yok — bu Set ile önceden eleniyorlar.
export function getTrackedIso2s() {
  return new Set(selectTrackedIso2Stmt.all().map((r) => r.iso2))
}
