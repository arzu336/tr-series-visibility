import crypto from 'node:crypto'
import db from './db.js'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 gün
export const COOKIE_NAME = 'gp_session'

const insertStmt = db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
const selectStmt = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
const deleteStmt = db.prepare('DELETE FROM sessions WHERE token = ?')
// Denetim G-05/G-15: kod tabanında oturumları KULLANICI bazında silen hiçbir sorgu yoktu —
// şifre değişimi, yönetici sıfırlaması, red veya silme sonrasında eski çerez 7 güne kadar
// geçerli kalıyordu. Ayrıca süresi dolan satırlar yalnızca "sunulduklarında" siliniyor,
// tablo sınırsız büyüyordu; periyodik temizlik de aşağıda.
const deleteByUserStmt = db.prepare('DELETE FROM sessions WHERE user_id = ?')
const deleteExpiredStmt = db.prepare('DELETE FROM sessions WHERE expires_at < ?')

export function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex')
  insertStmt.run(token, userId, Date.now() + SESSION_TTL_MS)
  return token
}

export function isValidSession(token) {
  if (!token) return false
  const entry = selectStmt.get(token)
  if (!entry) return false
  if (Date.now() > entry.expires_at) {
    deleteStmt.run(token)
    return false
  }
  return true
}

export function getSessionUserId(token) {
  if (!token) return null
  const entry = selectStmt.get(token)
  if (!entry || Date.now() > entry.expires_at) return null
  return entry.user_id
}

export function deleteSession(token) {
  if (!token) return
  deleteStmt.run(token)
}

export function parseCookies(header) {
  const result = {}
  if (!header) return result
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key) result[key] = decodeURIComponent(value)
  }
  return result
}

// Secure bayrağı SADECE production'da eklenir — yerel geliştirmede (http://localhost) tarayıcı
// Secure çerezleri düz HTTP üzerinden zaten KABUL ETMEZ, koşulsuz eklenseydi giriş localhost'ta
// hiç çalışmazdı. Production'da (NODE_ENV=production, gerçek dağıtım HTTPS arkasında) çerez asla
// düz HTTP'ye sızmaz.
export function sessionCookieHeader(token, maxAgeSeconds) {
  const parts = [`${COOKIE_NAME}=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`]
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  return parts.join('; ')
}

/**
 * Bir kullanıcının TÜM oturumlarını iptal eder — şifre değişimi/sıfırlama, hesabın reddedilmesi
 * veya silinmesi gibi "artık bu çerez geçerli olmamalı" anlarında çağrılır.
 * Kaç oturumun kapatıldığını döndürür (loglama/test için).
 */
export function deleteSessionsForUser(userId) {
  return deleteByUserStmt.run(userId).changes
}

/** Süresi geçmiş oturum satırlarını toplu siler (scheduler günde bir çağırır). */
export function purgeExpiredSessions(now = Date.now()) {
  return deleteExpiredStmt.run(now).changes
}
