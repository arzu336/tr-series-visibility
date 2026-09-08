import crypto from 'node:crypto'
import db from './db.js'

const SCRYPT_KEYLEN = 64
// Denetim bulgusu G-06: 8 karakter kuralı yalnızca changeUserPassword'de uygulanıyordu; kayıt ve
// bootstrap tek karakterlik şifre kabul ediyordu. Artık üçü de aynı kuralı paylaşıyor.
export const MIN_PASSWORD_LENGTH = 8
// Yönetici hesabı paylaşılan/kurumsal bir kimlik bilgisi — rapor ≥ 12 öneriyor.
const MIN_ADMIN_PASSWORD_LENGTH = 12
// Denetim bulgusu G-16 — BİLİNÇLİ KARAR: `viewer` ve `analyst` bu sürümde operasyonel olarak
// ÖZDEŞTİR. Sunucu yetkilendirmesi tek bir ayrım uygular (requireAdmin, bkz. index.js); veri
// kürasyonunu değiştiren her uç doğrudan yönetici ister. İki düzeyin farkı şu an yalnızca
// etikettir — yeni bir rol karmaşası eklemek yerine bu sınır belgelenmiştir (README, "Erişim
// düzeyleri hakkında"). Ücretli dış çağrı riski erişim düzeyiyle değil, kullanıcı başına günlük
// kotayla sınırlanır (services/liveCallQuota.js).
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

// Denetim G-10 (zamanlama kanalı): kullanıcı bulunamadığında scrypt hiç çalışmıyor, cevap
// gözle görülür şekilde daha hızlı dönüyordu — bu da tek başına bir numaralandırma kanalı.
// Bu sabit hash'e karşı doğrulama yaparak var-olmayan kullanıcı yolunun da aynı scrypt
// maliyetini ödemesini sağlıyoruz. Değeri önemli değil, sadece gerçek bir hash biçiminde olmalı.
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
// bkz. ensureBootstrapAdmin — hiç yönetici kalmadığında var olan hesabı kurtarır.
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
  // Denetim G-06: kayıtta da en az 8 karakter.
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı`)
  }
  // Denetim bulgusu G-10 (kullanıcı numaralandırma): burası eskiden "Bu e-posta ile zaten bir
  // hesap var" hatası döndürüyordu — kimliği doğrulanmamış herkes, kayıt formunu deneyerek bir
  // e-postanın kurumda kayıtlı olup olmadığını öğrenebiliyordu. Artık e-posta zaten kayıtlıysa
  // İKİNCİ HESAP AÇILMAZ ama cevap yeni bir kayıtla AYNI görünür ('pending'): saldırgan iki
  // durumu ayırt edemez. Meşru kullanıcı bir şey kaybetmez — hesabı zaten var, giriş yapabilir
  // (ya da yöneticisi onu onay listesinde görür); kayıt zaten yönetici onayına tabi olduğu için
  // kendi kendine servis bir "hesabım var mı" sorgusunun bir değeri yok.
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

// deleteUser ile AYNI iki kilit (denetim bulgusu G-04): silme yolu korunuyordu ama DÜŞÜRME
// yolu açıktı — son yönetici kendini 'viewer' yapabiliyordu. Sonucu sadece kilitlenme değil,
// açılışta çökme döngüsüydü: ensureBootstrapAdmin yönetici olmadığını görüp aynı ADMIN_EMAIL
// ile INSERT deniyor, users.email UNIQUE kısıtına takılıyor ve hata index.js'te
// yakalanmadığı için süreç her açılışta kapanıyordu (o taraf da aşağıda UPSERT'e çevrildi).
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

// Başlangıçta sadece reddedilmiş kayıtlar silinebiliyordu (görsel kirlilik temizliği) —
// kullanıcı talebiyle onaylı hesaplar da (ör. artık kurumda olmayan biri) silinebilsin diye
// genişletildi. İki gerçek güvenlik kilidi kaldı:
// 1) Kendi hesabını silemezsin — oturumu açıkken kendini silmek anlık bir kilitlenmeye
//    (silinmiş bir kullanıcının session'ı hâlâ "geçerli" görünüp sonraki istekte 401'e düşmesi)
//    yol açabilir, ayrıca "yanlışlıkla kendine tıkladım" senaryosuna karşı basit bir fren.
// 2) SON yöneticiyi silemezsin — aksi halde uygulamayı yönetecek kimse kalmaz (yeni admin
//    atamak için zaten bir admin gerekir, bkz. setUserAccessLevel/requireAdmin).
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
  // Denetim G-06: `.env.example` `change_this_password` ile geliyor. app.db silinip yeniden
  // oluşturulduğunda bu örnek değer SESSİZCE yöneticinin şifresi oluyordu. Artık örnek değer ve
  // çok kısa şifreler reddediliyor — yönetici hesabı hiç açılmıyor ve sebep loglanıyor
  // (açılışı çökertmiyoruz: sunucu ayakta kalsın, operatör logu görüp .env'i düzeltsin).
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

  // E-posta zaten kayıtlıysa INSERT users.email UNIQUE kısıtına takılıp süreci çökertiyordu
  // (denetim G-04). Bu durum "hiç yönetici yok AMA bu e-posta var" demektir — yani hesap
  // düşürülmüş/reddedilmiştir; doğru kurtarma davranışı onu yeniden yönetici yapmaktır.
  // ŞİFREYE DOKUNULMAZ: var olan hesabın şifresi .env'deki APP_PASSWORD ile sessizce
  // değiştirilmez, sadece yetki/durum geri verilir.
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
