import crypto from 'node:crypto'
import db from './db.js'

const SCRYPT_KEYLEN = 64

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
  INSERT INTO users (id, name, email, role, password_hash, status, is_admin, created_at, decided_at, decided_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const updateStatusStmt = db.prepare('UPDATE users SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?')
const updateAdminStmt = db.prepare('UPDATE users SET is_admin = ? WHERE id = ?')

function rowToEntry(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    passwordHash: row.password_hash,
    status: row.status,
    isAdmin: Boolean(row.is_admin),
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

export function setUserAdmin(id, isAdmin) {
  if (!getUser(id)) throw new Error('Kullanıcı bulunamadı')
  updateAdminStmt.run(isAdmin ? 1 : 0, id)
  return getUser(id)
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
  insertStmt.run(id, 'Yönetici', email, 'Sistem Yöneticisi', hashPassword(password), 'approved', 1, now, now, null)
  console.log(`[users] Bootstrap admin oluşturuldu: ${email}`)
}
