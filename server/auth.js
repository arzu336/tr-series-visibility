import crypto from 'node:crypto'
import db from './db.js'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const COOKIE_NAME = 'gp_session'

const insertStmt = db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
const selectStmt = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
const deleteStmt = db.prepare('DELETE FROM sessions WHERE token = ?')
const deleteByUserStmt = db.prepare('DELETE FROM sessions WHERE user_id = ?')
const deleteExpiredStmt = db.prepare('DELETE FROM sessions WHERE expires_at < ?')

// Veritabanında token'ın kendisi değil SHA-256 özeti durur: app.db sızarsa (yedek, hata
// çıktısı, salt-okunur erişim) satırlar oturum çalmaya yaramaz. Token rastgele 192 bit olduğu
// için tuz/yavaş hash gereksiz — kaba kuvvetle bulunacak bir şey yok, korunan şey düz metnin
// kendisi. Çerezde hâlâ ham token gider; sunucu her okuyuşta özetler.
const RAW_TOKEN_BYTES = 24
const LEGACY_RAW_TOKEN_LENGTH = RAW_TOKEN_BYTES * 2 // eski düz metin satırlar 48 hex karakter

export function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

// Tek seferlik geçiş: düz metin saklanmış eski oturumlar özetlenir, kullanıcılar yeniden giriş
// yapmak zorunda kalmaz. Özetlenmiş satırlar 64 karakter olduğu için ayrım nettir.
const legacyRowsStmt = db.prepare(`SELECT token FROM sessions WHERE length(token) = ${LEGACY_RAW_TOKEN_LENGTH}`)
const rehashStmt = db.prepare('UPDATE sessions SET token = ? WHERE token = ?')
export function migrateLegacyPlaintextSessions() {
  const rows = legacyRowsStmt.all()
  for (const row of rows) rehashStmt.run(hashSessionToken(row.token), row.token)
  return rows.length
}
migrateLegacyPlaintextSessions()

export function createSession(userId) {
  const token = crypto.randomBytes(RAW_TOKEN_BYTES).toString('hex')
  insertStmt.run(hashSessionToken(token), userId, Date.now() + SESSION_TTL_MS)
  return token
}

export function getSessionUserId(token) {
  if (!token) return null
  const entry = selectStmt.get(hashSessionToken(token))
  if (!entry || Date.now() > entry.expires_at) return null
  return entry.user_id
}

export function deleteSession(token) {
  if (!token) return
  deleteStmt.run(hashSessionToken(token))
}

/** Hız sınırlayıcı için oturum bazlı anahtar — ham token'ı sınırlayıcının belleğine koymaz. */
export function sessionRateLimitKey(token) {
  return `sess:${hashSessionToken(token).slice(0, 24)}`
}

export function parseCookies(header) {
  const result = {}
  if (!header) return result
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (!key) continue
    // Bozuk yüzde kodlaması (ör. "%E0%A4%A") decodeURIComponent'i fırlatır; bu, o istemcinin
    // HER isteğini 500'e çevirirdi. Bozuk değer ham hâliyle alınır — geçersiz bir çerez zaten
    // oturum bulamayacak, 401 ile sonuçlanacak.
    try {
      result[key] = decodeURIComponent(value)
    } catch {
      result[key] = value
    }
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
