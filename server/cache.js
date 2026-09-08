import db from './db.js'

const getStmt = db.prepare('SELECT value, expires_at FROM cache_entries WHERE key = ?')
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

// Denetim bulgusu B-20: cache_entries'ten hiçbir zaman satır SİLİNMİYORDU. Süresi dolmuş kayıtlar
// okunmuyor (getCached zaman kontrolü yapıyor) ama diskte sonsuza kadar duruyor; içerik hash'iyle
// anahtarlanan kayıtlar (seriesTrendInsight, themeInsight) her değişimde YENİ bir satır ürettiği
// için tablo tek yönlü büyüyor. Ölçüldü: 569 satırın 103'ü zaten ölüydü.
// Ucuz ve güvenli: yalnızca süresi geçmiş satırlar silinir, taze veriye dokunulmaz.
const purgeExpiredStmt = db.prepare('DELETE FROM cache_entries WHERE expires_at < ?')

export function purgeExpiredCacheEntries(now = Date.now()) {
  return purgeExpiredStmt.run(now).changes
}
