import db from './db.js'

const getStmt = db.prepare('SELECT value, expires_at FROM cache_entries WHERE key = ?')
const upsertStmt = db.prepare(`
  INSERT INTO cache_entries (key, value, expires_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
`)

export function getCached(key) {
  const row = getStmt.get(key)
  if (!row) return null
  if (Date.now() > row.expires_at) return null
  return JSON.parse(row.value)
}

export function setCached(key, value, ttlMs) {
  upsertStmt.run(key, JSON.stringify(value), Date.now() + ttlMs)
}
