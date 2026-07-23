import db from './db.js'

const getStmt = db.prepare('SELECT value, expires_at FROM cache_entries WHERE key = ?')
const getInfoStmt = db.prepare('SELECT updated_at, expires_at FROM cache_entries WHERE key = ?')
const upsertStmt = db.prepare(`
  INSERT INTO cache_entries (key, value, expires_at, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at, updated_at = excluded.updated_at
`)

export function getCached(key) {
  const row = getStmt.get(key)
  if (!row) return null
  if (Date.now() > row.expires_at) return null
  return JSON.parse(row.value)
}

export function setCached(key, value, ttlMs) {
  const now = Date.now()
  upsertStmt.run(key, JSON.stringify(value), now + ttlMs, now)
}

export function getCacheInfo(key) {
  const row = getInfoStmt.get(key)
  if (!row) return null
  return {
    updatedAt: row.updated_at || null,
    expiresAt: row.expires_at,
    isFresh: Date.now() <= row.expires_at,
  }
}
