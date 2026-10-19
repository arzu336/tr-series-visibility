import crypto from 'node:crypto'
import db from './db.js'

// API anahtarları (2026-10-16, kullanıcı gereksinimi): platform verisine arayüz dışından (kurum içi başka sistemler,
// rapor otomasyonu) erişim. Anahtar `gp_` önekiyle 32 bayt rastgele; veritabanında yalnızca SHA-256 özeti durur, düz
// metin yalnızca oluşturulduğu anda bir kez gösterilir. Anahtar yalnızca OKUMA (GET) yapabilir, yönetici uçlarına
// giremez; erişim düzeyi analist. İptal edilen anahtar anında geçersizdir.

export const KEY_PREFIX = 'gp_'
const LAST_USED_THROTTLE_MS = 60 * 1000

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
  );
`)

const insertStmt = db.prepare(
  'INSERT INTO api_keys (id, name, key_hash, prefix, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'
)
const byHashStmt = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?')
const listStmt = db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC')
const touchStmt = db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
const revokeStmt = db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
const deleteStmt = db.prepare('DELETE FROM api_keys WHERE id = ?')

export function hashApiKey(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex')
}

function rowToEntry(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }
}

/** Yeni anahtar; `key` düz metin yalnızca bu dönüşte. */
export function createApiKey({ name, createdBy = null } = {}) {
  const ad = String(name || '').trim()
  if (ad.length < 2 || ad.length > 80) throw new Error('Anahtar adı 2–80 karakter olmalı')
  const key = `${KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
  const id = crypto.randomUUID()
  const prefix = key.slice(0, 11) // "gp_" + 8 karakter: listede tanımak için
  insertStmt.run(id, ad, hashApiKey(key), prefix, createdBy, new Date().toISOString())
  return { id, name: ad, prefix, key }
}

/** Başlıktaki ham anahtar → kayıt (iptal edilmemişse); yoksa null. Son kullanım dakikada bir güncellenir. */
export function resolveApiKey(raw, { now = Date.now() } = {}) {
  const key = String(raw || '').trim()
  if (!key.startsWith(KEY_PREFIX) || key.length < 20 || key.length > 200) return null
  const row = byHashStmt.get(hashApiKey(key))
  if (!row || row.revoked_at) return null
  if (!row.last_used_at || now - Date.parse(row.last_used_at) > LAST_USED_THROTTLE_MS)
    touchStmt.run(new Date(now).toISOString(), row.id)
  return rowToEntry(row)
}

/** Anahtarla gelen isteğin kullanıcı nesnesi: analist düzeyi, yönetici değil. */
export function apiKeyUser(entry) {
  return {
    id: `apikey:${entry.id}`,
    name: entry.name,
    email: null,
    role: 'api',
    status: 'approved',
    isAdmin: false,
    accessLevel: 'analyst',
    apiKey: true,
  }
}

export function listApiKeys() {
  return listStmt.all().map(rowToEntry)
}

export function revokeApiKey(id) {
  return revokeStmt.run(new Date().toISOString(), id).changes > 0
}

export function deleteApiKey(id) {
  return deleteStmt.run(id).changes > 0
}

/** Başlıklardan anahtar: `X-API-Key: gp_…` ya da `Authorization: Bearer gp_…`. */
export function apiKeyFromHeaders(headers = {}) {
  const direct = headers['x-api-key']
  if (direct) return String(direct)
  const auth = String(headers.authorization || '')
  const m = auth.match(/^Bearer\s+(gp_\S+)$/i)
  return m ? m[1] : null
}
