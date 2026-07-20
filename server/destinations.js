import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORE_PATH = path.join(__dirname, 'data', 'destination-store.json')

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

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8')
}

export function ensureDetected(series) {
  const store = loadStore()
  let changed = false

  for (const s of series) {
    const key = String(s.id)
    if (!store[key]) {
      store[key] = {
        id: s.id,
        name: s.name,
        overview: s.overview,
        autoDetected: detectDestinations(s.overview, s.name),
        detectedAt: new Date().toISOString(),
        humanTags: null,
      }
      changed = true
    }
  }

  if (changed) saveStore(store)
  return store
}

export function getDestinationStore() {
  return loadStore()
}

export function setHumanTags(seriesId, destinationIds, reviewer) {
  const invalid = (destinationIds || []).filter((id) => !DESTINATION_IDS.has(id))
  if (invalid.length > 0) {
    throw new Error(`Geçersiz destinasyon: ${invalid.join(', ')}`)
  }
  const store = loadStore()
  const key = String(seriesId)
  if (!store[key]) {
    throw new Error(`Dizi bulunamadı: ${seriesId}`)
  }
  store[key].humanTags = {
    destinations: destinationIds || [],
    reviewer: reviewer || 'anonim',
    at: new Date().toISOString(),
  }
  saveStore(store)
  return store[key]
}

export function effectiveDestinations(entry) {
  return entry.humanTags?.destinations ?? entry.autoDetected
}
