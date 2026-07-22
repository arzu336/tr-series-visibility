import db from './db.js'

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
const insertIgnoreStmt = db.prepare(`
  INSERT OR IGNORE INTO destination_classifications (id, name, overview, auto_detected, detected_at)
  VALUES (?, ?, ?, ?, ?)
`)
const updateHumanTagsStmt = db.prepare(`
  UPDATE destination_classifications
  SET human_tags_destinations = ?, human_tags_reviewer = ?, human_tags_at = ?
  WHERE id = ?
`)

function rowToEntry(row) {
  return {
    id: row.id,
    name: row.name,
    overview: row.overview,
    autoDetected: JSON.parse(row.auto_detected || '[]'),
    detectedAt: row.detected_at,
    humanTags: row.human_tags_destinations
      ? {
          destinations: JSON.parse(row.human_tags_destinations),
          reviewer: row.human_tags_reviewer,
          at: row.human_tags_at,
        }
      : null,
  }
}

export function ensureDetected(series) {
  const existingIds = new Set(selectAllStmt.all().map((r) => r.id))

  for (const s of series) {
    if (existingIds.has(s.id)) continue
    const autoDetected = detectDestinations(s.overview, s.name)
    insertIgnoreStmt.run(s.id, s.name, s.overview, JSON.stringify(autoDetected), new Date().toISOString())
  }

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

export function effectiveDestinations(entry) {
  return entry.humanTags?.destinations ?? entry.autoDetected
}
