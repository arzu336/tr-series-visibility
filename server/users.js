import crypto from 'node:crypto'
import db from './db.js'

const SCRYPT_KEYLEN = 64
export const MIN_PASSWORD_LENGTH = 8
const MIN_ADMIN_PASSWORD_LENGTH = 12
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

const DUMMY_PASSWORD_HASH = hashPassword(crypto.randomBytes(32).toString('hex'))

/** Kullanıcı bulunamadığında çağrılır; her zaman false döner, amacı sadece süreyi eşitlemek. */
export function burnPasswordVerification(password) {
  verifyPassword(password || '', DUMMY_PASSWORD_HASH)
  return false
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
const deleteStmt = db.prepare('DELETE FROM users WHERE id = ?')
const promoteToAdminStmt = db.prepare(
  "UPDATE users SET is_admin = 1, access_level = 'admin', status = 'approved', decided_at = ? WHERE id = ?"
)

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
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı`)
  }
  if (findUserByEmail(email)) {
    return { status: 'pending' }
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

export function setUserAccessLevel(id, accessLevel, requestingUserId) {
  if (!ACCESS_LEVELS.includes(accessLevel)) {
    throw new Error(`Geçersiz erişim düzeyi: ${accessLevel}`)
  }
  const user = getUser(id)
  if (!user) throw new Error('Kullanıcı bulunamadı')
  const isDemotion = user.isAdmin && accessLevel !== 'admin'
  if (isDemotion) {
    if (id === requestingUserId) {
      throw new Error('Kendi yönetici yetkinizi kaldıramazsınız')
    }
    if (countAdminsStmt.get().n <= 1) {
      throw new Error('Son yönetici hesabının yetkisi kaldırılamaz')
    }
  }
  updateAccessLevelStmt.run(accessLevel, accessLevel === 'admin' ? 1 : 0, id)
  return getUser(id)
}

export function deleteUser(id, requestingUserId) {
  const user = getUser(id)
  if (!user) throw new Error('Kullanıcı bulunamadı')
  if (id === requestingUserId) {
    throw new Error('Kendi hesabınızı silemezsiniz')
  }
  if (user.isAdmin && countAdminsStmt.get().n <= 1) {
    throw new Error('Son yönetici hesabı silinemez')
  }
  deleteStmt.run(id)
}

export function resetUserPassword(id) {
  if (!getUser(id)) throw new Error('Kullanıcı bulunamadı')
  const tempPassword = crypto.randomBytes(9).toString('base64url')
  updatePasswordStmt.run(hashPassword(tempPassword), id)
  return tempPassword
}

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

export function ensureBootstrapAdmin() {
  const hasAdmin = countAdminsStmt.get().n > 0
  if (hasAdmin) return

  const password = process.env.APP_PASSWORD
  if (!password) {
    console.warn('[users] APP_PASSWORD tanımlı değil, bootstrap admin oluşturulamadı')
    return
  }
  const PLACEHOLDER_PASSWORDS = ['change_this_password', 'changeme', 'password']
  if (PLACEHOLDER_PASSWORDS.includes(password.toLowerCase())) {
    console.error('[users] APP_PASSWORD örnek/varsayılan değerde — bootstrap admin OLUŞTURULMADI. .env dosyasında gerçek bir şifre tanımlayın.')
    return
  }
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    console.error(`[users] APP_PASSWORD en az ${MIN_ADMIN_PASSWORD_LENGTH} karakter olmalı — bootstrap admin OLUŞTURULMADI.`)
    return
  }
  const email = normalizeEmail(process.env.ADMIN_EMAIL || 'admin@kurum.gov.tr')
  const now = new Date().toISOString()

  const existing = findUserByEmail(email)
  if (existing) {
    promoteToAdminStmt.run(now, existing.id)
    console.log(`[users] Yönetici kalmamıştı — mevcut hesap yeniden yönetici yapıldı: ${email}`)
    return
  }

  const id = 'usr_' + crypto.randomBytes(12).toString('hex')
  insertStmt.run(id, 'Yönetici', email, 'Sistem Yöneticisi', hashPassword(password), 'approved', 1, 'admin', now, now, null)
  console.log(`[users] Bootstrap admin oluşturuldu: ${email}`)
}
