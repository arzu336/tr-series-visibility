import db from './db.js'

const getStmt = db.prepare('SELECT value, expires_at FROM cache_entries WHERE key = ?')
const headStmt = db.prepare('SELECT updated_at, expires_at FROM cache_entries WHERE key = ?')

// Büyük ve her istekte okunan girdiler (katalog ~MB) her çağrıda JSON.parse edilmesin (inceleme C1, 2026-10-14):
// ayrıştırılmış değer satırın updated_at'iyle anahtarlanarak süreç belleğinde tutulur; satır değişince düşer.
// Aynı nesne paylaşıldığı için çağıranlar onu değiştirmemeli (fillMissingPosters/applyTabiiAvailability
// idempotent ve nesne başına bir kez uygulanır — bkz. data-pipeline.getRawSeriesDataCached).
export const MEMO_KEYS = new Set(['raw-series-providers', 'tabii-catalog'])
const memo = new Map() // key → { updatedAt, value }
const upsertStmt = db.prepare(`
  INSERT INTO cache_entries (key, value, expires_at, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at, updated_at = excluded.updated_at
`)

export function getCached(key) {
  if (MEMO_KEYS.has(key)) {
    const head = headStmt.get(key)
    if (!head || Date.now() > head.expires_at) return null
    const m = memo.get(key)
    if (m && m.updatedAt === head.updated_at) return m.value
    const row = getStmt.get(key)
    if (!row) return null
    const value = JSON.parse(row.value)
    memo.set(key, { updatedAt: head.updated_at, value })
    return value
  }
  const row = getStmt.get(key)
  if (!row) return null
  if (Date.now() > row.expires_at) return null
  return JSON.parse(row.value)
}

export function setCached(key, value, ttlMs) {
  const now = Date.now()
  upsertStmt.run(key, JSON.stringify(value), now + ttlMs, now)
  memo.delete(key)
}

/** Testler ve elle temizlik için: bellekteki ayrıştırılmış kopyayı düşür. */
export function dropCacheMemo(key) {
  if (key == null) memo.clear()
  else memo.delete(key)
}

const purgeExpiredStmt = db.prepare('DELETE FROM cache_entries WHERE expires_at < ?')

export function purgeExpiredCacheEntries(now = Date.now()) {
  return purgeExpiredStmt.run(now).changes
}
