import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import { buildDestinationRanking } from './aggregate.js'
import { THEMES, getThemeStore, setHumanOverride, effectiveTheme, effectiveConfidence } from './themes.js'
import { getRawSeriesDataCached, getEnrichedVisibility } from './data-pipeline.js'
import { startScheduler } from './scheduler.js'
import {
  getMonthlyPeriods,
  getYearlyPeriods,
  getGlobalMonthlyPeriods,
  getGlobalYearlyPeriods,
} from './period-history.js'
import { getThemeInsight } from './services/themeInsight.js'
import {
  DESTINATIONS,
  ensureDetected,
  getDestinationStore,
  setHumanTags,
  effectiveDestinations,
} from './destinations.js'
import { queryTrends } from './serpapi.js'
import { querySocialListening } from './social-listening.js'
import { buildImpactReport } from './impact.js'
import { getImdbDataForTmdbSeries } from './imdb.js'
import { buildPersonImpact } from './cast.js'
import { buildBenchmark } from './benchmark.js'
import { getTurkishLearningIndex } from './turkish-learning-interest.js'
import { getRegionalInterest } from './regional-interest.js'
import { getDuolingoTurkishStats } from './duolingo.js'
import { COOKIE_NAME, createSession, getSessionUserId, isValidSession, deleteSession, parseCookies, sessionCookieHeader } from './auth.js'
import {
  ensureBootstrapAdmin,
  registerUser,
  findUserByEmail,
  getUser,
  listUsers,
  setUserStatus,
  setUserAccessLevel,
  resetUserPassword,
  changeUserPassword,
  verifyPassword,
  publicUser,
} from './users.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '.env') })
const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60 // 7 gün

const app = express()
app.use(cors({ origin: true, credentials: true }))
// /api/visibility ~700KB ham JSON dönüyor (200 dizi × ülke başına tekrar eden
// sinopsis metni) — gzip bunu ~6-7 kata kadar küçültüyor, gerçek darboğaz
// sunucu hesaplaması değil (warm cache'te <150ms), aktarım boyutuydu.
app.use(compression())
app.use(express.json())

ensureBootstrapAdmin()
startScheduler()

app.use((req, res, next) => {
  req.cookies = parseCookies(req.headers.cookie)
  next()
})

// Şifre deneme/kayıt spam'ini sınırlar — brute-force saldırısı olmasa bile
// (ör. sızmış bir e-posta/şifre listesiyle otomatik deneme), bu limit olmadan
// hiçbir engel yoktu. IP bazlı; başarılı istekler de sayılır (basit ve yeterli).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla giriş denemesi yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.' },
})
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla kayıt denemesi yapıldı. Lütfen daha sonra tekrar deneyin.' },
})

// Kimlik doğrulama uçları her zaman erişilebilir; geri kalan tüm /api rotaları
// geçerli bir oturum ister. İsme bağlı hesaplar: kayıt olan biri admin onaylayana kadar
// "pending" kalır, giriş yapamaz.
app.post('/api/auth/register', registerLimiter, (req, res) => {
  try {
    const { name, email, role, password } = req.body || {}
    const entry = registerUser({ name, email, role, password })
    res.status(201).json({ status: entry.status })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {}
  const user = email ? findUserByEmail(email) : null
  if (!user || !verifyPassword(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'E-posta veya şifre yanlış' })
  }
  if (user.status === 'pending') {
    return res.status(403).json({ error: 'Hesabınız onay bekliyor' })
  }
  if (user.status === 'rejected') {
    return res.status(403).json({ error: 'Hesabınız onaylanmadı' })
  }
  const token = createSession(user.id)
  res.setHeader('Set-Cookie', sessionCookieHeader(token, SESSION_MAX_AGE_S))
  res.json({ ok: true })
})

app.get('/api/auth/status', (req, res) => {
  const userId = getSessionUserId(req.cookies[COOKIE_NAME])
  const user = userId ? getUser(userId) : null
  res.json({ authenticated: Boolean(user), user: user ? publicUser(user) : null })
})

app.post('/api/auth/logout', (req, res) => {
  deleteSession(req.cookies[COOKIE_NAME])
  res.setHeader('Set-Cookie', sessionCookieHeader('', 0))
  res.json({ ok: true })
})

// /auth/* öneki genel oturum-zorunlu middleware'i atladığı için (aşağıda),
// oturumu burada elle doğruluyoruz.
app.post('/api/auth/change-password', (req, res) => {
  const userId = getSessionUserId(req.cookies[COOKIE_NAME])
  if (!userId) return res.status(401).json({ error: 'Giriş gerekli' })
  try {
    const { currentPassword, newPassword } = req.body || {}
    changeUserPassword(userId, currentPassword, newPassword)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next()
  if (isValidSession(req.cookies[COOKIE_NAME])) return next()
  res.status(401).json({ error: 'Giriş gerekli' })
})

// Analist Paneli'ndeki sınıflandırma/destinasyon düzeltme ve onaylama
// fonksiyonları yalnızca Yönetici (admin) rolüne açık — Analist ve Okuyucu
// hesaplar görebilir ama kaydedemez. İstemci tarafı (nav sekmesini gizleme)
// tek başına yeterli değil, bu yüzden sunucu da aynı kısıtı uygular.
function requireAdmin(req, res, next) {
  const userId = getSessionUserId(req.cookies[COOKIE_NAME])
  const user = userId ? getUser(userId) : null
  if (!user?.isAdmin) {
    return res.status(403).json({ error: 'Bu işlem için Yönetici yetkisi gerekir' })
  }
  req.currentUser = user
  next()
}

// Sadece yöneticiler /api/admin/* rotalarına erişebilir — nav sekmesini gizlemek yeterli
// değil, sunucu tarafında da doğrulanır.
app.use('/api/admin', (req, res, next) => {
  const userId = getSessionUserId(req.cookies[COOKIE_NAME])
  const user = userId ? getUser(userId) : null
  if (!user?.isAdmin) {
    return res.status(403).json({ error: 'Yönetici yetkisi gerekli' })
  }
  req.currentUser = user
  next()
})

app.get('/api/admin/users', (req, res) => {
  res.json({ items: listUsers().map(publicUser) })
})

app.post('/api/admin/users/:id/approve', (req, res) => {
  try {
    const entry = setUserStatus(req.params.id, 'approved', req.currentUser.id)
    res.json(publicUser(entry))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/admin/users/:id/reject', (req, res) => {
  try {
    const entry = setUserStatus(req.params.id, 'rejected', req.currentUser.id)
    res.json(publicUser(entry))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/admin/users/:id/access-level', (req, res) => {
  try {
    const { accessLevel } = req.body || {}
    const entry = setUserAccessLevel(req.params.id, accessLevel)
    res.json(publicUser(entry))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// E-posta altyapısı yok — "şifremi unuttum" bu yüzden self-servis değil,
// yönetici geçici bir şifre üretip güvenli bir kanaldan iletiyor.
app.post('/api/admin/users/:id/reset-password', (req, res) => {
  try {
    const tempPassword = resetUserPassword(req.params.id)
    res.json({ tempPassword })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.get('/api/visibility', async (req, res) => {
  try {
    const { data } = await getEnrichedVisibility()
    res.json(data)
  } catch (err) {
    console.error('[visibility] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/taxonomy', (req, res) => {
  res.json({ themes: THEMES })
})

// Ay/yıl periyodu görünümü — server/period-history.js. `range` yoksa/geçersizse aylık.
app.get('/api/history/global-periods', (req, res) => {
  try {
    const range = req.query.range === 'yearly' ? 'yearly' : 'monthly'
    const periods = range === 'yearly' ? getGlobalYearlyPeriods() : getGlobalMonthlyPeriods()
    res.json({ range, periods })
  } catch (err) {
    console.error('[history/global-periods] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/history/:iso2/periods', (req, res) => {
  try {
    const range = req.query.range === 'yearly' ? 'yearly' : 'monthly'
    const iso2 = req.params.iso2.toUpperCase()
    const periods = range === 'yearly' ? getYearlyPeriods(iso2) : getMonthlyPeriods(iso2)
    res.json({ range, iso2, periods })
  } catch (err) {
    console.error('[history/:iso2/periods] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/theme-insight', async (req, res) => {
  try {
    const data = await getThemeInsight()
    res.json(data)
  } catch (err) {
    console.error('[theme-insight] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/themes', async (req, res) => {
  const raw = await getRawSeriesDataCached()
  const liveIds = new Set(raw.series.map((s) => s.id))
  const store = getThemeStore()
  const list = Object.values(store)
    .filter((entry) => liveIds.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      overview: entry.overview,
      theme: entry.theme,
      confidence: entry.confidence,
      effectiveTheme: effectiveTheme(entry),
      effectiveConfidence: effectiveConfidence(entry),
      humanOverride: entry.humanOverride,
    }))
    .sort((a, b) => a.effectiveConfidence - b.effectiveConfidence)
  res.json({ items: list })
})

app.post('/api/themes/:seriesId/override', requireAdmin, (req, res) => {
  try {
    const { theme, reviewer } = req.body || {}
    const entry = setHumanOverride(req.params.seriesId, theme, reviewer)
    res.json({
      id: entry.id,
      name: entry.name,
      overview: entry.overview,
      theme: entry.theme,
      confidence: entry.confidence,
      effectiveTheme: effectiveTheme(entry),
      effectiveConfidence: effectiveConfidence(entry),
      humanOverride: entry.humanOverride,
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.get('/api/destinations/taxonomy', (req, res) => {
  res.json({ destinations: DESTINATIONS.map((d) => ({ id: d.id, name: d.name })) })
})

app.get('/api/destinations', async (req, res) => {
  try {
    const raw = await getRawSeriesDataCached()
    const liveIds = new Set(raw.series.map((s) => s.id))
    const store = ensureDetected(raw.series)
    const list = Object.values(store)
      .filter((entry) => liveIds.has(entry.id))
      .map((entry) => {
        const destinations = effectiveDestinations(entry)
        return {
          id: entry.id,
          name: entry.name,
          overview: entry.overview,
          autoDetected: entry.autoDetected,
          humanTags: entry.humanTags,
          effectiveDestinations: destinations,
          isUntagged: destinations.length === 0,
        }
      })
      .sort((a, b) => (b.isUntagged ? 1 : 0) - (a.isUntagged ? 1 : 0))
    res.json({ items: list })
  } catch (err) {
    console.error('[destinations] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.post('/api/destinations/:seriesId/override', requireAdmin, (req, res) => {
  try {
    const { destinationIds, reviewer } = req.body || {}
    const entry = setHumanTags(req.params.seriesId, destinationIds, reviewer)
    res.json({
      id: entry.id,
      name: entry.name,
      overview: entry.overview,
      autoDetected: entry.autoDetected,
      humanTags: entry.humanTags,
      effectiveDestinations: effectiveDestinations(entry),
      isUntagged: effectiveDestinations(entry).length === 0,
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.get('/api/trends/series', async (req, res) => {
  try {
    const raw = await getRawSeriesDataCached()
    res.json({ items: raw.series.map((s) => ({ id: s.id, name: s.name })) })
  } catch (err) {
    console.error('[trends/series] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/trends/:seriesName', async (req, res) => {
  try {
    const data = await queryTrends(req.params.seriesName)
    res.json(data)
  } catch (err) {
    console.error('[trends] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/social/:seriesName', async (req, res) => {
  try {
    const data = await querySocialListening(req.params.seriesName)
    res.json(data)
  } catch (err) {
    console.error('[social] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/imdb/:tmdbId', async (req, res) => {
  try {
    const data = await getImdbDataForTmdbSeries(req.params.tmdbId)
    res.json(data)
  } catch (err) {
    console.error('[imdb] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/person/:personId', async (req, res) => {
  try {
    const data = await buildPersonImpact(req.params.personId)
    res.json(data)
  } catch (err) {
    console.error('[person] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/regional-interest/:seriesName/:iso2', async (req, res) => {
  try {
    const data = await getRegionalInterest(req.params.seriesName, req.params.iso2)
    res.json(data)
  } catch (err) {
    console.error('[regional-interest] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/duolingo-stats', async (req, res) => {
  try {
    const data = await getDuolingoTurkishStats()
    res.json(data)
  } catch (err) {
    console.error('[duolingo-stats] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/impact', async (req, res) => {
  try {
    const { data, raw, destinationStore } = await getEnrichedVisibility()
    const destinationRanking = buildDestinationRanking(data.countries, raw.series, destinationStore)
    res.json(await buildImpactReport(data.countries, destinationRanking))
  } catch (err) {
    console.error('[impact] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/benchmark', async (req, res) => {
  try {
    const data = await buildBenchmark()
    res.json(data)
  } catch (err) {
    console.error('[benchmark] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/turkish-learning-index', async (req, res) => {
  try {
    const data = await getTurkishLearningIndex()
    res.json(data)
  } catch (err) {
    console.error('[turkish-learning-index] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

// Prod: build edilmiş frontend'i de servis et
const distPath = path.join(__dirname, '..', 'dist')
app.use(express.static(distPath))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) next()
  })
})

const port = process.env.PORT || 3001
app.listen(port, () => {
  console.log(`Sunucu http://localhost:${port} adresinde çalışıyor`)
})
