import './env.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import compression from 'compression'
import helmet from 'helmet'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { buildDestinationRanking } from './aggregate.js'
import {
  THEMES,
  getThemeStore,
  setHumanOverride,
  clearHumanOverride,
  effectiveTheme,
  effectiveConfidence,
} from './themes.js'
import { getRawSeriesDataCached, getEnrichedVisibility } from './data-pipeline.js'
import { startScheduler } from './scheduler.js'
import {
  getMonthlyPeriods,
  getYearlyPeriods,
  getGlobalMonthlyPeriods,
  getGlobalYearlyPeriods,
} from './period-history.js'
import { getThemeInsight } from './services/themeInsight.js'
import { getAllLatestArrivals } from './services/tourismData.js'
import { getSeriesEnrichment } from './services/pipelineData.js'
import { getSeriesPopularityMap } from './series-period-history.js'
import {
  DESTINATIONS,
  ensureDetected,
  getDestinationStore,
  setHumanTags,
  clearHumanTags,
  effectiveDestinations,
} from './destinations.js'
import { queryTrends } from './serpapi.js'
import { querySocialListening } from './social-listening.js'
import { buildImpactReport, buildCulturalImpact, buildTourismImpact, buildExportImpact } from './impact.js'
import { buildCountryConvergence } from './services/countrySummary.js'
import { sanitizeClaimsPayload } from './services/claimsGate.js'
import { generateCountryDataSummary } from './llm.js'
import { getImdbDataForTmdbSeries } from './imdb.js'
import { buildPersonImpact } from './cast.js'
import { buildBenchmark } from './benchmark.js'
import { getTurkishLearningIndex } from './turkish-learning-interest.js'
import { getRegionalInterest } from './regional-interest.js'
import { getDuolingoTurkishStats } from './duolingo.js'
import {
  fetchAndAnalyzeSentiment,
  getMediaSentimentForSeries,
  getMediaSentimentAuditRows,
  setSentimentOverride,
  clearSentimentOverride,
} from './services/newsSentiment.js'
import { calculateCountryCompositeScore } from './services/countryScoringEngine.js'
import { calculateShareOfSearch, getRegionalBreakdown } from './services/trendsShareOfSearch.js'
import { cacheFirstSerpApi, fetchTrendsTimeSeriesRaw, timeSeriesCacheKey, TIMESERIES_TTL_MS } from './services/serpApiCache.js'
import { getEnrichmentTargets } from './services/enrichmentTargets.js'
import { getSeriesTrendInsight } from './services/seriesTrendInsight.js'
import { enrichSeriesNewsNow } from './services/autoNewsScheduler.js'
import { enrichSeriesSocialNow } from './services/socialEnricher.js'
import { getCached } from './cache.js'
import { isValidIso2, normalizeIso2, resolveKnownSeriesName, resolveKnownSeriesNames } from './services/requestGuards.js'
import { countryNameFromIso2 } from './services/countryLookup.js'
import { runWithUserContext, getUserLiveCallUsage } from './services/liveCallQuota.js'
import {
  COOKIE_NAME,
  createSession,
  getSessionUserId,
  deleteSession,
  deleteSessionsForUser,
  parseCookies,
  sessionCookieHeader,
  sessionRateLimitKey,
} from './auth.js'
import {
  ensureBootstrapAdmin,
  registerUser,
  findUserByEmail,
  getUser,
  listUsers,
  setUserStatus,
  setUserAccessLevel,
  resetUserPassword,
  deleteUser,
  changeUserPassword,
  verifyPassword,
  burnPasswordVerification,
  publicUser,
} from './users.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60

const app = express()

const UPSTREAM_ERROR_MESSAGE = 'Dış veri kaynağına şu anda ulaşılamıyor. Lütfen daha sonra tekrar deneyin.'

function sendUpstreamError(res, err) {
  if (err?.status === 429) return res.status(429).json({ error: err.message })
  return res.status(502).json({ error: UPSTREAM_ERROR_MESSAGE })
}

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://image.tmdb.org'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
)

const trustProxyEnv = String(process.env.TRUST_PROXY || '').trim().toLowerCase()
if (trustProxyEnv && trustProxyEnv !== 'false' && trustProxyEnv !== '0') {
  const hop = Number(trustProxyEnv)
  app.set('trust proxy', Number.isInteger(hop) && hop > 0 ? hop : 1)
  console.log(`[server] trust proxy açık (${Number.isInteger(hop) && hop > 0 ? hop : 1} hop)`)
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const ALLOWED_ORIGINS = [process.env.APP_ORIGIN].filter(Boolean)

const LOCAL_DEV_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/

function isAllowedOrigin(origin, selfOrigins) {
  if (selfOrigins.includes(origin) || ALLOWED_ORIGINS.includes(origin)) return true
  return !IS_PRODUCTION && LOCAL_DEV_ORIGIN_RE.test(origin)
}

app.use(
  cors((req, callback) => {
    const origin = req.headers.origin
    const host = req.headers.host
    const selfOrigins = host ? [`http://${host}`, `https://${host}`] : []
    if (!origin || isAllowedOrigin(origin, selfOrigins)) {
      return callback(null, { origin: true, credentials: true })
    }
    console.warn(`[cors] Reddedilen origin: ${origin} (host: ${host || 'yok'})`)
    const err = new Error('Bu origin için CORS izni yok')
    err.status = 403
    callback(err)
  })
)
app.use(compression())
app.use(express.json())

ensureBootstrapAdmin()
startScheduler()

app.use((req, res, next) => {
  req.cookies = parseCookies(req.headers.cookie)
  next()
})

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
app.use('/api', generalApiLimiter)

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
  const passwordOk = user
    ? verifyPassword(password || '', user.passwordHash)
    : burnPasswordVerification(password)
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

app.get('/api/auth/status', (req, res) => {
  const userId = getSessionUserId(req.cookies[COOKIE_NAME])
  const user = userId ? getUser(userId) : null
  res.json({
    authenticated: Boolean(user),
    user: user ? publicUser(user) : null,
    // Günlük canlı sorgu kotası (SERPAPI_USER_DAILY_LIMIT) — kullanıcı 429 yemeden önce görebilsin.
    liveCalls: user ? getUserLiveCallUsage(userId) : null,
  })
})

app.post('/api/auth/logout', (req, res) => {
  deleteSession(req.cookies[COOKIE_NAME])
  res.setHeader('Set-Cookie', sessionCookieHeader('', 0, req))
  res.json({ ok: true })
})

app.post('/api/auth/change-password', (req, res) => {
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

app.use('/api', (req, res, next) => {
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

function requireAdmin(req, res, next) {
  const userId = getSessionUserId(req.cookies[COOKIE_NAME])
  const user = userId ? getUser(userId) : null
  if (!user?.isAdmin) {
    return res.status(403).json({ error: 'Bu işlem için Yönetici yetkisi gerekir' })
  }
  req.currentUser = user
  next()
}

app.use('/api/admin', requireAdmin)

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
    deleteSessionsForUser(req.params.id)
    res.json(publicUser(entry))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/admin/users/:id/access-level', (req, res) => {
  try {
    const { accessLevel } = req.body || {}
    const entry = setUserAccessLevel(req.params.id, accessLevel, req.currentUser.id)
    res.json(publicUser(entry))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/admin/users/:id/reset-password', (req, res) => {
  try {
    const tempPassword = resetUserPassword(req.params.id)
    deleteSessionsForUser(req.params.id)
    res.json({ tempPassword })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/admin/users/:id/delete', (req, res) => {
  try {
    deleteUser(req.params.id, req.currentUser.id)
    deleteSessionsForUser(req.params.id)
    res.json({ ok: true })
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
    sendUpstreamError(res, err)
  }
})

app.get('/api/taxonomy', (req, res) => {
  res.json({ themes: THEMES })
})

app.get('/api/history/global-periods', (req, res) => {
  try {
    const range = req.query.range === 'yearly' ? 'yearly' : 'monthly'
    const periods = range === 'yearly' ? getGlobalYearlyPeriods() : getGlobalMonthlyPeriods()
    res.json({ range, periods })
  } catch (err) {
    console.error('[history/global-periods] hata:', err.message)
    sendUpstreamError(res, err)
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
    sendUpstreamError(res, err)
  }
})

app.get('/api/tourism-summary', (req, res) => {
  try {
    res.json({ items: getAllLatestArrivals() })
  } catch (err) {
    console.error('[tourism-summary] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/series-popularity', (req, res) => {
  try {
    const range = ['monthly', 'yearly', '5yearly'].includes(req.query.range) ? req.query.range : 'monthly'
    const map = getSeriesPopularityMap(range)
    res.json({ range, items: Object.fromEntries(map) })
  } catch (err) {
    console.error('[series-popularity] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/theme-insight', async (req, res) => {
  try {
    const data = await getThemeInsight()
    res.json(data)
  } catch (err) {
    console.error('[theme-insight] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/themes', async (req, res) => {
  try {
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
  } catch (err) {
    console.error('[themes] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

function reviewerFrom(req) {
  return req.currentUser?.name || req.currentUser?.email || 'bilinmeyen kullanıcı'
}

app.post('/api/themes/:seriesId/override', requireAdmin, (req, res) => {
  try {
    const { theme } = req.body || {}
    const entry = setHumanOverride(req.params.seriesId, theme, reviewerFrom(req))
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

app.post('/api/themes/:seriesId/clear-override', requireAdmin, (req, res) => {
  try {
    const entry = clearHumanOverride(req.params.seriesId)
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
  res.json({ destinations: DESTINATIONS.map((d) => ({ id: d.id, name: d.name, keywords: d.keywords })) })
})

app.get('/api/destinations', async (req, res) => {
  try {
    const raw = await getRawSeriesDataCached()
    const liveIds = new Set(raw.series.map((s) => s.id))
    const store = await ensureDetected(raw.series)
    const list = Object.values(store)
      .filter((entry) => liveIds.has(entry.id))
      .map((entry) => {
        const destinations = effectiveDestinations(entry)
        return {
          id: entry.id,
          name: entry.name,
          overview: entry.overview,
          autoDetected: entry.autoDetected,
          detectionMethod: entry.detectionMethod,
          humanTags: entry.humanTags,
          effectiveDestinations: destinations,
          isUntagged: destinations.length === 0,
        }
      })
      .sort((a, b) => (b.isUntagged ? 1 : 0) - (a.isUntagged ? 1 : 0))
    res.json({ items: list })
  } catch (err) {
    console.error('[destinations] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.post('/api/destinations/:seriesId/override', requireAdmin, (req, res) => {
  try {
    const { destinationIds } = req.body || {}
    const entry = setHumanTags(req.params.seriesId, destinationIds, reviewerFrom(req))
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

app.post('/api/destinations/:seriesId/clear-override', requireAdmin, (req, res) => {
  try {
    const entry = clearHumanTags(req.params.seriesId)
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

app.get('/api/media-sentiment-audit', async (req, res) => {
  try {
    const raw = await getRawSeriesDataCached()
    const liveSeriesById = new Map(raw.series.map((s) => [s.id, s.name]))
    res.json({ items: getMediaSentimentAuditRows(liveSeriesById) })
  } catch (err) {
    console.error('[media-sentiment-audit] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.post('/api/media-sentiment-audit/:id/override', requireAdmin, (req, res) => {
  try {
    const { sentiment } = req.body || {}
    res.json(setSentimentOverride(req.params.id, sentiment, reviewerFrom(req)))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/media-sentiment-audit/:id/clear-override', requireAdmin, (req, res) => {
  try {
    res.json(clearSentimentOverride(req.params.id))
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
    sendUpstreamError(res, err)
  }
})

app.get('/api/trends/share-of-search', async (req, res) => {
  try {
    const rawTitles = String(req.query.titles || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const resolved = await resolveKnownSeriesNames(rawTitles)
    if (!resolved.ok) return res.status(400).json({ error: `Bilinmeyen dizi: ${resolved.unknown}` })
    const titles = resolved.titles
    const data = await calculateShareOfSearch(null, titles)
    res.json(data)
  } catch (err) {
    console.error('[trends/share-of-search] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/trends/regional-breakdown', async (req, res) => {
  try {
    const rawTitles = String(req.query.titles || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const resolved = await resolveKnownSeriesNames(rawTitles)
    if (!resolved.ok) return res.status(400).json({ error: `Bilinmeyen dizi: ${resolved.unknown}` })
    const data = await getRegionalBreakdown(resolved.titles)
    res.json(data)
  } catch (err) {
    console.error('[trends/regional-breakdown] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/trends/timeseries/:seriesName', async (req, res) => {
  try {
    const seriesName = await resolveKnownSeriesName(req.params.seriesName)
    if (!seriesName) return res.status(400).json({ error: 'Bilinmeyen dizi' })
    const { geo } = req.query
    if (geo != null && geo !== '' && !isValidIso2(geo)) {
      return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    }
    const iso2 = geo ? normalizeIso2(geo) : null
    const key = timeSeriesCacheKey(seriesName, iso2, 'today 12-m')
    const data = await cacheFirstSerpApi(key, TIMESERIES_TTL_MS, () =>
      fetchTrendsTimeSeriesRaw(seriesName, iso2, 'today 12-m')
    )
    res.json(data)
  } catch (err) {
    console.error('[trends/timeseries] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/trends/insight/:seriesName', async (req, res) => {
  try {
    const seriesName = await resolveKnownSeriesName(req.params.seriesName)
    if (!seriesName) return res.status(400).json({ error: 'Bilinmeyen dizi' })
    const { geo } = req.query
    if (geo != null && geo !== '' && !isValidIso2(geo)) {
      return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    }
    const iso2 = geo ? normalizeIso2(geo) : null
    const key = timeSeriesCacheKey(seriesName, iso2, 'today 12-m')
    const timeseries = await cacheFirstSerpApi(key, TIMESERIES_TTL_MS, () =>
      fetchTrendsTimeSeriesRaw(seriesName, iso2, 'today 12-m')
    )
    const scopeLabel = iso2 ? `${countryNameFromIso2(iso2)}'daki` : null
    const data = await getSeriesTrendInsight(seriesName, timeseries.timeline, scopeLabel)
    res.json(data)
  } catch (err) {
    console.error('[trends/insight] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/trends/:seriesName', async (req, res) => {
  try {
    const seriesName = await resolveKnownSeriesName(req.params.seriesName)
    if (!seriesName) return res.status(400).json({ error: 'Bilinmeyen dizi' })
    const data = await queryTrends(seriesName)
    res.json(data)
  } catch (err) {
    console.error('[trends] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/social/:seriesName', async (req, res) => {
  try {
    const seriesName = await resolveKnownSeriesName(req.params.seriesName)
    if (!seriesName) return res.status(400).json({ error: 'Bilinmeyen dizi' })
    const data = await querySocialListening(seriesName)
    res.json(data)
  } catch (err) {
    console.error('[social] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.post('/api/series/enrich-now/:id', requireAdmin, async (req, res) => {
  try {
    const seriesId = Number(req.params.id)
    const rawSeries = getCached('raw-series-providers')
    const series = rawSeries?.series?.find((s) => s.id === seriesId)
    if (!series) {
      res.status(404).json({ error: `${seriesId} kimlikli dizi için canlı veri bulunamadı` })
      return
    }
    const { topCountries } = await getEnrichmentTargets()
    const news = await enrichSeriesNewsNow(seriesId, series.name, topCountries)
    const social = await enrichSeriesSocialNow(series.name, topCountries)
    res.json({ ok: true, seriesId, seriesName: series.name, countriesTargeted: topCountries.length, news, social })
  } catch (err) {
    console.error('[series/enrich-now] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/imdb/:tmdbId', async (req, res) => {
  // Her farklı parametre bir dış çağrı + önbellek satırı demek; TMDB kimliği pozitif tam sayıdır,
  // gerisi 400.
  const tmdbId = Number(req.params.tmdbId)
  if (!Number.isInteger(tmdbId) || tmdbId <= 0 || tmdbId > 2_147_483_647) {
    return res.status(400).json({ error: 'Geçersiz TMDB kimliği' })
  }
  try {
    const data = await getImdbDataForTmdbSeries(tmdbId)
    res.json(data)
  } catch (err) {
    console.error('[imdb] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/series-enrichment/:tmdbId', (req, res) => {
  try {
    const data = getSeriesEnrichment(Number(req.params.tmdbId))
    res.json(data || { dizilah: null, imdb: null })
  } catch (err) {
    console.error('[series-enrichment] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/person/:personId', async (req, res) => {
  try {
    const data = await buildPersonImpact(req.params.personId)
    res.json(data)
  } catch (err) {
    console.error('[person] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/regional-interest/:seriesName/:iso2', async (req, res) => {
  try {
    const seriesName = await resolveKnownSeriesName(req.params.seriesName)
    if (!seriesName) return res.status(400).json({ error: 'Bilinmeyen dizi' })
    if (!isValidIso2(req.params.iso2)) return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    const data = await getRegionalInterest(seriesName, normalizeIso2(req.params.iso2))
    res.json(data)
  } catch (err) {
    console.error('[regional-interest] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/media-sentiment/:seriesId/:iso2', async (req, res) => {
  try {
    const seriesId = Number(req.params.seriesId)
    const rawSeries = getCached('raw-series-providers')
    const series = rawSeries?.series?.find((s) => s.id === seriesId)
    if (!series) {
      res.status(404).json({ error: `${seriesId} kimlikli dizi için canlı veri bulunamadı` })
      return
    }
    if (!isValidIso2(req.params.iso2)) return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    const data = await fetchAndAnalyzeSentiment(seriesId, series.name, null, normalizeIso2(req.params.iso2))
    res.json(data)
  } catch (err) {
    console.error('[media-sentiment] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/media-sentiment-summary/:seriesId', (req, res) => {
  try {
    const data = getMediaSentimentForSeries(Number(req.params.seriesId))
    res.json(data)
  } catch (err) {
    console.error('[media-sentiment-summary] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/series/:tmdbId', (req, res) => {
  try {
    const seriesId = Number(req.params.tmdbId)
    const rawSeries = getCached('raw-series-providers')
    const series = rawSeries?.series?.find((s) => s.id === seriesId)
    if (!series) {
      res.status(404).json({ error: `${seriesId} kimlikli dizi için canlı veri bulunamadı` })
      return
    }
    const themeEntry = getThemeStore()[String(seriesId)]
    const enrichment = getSeriesEnrichment(seriesId)
    res.json({
      id: series.id,
      name: series.name,
      posterPath: series.posterPath || null,
      firstAirDate: series.firstAirDate || null,
      overview: series.overview || '',
      theme: themeEntry ? effectiveTheme(themeEntry) : null,
      totalEpisodes: enrichment?.dizilah?.totalEpisodes ?? null,
      cast: series.cast || [],
    })
  } catch (err) {
    console.error('[series] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/country-leaderboard/:iso2', async (req, res) => {
  try {
    if (!isValidIso2(req.params.iso2)) return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    const data = await calculateCountryCompositeScore(normalizeIso2(req.params.iso2))
    res.json(data)
  } catch (err) {
    console.error('[country-leaderboard] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/duolingo-stats', async (req, res) => {
  try {
    const data = await getDuolingoTurkishStats()
    res.json(data)
  } catch (err) {
    console.error('[duolingo-stats] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/impact', requireAdmin, async (req, res) => {
  try {
    const { data, raw, destinationStore } = await getEnrichedVisibility()
    const destinationRanking = buildDestinationRanking(data.countries, raw.series, destinationStore)
    res.json(await buildImpactReport(data.countries, destinationRanking))
  } catch (err) {
    console.error('[impact] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/impact/cultural', requireAdmin, (req, res) => {
  try {
    res.json(buildCulturalImpact())
  } catch (err) {
    console.error('[impact/cultural] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/impact/tourism', requireAdmin, async (req, res) => {
  try {
    const { data, raw, destinationStore } = await getEnrichedVisibility()
    const destinationRanking = buildDestinationRanking(data.countries, raw.series, destinationStore)
    res.json(await buildTourismImpact(data.countries, destinationRanking))
  } catch (err) {
    console.error('[impact/tourism] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/impact/export', requireAdmin, async (req, res) => {
  try {
    const { data } = await getEnrichedVisibility()
    res.json(await buildExportImpact(data.countries))
  } catch (err) {
    console.error('[impact/export] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/impact/country-summary/:iso2', requireAdmin, async (req, res) => {
  try {
    if (!isValidIso2(req.params.iso2)) return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    const iso2 = normalizeIso2(req.params.iso2)
    const { data } = await getEnrichedVisibility()
    const convergence = await buildCountryConvergence(iso2, data.countries)

    const { removed } = sanitizeClaimsPayload(convergence)
    if (removed > 0) {
      console.log(`[impact/country-summary] ${iso2}: ${removed} doğrulanmamış iddia elendi`)
    }

    if (req.query.insight !== '1') return res.json(convergence)

    let llmSummary = null
    let llmError = null
    try {
      llmSummary = await generateCountryDataSummary(convergence)
    } catch (err) {
      console.error(`[impact/country-summary] ${iso2} LLM özeti üretilemedi:`, err.message)
      llmError = err.message
    }
    res.json({ ...convergence, llmSummary, llmError })
  } catch (err) {
    console.error('[impact/country-summary] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/benchmark', async (req, res) => {
  try {
    const data = await buildBenchmark()
    res.json(data)
  } catch (err) {
    console.error('[benchmark] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

app.get('/api/turkish-learning-index', async (req, res) => {
  try {
    const data = await getTurkishLearningIndex()
    res.json(data)
  } catch (err) {
    console.error('[turkish-learning-index] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

const distPath = path.join(__dirname, '..', 'dist')
app.use(
  '/map',
  express.static(path.join(distPath, 'map'), { maxAge: '30d', immutable: true })
)
app.use(express.static(distPath))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) next()
  })
})

const port = process.env.PORT || 3001
process.on('unhandledRejection', (reason) => {
  console.error('[process] yakalanmamış promise reddi:', reason instanceof Error ? reason.message : reason)
})
process.on('uncaughtException', (err) => {
  // Yakalanmamış istisnadan sonra süreç tanımsız durumdadır (yarım kalmış SQLite işlemi, açık
  // dosya tanıtıcısı, kaybolmuş timer). Devam etmek yerine günlüğe yazıp çıkılır; yeniden başlatma
  // dıştaki denetleyicinin işi (geliştirmede nodemon, üretimde systemd/pm2 — bkz. README Dağıtım).
  console.error('[process] yakalanmamış istisna, süreç kapatılıyor:', err.stack || err.message)
  setTimeout(() => process.exit(1), 300).unref()
})

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = Number.isInteger(err.status) ? err.status : 500
  console.error('[express] işlenmemiş hata:', err.message)
  if (res.headersSent) return
  res.status(status).json({ error: status === 500 ? 'Beklenmeyen bir sunucu hatası oluştu.' : err.message })
})

app.listen(port, () => {
  console.log(`Sunucu http://localhost:${port} adresinde çalışıyor`)
})
