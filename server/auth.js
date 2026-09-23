import crypto from 'node:crypto'
import db from './db.js'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const COOKIE_NAME = 'gp_session'

const insertStmt = db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
const selectStmt = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
const deleteStmt = db.prepare('DELETE FROM sessions WHERE token = ?')
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

/**
 * Denetim bulgusu O-3 — DAĞITIM ENGELİYDİ: Secure bayrağı `NODE_ENV === 'production'` şartına
 * bağlıydı. `.env.example` de `NODE_ENV=production` ile geldiği için, düz HTTP üzerinden yayınlanan
 * bir kurum içi dağıtımda sunucu 200 dönüyor ama tarayıcı `Secure` çerezi HTTP'de sessizce ATIYOR:
 * hiç kimse giriş yapamıyor ve tekrar denemeler giriş hız sınırına takılıyor. (CSP'de
 * `upgradeInsecureRequests` zaten "kurum içi HTTP dağıtımını kırmasın" diye kapalı — yani proje
 * HTTP dağıtımı destekliyor, çerez bunu desteklemiyordu.)
 *
 * Doğru bağ ortam değişkeni değil, İSTEĞİN KENDİ PROTOKOLÜ: HTTPS ise Secure eklenir, düz HTTP ise
 * eklenmez. `req.secure`, `app.set('trust proxy', …)` açıkken `X-Forwarded-Proto`'yu zaten hesaba
 * katar; başlık ayrıca elle de kontrol ediliyor ki trust proxy kapalıyken TLS sonlandıran bir
 * proxy'nin arkasında da doğru çalışsın.
 *
 * `req` verilmezse (test/çağrı yeri unutulmuş) Secure EKLENMEZ — yanlış tarafa düşmek, çerezin
 * hiç ulaşmaması yerine yalnızca HTTP'de daha zayıf olması demektir; sessiz kilitlenmeden iyidir.
 */
export function sessionCookieHeader(token, maxAgeSeconds, req) {
  const parts = [`${COOKIE_NAME}=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`]
  if (isSecureRequest(req)) parts.push('Secure')
  return parts.join('; ')
}

/** İsteğin gerçekten HTTPS üzerinden geldiği mi (doğrudan ya da TLS sonlandıran bir proxy ile). */
export function isSecureRequest(req) {
  if (!req) return false
  if (req.secure) return true
  const proto = req.headers?.['x-forwarded-proto']
  return String(proto || '').split(',')[0].trim().toLowerCase() === 'https'
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
