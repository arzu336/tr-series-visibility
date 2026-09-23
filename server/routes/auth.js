import express from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import {
  COOKIE_NAME,
  createSession,
  getSessionUserId,
  deleteSession,
  deleteSessionsForUser,
  parseCookies,
  sessionCookieHeader,
  sessionRateLimitKey,
} from '../auth.js'
import {
  registerUser,
  findUserByEmail,
  getUser,
  changeUserPassword,
  verifyPassword,
  burnPasswordVerification,
  publicUser,
} from '../users.js'
import { runWithUserContext, getUserLiveCallUsage } from '../services/liveCallQuota.js'

const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60

// Kurum ağı tek bir NAT IP'sinden çıkar: yalnızca IP'ye dayalı sınırlar, bir kişinin 10 yanlış
// denemesiyle herkesi kilitler. Giriş sınırı IP + hedef e-posta çiftine, genel sınır oturuma
// (varsa) bağlanır; oturumsuz istekler IP'ye düşer.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').trim().toLocaleLowerCase('tr').slice(0, 200)
    return `${ipKeyGenerator(req.ip)}|${email}`
  },
  message: { error: 'Çok fazla giriş denemesi yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.' },
})
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla kayıt denemesi yapıldı. Lütfen daha sonra tekrar deneyin.' },
})
const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const token = req.cookies?.[COOKIE_NAME]
    return token ? sessionRateLimitKey(token) : ipKeyGenerator(req.ip)
  },
  message: { error: 'Çok fazla istek yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.' },
})

/** Yönetici kapısı — route bazında (`router.post(path, requireAdmin, …)`) ya da prefix bazında kullanılır. */
export function requireAdmin(req, res, next) {
  const userId = getSessionUserId(req.cookies?.[COOKIE_NAME])
  const user = userId ? getUser(userId) : null
  if (!user?.isAdmin) {
    return res.status(403).json({ error: 'Bu işlem için Yönetici yetkisi gerekir' })
  }
  req.currentUser = user
  next()
}

// Sıra önemli: çerez ayrıştırma → genel sınır → açık auth uçları → /api oturum duvarı.
// Bu router uygulamaya diğer tüm route'lardan ÖNCE takılır (bkz. index.js).
export const authRouter = express.Router()

authRouter.use((req, res, next) => {
  req.cookies = parseCookies(req.headers.cookie)
  next()
})

authRouter.use('/api', generalApiLimiter)

authRouter.post('/api/auth/register', registerLimiter, (req, res) => {
  try {
    const { name, email, role, password } = req.body || {}
    const entry = registerUser({ name, email, role, password })
    res.status(201).json({ status: entry.status })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

authRouter.post('/api/auth/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {}
  const user = email ? findUserByEmail(email) : null
  const passwordOk = user ? verifyPassword(password || '', user.passwordHash) : burnPasswordVerification(password)
  if (!passwordOk) {
    return res.status(401).json({ error: 'E-posta veya şifre yanlış' })
  }
  if (user.status === 'pending') {
    return res.status(403).json({ error: 'Hesabınız onay bekliyor' })
  }
  if (user.status === 'rejected') {
    return res.status(403).json({ error: 'Hesabınız onaylanmadı' })
  }
  const token = createSession(user.id)
  res.setHeader('Set-Cookie', sessionCookieHeader(token, SESSION_MAX_AGE_S, req))
  res.json({ ok: true })
})

authRouter.get('/api/auth/status', (req, res) => {
  const userId = getSessionUserId(req.cookies[COOKIE_NAME])
  const user = userId ? getUser(userId) : null
  res.json({
    authenticated: Boolean(user),
    user: user ? publicUser(user) : null,
    liveCalls: user ? getUserLiveCallUsage(userId) : null,
  })
})

authRouter.post('/api/auth/logout', (req, res) => {
  deleteSession(req.cookies[COOKIE_NAME])
  res.setHeader('Set-Cookie', sessionCookieHeader('', 0, req))
  res.json({ ok: true })
})

authRouter.post('/api/auth/change-password', (req, res) => {
  const userId = getSessionUserId(req.cookies[COOKIE_NAME])
  if (!userId) return res.status(401).json({ error: 'Giriş gerekli' })
  try {
    const { currentPassword, newPassword } = req.body || {}
    changeUserPassword(userId, currentPassword, newPassword)
    deleteSessionsForUser(userId)
    const token = createSession(userId)
    res.setHeader('Set-Cookie', sessionCookieHeader(token, SESSION_MAX_AGE_S, req))
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// Oturum duvarı: /api/auth/* dışındaki her /api isteği onaylı bir kullanıcı ister.
authRouter.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next()
  const userId = getSessionUserId(req.cookies[COOKIE_NAME])
  if (!userId) return res.status(401).json({ error: 'Giriş gerekli' })

  const user = getUser(userId)
  if (!user || user.status !== 'approved') {
    deleteSessionsForUser(userId)
    res.setHeader('Set-Cookie', sessionCookieHeader('', 0, req))
    return res.status(401).json({ error: 'Oturumunuz sonlandırıldı, lütfen tekrar giriş yapın' })
  }

  req.currentUser = user
  runWithUserContext(userId, next)
})
