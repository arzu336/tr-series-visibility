import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const USERS_PATH = path.join(__dirname, 'data', 'users.json')
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

function loadUsers() {
  if (!fs.existsSync(USERS_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(USERS_PATH), { recursive: true })
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf8')
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function findUserByEmail(email) {
  const users = loadUsers()
  const normalized = normalizeEmail(email)
  return Object.values(users).find((u) => u.email === normalized) || null
}

export function getUser(id) {
  const users = loadUsers()
  return users[id] || null
}

export function listUsers() {
  const users = loadUsers()
  return Object.values(users).sort((a, b) => {
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
  const users = loadUsers()
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
  users[id] = entry
  saveUsers(users)
  return entry
}

export function setUserStatus(id, status, decidedBy) {
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    throw new Error(`Geçersiz durum: ${status}`)
  }
  const users = loadUsers()
  if (!users[id]) throw new Error('Kullanıcı bulunamadı')
  users[id].status = status
  users[id].decidedAt = new Date().toISOString()
  users[id].decidedBy = decidedBy || null
  saveUsers(users)
  return users[id]
}

export function setUserAdmin(id, isAdmin) {
  const users = loadUsers()
  if (!users[id]) throw new Error('Kullanıcı bulunamadı')
  users[id].isAdmin = Boolean(isAdmin)
  saveUsers(users)
  return users[id]
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
  const users = loadUsers()
  const hasAdmin = Object.values(users).some((u) => u.isAdmin)
  if (hasAdmin) return

  const password = process.env.APP_PASSWORD
  if (!password) {
    console.warn('[users] APP_PASSWORD tanımlı değil, bootstrap admin oluşturulamadı')
    return
  }
  const email = normalizeEmail(process.env.ADMIN_EMAIL || 'admin@kurum.gov.tr')
  const id = 'usr_' + crypto.randomBytes(12).toString('hex')
  const now = new Date().toISOString()
  users[id] = {
    id,
    name: 'Yönetici',
    email,
    role: 'Sistem Yöneticisi',
    passwordHash: hashPassword(password),
    status: 'approved',
    isAdmin: true,
    createdAt: now,
    decidedAt: now,
    decidedBy: null,
  }
  saveUsers(users)
  console.log(`[users] Bootstrap admin oluşturuldu: ${email}`)
}
