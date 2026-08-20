import db from './db.js'
import { classifyDestinationsWithLLM } from './llm.js'

const CLASSIFY_CONCURRENCY = 5

// tmdb.js/themes.js'teki aynı desen — sınırlı eşzamanlı istekle dahili LLM sunucusunu
// boğmadan 200 diziyi işler.
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function runNext() {
    while (nextIndex < items.length) {
      const i = nextIndex++
      results[i] = await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext))
  return results
}

// Turizm açısından öne çıkan destinasyon/bölge listesi. Anahtar kelimeler,
// TMDB dizi özetinde (sinopsis) geçen yer adlarını yakalamak için — bu bir
// çekim lokasyonu tespiti DEĞİL, sinopsiste bahsedilen yer adı taraması.
export const DESTINATIONS = [
  { id: 'istanbul', name: 'İstanbul', keywords: ['istanbul', 'boğaziçi', 'galata', 'üsküdar', 'beyoğlu'] },
  { id: 'kapadokya', name: 'Kapadokya', keywords: ['kapadokya', 'nevşehir', 'göreme', 'ürgüp', 'peri bacaları'] },
  { id: 'antalya', name: 'Antalya', keywords: ['antalya', 'kaleiçi', 'side', 'kemer'] },
  { id: 'bodrum', name: 'Bodrum', keywords: ['bodrum', 'yalıkavak', 'bitez'] },
  { id: 'pamukkale', name: 'Pamukkale', keywords: ['pamukkale', 'hierapolis', 'denizli'] },
  { id: 'efes', name: 'Efes', keywords: ['efes', 'selçuk'] },
  { id: 'karadeniz', name: 'Karadeniz (Trabzon/Rize)', keywords: ['karadeniz', 'trabzon', 'rize', 'uzungöl', 'artvin'] },
  { id: 'mardin', name: 'Mardin', keywords: ['mardin', 'midyat'] },
  { id: 'sanliurfa', name: 'Şanlıurfa', keywords: ['şanlıurfa', 'urfa', 'göbeklitepe', 'balıklıgöl'] },
  { id: 'nemrut', name: 'Nemrut Dağı', keywords: ['nemrut', 'adıyaman'] },
  { id: 'fethiye', name: 'Fethiye / Ölüdeniz', keywords: ['fethiye', 'ölüdeniz', 'saklıkent'] },
  { id: 'alanya', name: 'Alanya', keywords: ['alanya'] },
  { id: 'canakkale', name: 'Çanakkale / Truva', keywords: ['çanakkale', 'truva', 'gelibolu', 'assos'] },
  { id: 'konya', name: 'Konya', keywords: ['konya', 'mevlana', 'çatalhöyük'] },
  { id: 'safranbolu', name: 'Safranbolu', keywords: ['safranbolu', 'karabük'] },
  { id: 'bursa', name: 'Bursa', keywords: ['bursa', 'uludağ', 'cumalıkızık'] },
  { id: 'izmir', name: 'İzmir', keywords: ['izmir', 'çeşme', 'alaçatı', 'karşıyaka'] },
  { id: 'gaziantep', name: 'Gaziantep', keywords: ['gaziantep', 'antep'] },
  { id: 'van', name: 'Van', keywords: ['van gölü', 'akdamar', 'van'] },
  { id: 'kars', name: 'Kars', keywords: ['kars', 'ani harabeleri'] },
  { id: 'adana', name: 'Adana', keywords: ['adana'] },
  { id: 'mugla', name: 'Muğla (Datça/Marmaris)', keywords: ['muğla', 'datça', 'marmaris', 'köyceğiz'] },
  { id: 'edirne', name: 'Edirne', keywords: ['edirne', 'selimiye'] },
  { id: 'amasya', name: 'Amasya', keywords: ['amasya'] },
  { id: 'mersin', name: 'Mersin', keywords: ['mersin', 'tarsus'] },
]

const DESTINATION_IDS = new Set(DESTINATIONS.map((d) => d.id))

export function detectDestinations(overview, name) {
  const text = `${overview || ''} ${name || ''}`.toLocaleLowerCase('tr')
  const matches = []
  for (const dest of DESTINATIONS) {
    const matchCount = dest.keywords.reduce((sum, kw) => sum + (text.includes(kw) ? 1 : 0), 0)
    if (matchCount > 0) matches.push({ id: dest.id, matchCount })
  }
  return matches.sort((a, b) => b.matchCount - a.matchCount).map((m) => m.id)
}

const selectAllStmt = db.prepare('SELECT * FROM destination_classifications')
const selectOneStmt = db.prepare('SELECT * FROM destination_classifications WHERE id = ?')
const upsertAutoDetectedStmt = db.prepare(`
  INSERT INTO destination_classifications (id, name, overview, auto_detected, detected_at, detection_method)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    auto_detected = excluded.auto_detected,
    detected_at = excluded.detected_at,
    detection_method = excluded.detection_method
`)
const updateHumanTagsStmt = db.prepare(`
  UPDATE destination_classifications
  SET human_tags_destinations = ?, human_tags_reviewer = ?, human_tags_at = ?
  WHERE id = ?
`)
const getFailureStmt = db.prepare('SELECT * FROM destination_classification_failures WHERE id = ?')
const upsertFailureStmt = db.prepare(`
  INSERT INTO destination_classification_failures (id, name, overview, failure_count, last_error, last_failed_at, next_retry_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    overview = excluded.overview,
    failure_count = excluded.failure_count,
    last_error = excluded.last_error,
    last_failed_at = excluded.last_failed_at,
    next_retry_at = excluded.next_retry_at
`)
const deleteFailureStmt = db.prepare('DELETE FROM destination_classification_failures WHERE id = ?')

function rowToEntry(row) {
  return {
    id: row.id,
    name: row.name,
    overview: row.overview,
    autoDetected: JSON.parse(row.auto_detected || '[]'),
    detectedAt: row.detected_at,
    detectionMethod: row.detection_method || null,
    humanTags: row.human_tags_destinations
      ? {
          destinations: JSON.parse(row.human_tags_destinations),
          reviewer: row.human_tags_reviewer,
          at: row.human_tags_at,
        }
      : null,
  }
}

// Birincil yöntem LLM (classifyDestinationsWithLLM) — eski anahtar kelime taraması
// (detectDestinations) artık sadece LLM başarısız olursa (kota, timeout, sunucu hatası)
// devreye giren bir yedek. 'llm' ile başarıyla sınıflandırılmış kayıtlar bir daha denenmez;
// 'keyword' (yedek) ile kaydedilenler her çağrıda (retry backoff'a uyarak) yeniden LLM'e
// denenir — themes.js'teki classification_failures deseniyle birebir aynı mantık.
export async function ensureDetected(series) {
  const existingRows = new Map(selectAllStmt.all().map((r) => [r.id, r]))
  const now = Date.now()
  const pending = series.filter((s) => {
    const row = existingRows.get(s.id)
    if (row && row.detection_method === 'llm') return false
    const failure = getFailureStmt.get(s.id)
    return !failure || !failure.next_retry_at || failure.next_retry_at <= now
  })

  await mapWithConcurrency(pending, CLASSIFY_CONCURRENCY, async (s) => {
    try {
      const destinationIds = await classifyDestinationsWithLLM(s.overview, s.name, DESTINATIONS)
      upsertAutoDetectedStmt.run(s.id, s.name, s.overview, JSON.stringify(destinationIds), new Date().toISOString(), 'llm')
      deleteFailureStmt.run(s.id)
    } catch (err) {
      const autoDetected = detectDestinations(s.overview, s.name)
      upsertAutoDetectedStmt.run(s.id, s.name, s.overview, JSON.stringify(autoDetected), new Date().toISOString(), 'keyword')
      const previous = getFailureStmt.get(s.id)
      const failureCount = (previous?.failure_count || 0) + 1
      const failedAt = Date.now()
      const retryDelayMs = Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * 2 ** (failureCount - 1))
      upsertFailureStmt.run(s.id, s.name, s.overview, failureCount, err.message.slice(0, 500), failedAt, failedAt + retryDelayMs)
      console.error(`[destinations] "${s.name}" (id:${s.id}) LLM ile tespit edilemedi, anahtar kelimeye düşüldü:`, err.message)
    }
  })

  return getDestinationStore()
}

export function getDestinationStore() {
  const store = {}
  for (const row of selectAllStmt.all()) {
    store[String(row.id)] = rowToEntry(row)
  }
  return store
}

export function setHumanTags(seriesId, destinationIds, reviewer) {
  const invalid = (destinationIds || []).filter((id) => !DESTINATION_IDS.has(id))
  if (invalid.length > 0) {
    throw new Error(`Geçersiz destinasyon: ${invalid.join(', ')}`)
  }
  const id = Number(seriesId)
  const row = selectOneStmt.get(id)
  if (!row) {
    throw new Error(`Dizi bulunamadı: ${seriesId}`)
  }
  updateHumanTagsStmt.run(
    JSON.stringify(destinationIds || []),
    reviewer || 'anonim',
    new Date().toISOString(),
    id
  )
  return rowToEntry(selectOneStmt.get(id))
}

// setHumanTags(id, [], reviewer) ile karıştırılmamalı: boş dizi kaydetmek "insan sıfır
// destinasyon onayladı" demektir (human_tags_destinations "[]" olur, hâlâ dolu/truthy).
// Bu fonksiyon kolonları gerçekten NULL'a çekip kaydı otomatik tespite geri döndürür —
// Analist Paneli'ndeki "AI önerisine geri dön" butonu için.
export function clearHumanTags(seriesId) {
  const id = Number(seriesId)
  const row = selectOneStmt.get(id)
  if (!row) {
    throw new Error(`Dizi bulunamadı: ${seriesId}`)
  }
  updateHumanTagsStmt.run(null, null, null, id)
  return rowToEntry(selectOneStmt.get(id))
}

export function effectiveDestinations(entry) {
  return entry.humanTags?.destinations ?? entry.autoDetected
}
