import crypto from 'node:crypto'
import db from './db.js'

const SCRYPT_KEYLEN = 64
export const ACCESS_LEVELS = ['viewer', 'analyst', 'admin']

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false
  const [salt, hashHex] = stored.split(':')
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN)
  const storedBuf = Buffer.from(hashHex, 'hex')
  if (hash.length !== storedBuf.length) return false
  return crypto.timingSafeEqual(hash, storedBuf)
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

const selectByEmailStmt = db.prepare('SELECT * FROM users WHERE email = ?')
const selectByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?')
const selectAllStmt = db.prepare('SELECT * FROM users')
const countAdminsStmt = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1')
const insertStmt = db.prepare(`
  INSERT INTO users (id, name, email, role, password_hash, status, is_admin, access_level, created_at, decided_at, decided_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const updateStatusStmt = db.prepare('UPDATE users SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?')
const updateAccessLevelStmt = db.prepare('UPDATE users SET access_level = ?, is_admin = ? WHERE id = ?')
const updatePasswordStmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')

function rowToEntry(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    passwordHash: row.password_hash,
    status: row.status,
    isAdmin: Boolean(row.is_admin),
    accessLevel: row.access_level || (row.is_admin ? 'admin' : 'analyst'),
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
  }
}

export function findUserByEmail(email) {
  const row = selectByEmailStmt.get(normalizeEmail(email))
  return row ? rowToEntry(row) : null
}

export function getUser(id) {
  const row = selectByIdStmt.get(id)
  return row ? rowToEntry(row) : null
}

export function listUsers() {
  return selectAllStmt
    .all()
    .map(rowToEntry)
    .sort((a, b) => {
      const rank = (u) => (u.status === 'pending' ? 0 : 1)
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
      return new Date(b.createdAt) - new Date(a.createdAt)
    })
}

export function registerUser({ name, email, role, password }) {
  if (!name || !email || !password) {
    throw new Error('Ad, e-posta ve şifre zorunlu')
  }
  if (findUserByEmail(email)) {
    throw new Error('Bu e-posta ile zaten bir hesap var')
  }
  const id = 'usr_' + crypto.randomBytes(12).toString('hex')
  const entry = {
    id,
    name: String(name).trim(),
    email: normalizeEmail(email),
    role: role ? String(role).trim() : '',
    passwordHash: hashPassword(password),
    status: 'pending',
    isAdmin: false,
    // En az yetkiyle başlar — Analist/Yönetici düzeyi sadece bir yönetici
    // tarafından, onay sonrası elle verilir (kimse kendine yetki veremez).
    accessLevel: 'viewer',
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
  }
  insertStmt.run(
    entry.id,
    entry.name,
    entry.email,
    entry.role,
    entry.passwordHash,
    entry.status,
    0,
    entry.accessLevel,
    entry.createdAt,
    entry.decidedAt,
    entry.decidedBy
  )
  return entry
}

export function setUserStatus(id, status, decidedBy) {
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    throw new Error(`Geçersiz durum: ${status}`)
  }
  if (!getUser(id)) throw new Error('Kullanıcı bulunamadı')
  const decidedAt = new Date().toISOString()
  updateStatusStmt.run(status, decidedAt, decidedBy || null, id)
  return getUser(id)
}

export function setUserAccessLevel(id, accessLevel) {
  if (!ACCESS_LEVELS.includes(accessLevel)) {
    throw new Error(`Geçersiz erişim düzeyi: ${accessLevel}`)
  }
  if (!getUser(id)) throw new Error('Kullanıcı bulunamadı')
  updateAccessLevelStmt.run(accessLevel, accessLevel === 'admin' ? 1 : 0, id)
  return getUser(id)
}

const MIN_PASSWORD_LENGTH = 8

// E-posta altyapımız yok — "şifremi unuttum" self-servis olamıyor. Bunun yerine
// yönetici bir kullanıcı için geçici bir şifre üretir ve bunu güvenli bir
// kanaldan (yüz yüze, kurum içi mesajlaşma vb.) iletir. Düz metin şifre sadece
// bu fonksiyonun dönüş değerinde bir kez görünür, hiçbir yerde saklanmaz.
export function resetUserPassword(id) {
  if (!getUser(id)) throw new Error('Kullanıcı bulunamadı')
  const tempPassword = crypto.randomBytes(9).toString('base64url')
  updatePasswordStmt.run(hashPassword(tempPassword), id)
  return tempPassword
}

// Giriş yapmış bir kullanıcının kendi şifresini değiştirmesi — mevcut şifre
// doğrulanmadan işlem yapılmaz (oturumu ele geçiren biri şifreyi değiştirip
// gerçek kullanıcıyı dışarıda bırakamasın diye).
export function changeUserPassword(id, currentPassword, newPassword) {
  const row = selectByIdStmt.get(id)
  if (!row) throw new Error('Kullanıcı bulunamadı')
  if (!verifyPassword(currentPassword || '', row.password_hash)) {
    throw new Error('Mevcut şifre yanlış')
  }
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Yeni şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı`)
  }
  updatePasswordStmt.run(hashPassword(newPassword), id)
}

export function publicUser(entry) {
  if (!entry) return null
  const { passwordHash, ...rest } = entry
  return rest
}

// Hiç yönetici yoksa (ilk kurulum), .env'deki ADMIN_EMAIL + APP_PASSWORD ile onaylı bir
// admin hesabı oluşturur — böylece bilinen paylaşılan şifre, ilk yöneticinin şifresi olarak
// devam eder ve manuel veri girişi gerekmez.
export function ensureBootstrapAdmin() {
  const hasAdmin = countAdminsStmt.get().n > 0
  if (hasAdmin) return

  const password = process.env.APP_PASSWORD
  if (!password) {
    console.warn('[users] APP_PASSWORD tanımlı değil, bootstrap admin oluşturulamadı')
    return
  }
  const email = normalizeEmail(process.env.ADMIN_EMAIL || 'admin@kurum.gov.tr')
  const id = 'usr_' + crypto.randomBytes(12).toString('hex')
  const now = new Date().toISOString()
  insertStmt.run(id, 'Yönetici', email, 'Sistem Yöneticisi', hashPassword(password), 'approved', 1, 'admin', now, now, null)
  console.log(`[users] Bootstrap admin oluşturuldu: ${email}`)
}
