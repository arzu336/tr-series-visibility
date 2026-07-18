import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE_PATH = path.join(__dirname, 'data', 'cache.json')

function loadDisk() {
  if (!fs.existsSync(CACHE_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveDisk(store) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
  fs.writeFileSync(CACHE_PATH, JSON.stringify(store, null, 2), 'utf8')
}

// Sunucu yeniden başlasa bile (bellek cache'i sıfırlanır) TMDB gibi hız
// sınırlı/kırılgan dış API'lere gereksiz tekrar yük binmesin diye diske de yazılır.
export function getCached(key) {
  const store = loadDisk()
  const entry = store[key]
  if (!entry) return null
  if (Date.now() > entry.expiresAt) return null
  return entry.value
}

export function setCached(key, value, ttlMs) {
  const store = loadDisk()
  store[key] = { value, expiresAt: Date.now() + ttlMs }
  saveDisk(store)
}
