import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
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
import { getImdbDataForTmdbSeries } from './imdb.js'
import { buildPersonImpact } from './cast.js'
import { buildBenchmark } from './benchmark.js'
import { getTurkishLearningIndex } from './turkish-learning-interest.js'
import { getRegionalInterest } from './regional-interest.js'
import { getDuolingoTurkishStats } from './duolingo.js'
import { fetchAndAnalyzeSentiment, getMediaSentimentForSeries } from './services/newsSentiment.js'
import { calculateCountryCompositeScore } from './services/countryScoringEngine.js'
import { calculateShareOfSearch, getRegionalBreakdown } from './services/trendsShareOfSearch.js'
import { cacheFirstSerpApi, fetchTrendsTimeSeriesRaw, timeSeriesCacheKey, TIMESERIES_TTL_MS } from './services/serpApiCache.js'
import { getEnrichmentTargets } from './services/enrichmentTargets.js'
import { getSeriesTrendInsight } from './services/seriesTrendInsight.js'
import { enrichSeriesNewsNow } from './services/autoNewsScheduler.js'
import { enrichSeriesSocialNow } from './services/socialEnricher.js'
import { getCached } from './cache.js'
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

// Genel /api/* koruması — önceden SADECE giriş/kayıt sınırlıydı, geri kalan onlarca uç
// (görünürlük verisi, SerpAPI'ye dayalı sorgular, admin işlemleri...) hiç sınırsızdı. Bu limit
// loginLimiter/registerLimiter'ın YERİNE değil, ÜSTÜNE gelir (express-rate-limit middleware'leri
// aynı rotada üst üste yığılabilir) — /api/auth/login hem bu genel limite hem kendi çok daha sıkı
// limitine tabi olur, ikisi çakışmaz. Eşik gerçek kullanımı (ör. ComparisonView.jsx'in "Karşılaştır"
// tıklamasında art arda ~8-10 istek atması) sıkıştırmayacak kadar geniş tutuldu — amaç normal
// yoğun kullanımı değil, otomatik/kötüye kullanım trafiğini frenlemek.
const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.' },
})
app.use('/api', generalApiLimiter)

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

// T.C. Kültür ve Turizm Bakanlığı (YİGM) sınır bülteninden otomatik çekilen turist giriş
// verisinin ham, ülke bazlı listesi — src/components/ContinentSidebar.jsx kıtaya göre süzüyor
// (bkz. findTopLearningCountry ile aynı client-side filtre deseni).
app.get('/api/tourism-summary', (req, res) => {
  try {
    res.json({ items: getAllLatestArrivals() })
  } catch (err) {
    console.error('[tourism-summary] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

// CountryPanel'deki "Yayındaki diziler" listesinin Aylık/Yıllık/5 Yıllık dönemlere göre
// yeniden sıralanabilmesi için — tüm dizilerin (tmdb_id) o dönemdeki ortalama popülerliğini
// döner, ülkeye göre süzme client-side yapılır (bkz. server/series-period-history.js).
app.get('/api/series-popularity', (req, res) => {
  try {
    const range = ['monthly', 'yearly', '5yearly'].includes(req.query.range) ? req.query.range : 'monthly'
    const map = getSeriesPopularityMap(range)
    res.json({ range, items: Object.fromEntries(map) })
  } catch (err) {
    console.error('[series-popularity] hata:', err.message)
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

// İnsan override'ını siler, kaydı LLM'in orijinal sınıflandırmasına döndürür — Analist
// Paneli'ndeki "AI önerisine geri dön" eylemi.
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
  res.json({ destinations: DESTINATIONS.map((d) => ({ id: d.id, name: d.name })) })
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

// İnsan etiketini siler, kaydı sinopsis bazlı otomatik tespite döndürür — Analist
// Paneli'ndeki "AI önerisine geri dön" eylemi. setHumanTags(id, []) ile KARIŞTIRILMAMALI:
// o "insan sıfır destinasyon onayladı" demek, bu ise "hiç insan onayı yok" demek (bkz.
// destinations.js clearHumanTags).
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

app.get('/api/trends/series', async (req, res) => {
  try {
    const raw = await getRawSeriesDataCached()
    res.json({ items: raw.series.map((s) => ({ id: s.id, name: s.name })) })
  } catch (err) {
    console.error('[trends/series] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

// TrendsExplorer.jsx — Kıyaslama Modu. En fazla 5 (arayüz 3'e sınırlıyor) dizinin göreceli
// arama payı, KÜRESEL (geo verilmez — bkz. trendsShareOfSearch.js'teki iso2 genellemesi).
// DİKKAT: bu route'un aşağıdaki /api/trends/:seriesName'den ÖNCE tanımlı olması ZORUNLU —
// Express route'ları kayıt SIRASINA göre eşleştirir, sonra tanımlansaydı ":seriesName" joker
// deseni "share-of-search"i sahte bir dizi adı sanıp önce yakalardı (gerçek bir bug olarak
// yaşandı: SerpAPI'nin "share-of-search" diye bir dizi bulamaması gibi yanıltıcı bir hataya yol
// açıyordu — aynı sebeple /api/trends/timeseries/:seriesName da spesifik önce gelmeli).
app.get('/api/trends/share-of-search', async (req, res) => {
  try {
    const titles = String(req.query.titles || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const data = await calculateShareOfSearch(null, titles)
    res.json(data)
  } catch (err) {
    console.error('[trends/share-of-search] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

// ComparisonView.jsx — "Bölgesel Üstünlük". Aynı sebeple (yukarıdaki not) /api/trends/:seriesName'
// den ÖNCE tanımlı.
app.get('/api/trends/regional-breakdown', async (req, res) => {
  try {
    const titles = String(req.query.titles || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const data = await getRegionalBreakdown(titles)
    res.json(data)
  } catch (err) {
    console.error('[trends/regional-breakdown] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

// TrendsExplorer.jsx — Küresel 12 Aylık Trend Çizgisi. Tek dizi, geo verilmez (dünya geneli
// haftalık arama hacmi) — bkz. serpApiCache.js'teki fetchTrendsTimeSeriesRaw'ın iso2-opsiyonel hâli.
// Aynı gerekçeyle (yukarıdaki not) /api/trends/:seriesName'den ÖNCE tanımlı.
app.get('/api/trends/timeseries/:seriesName', async (req, res) => {
  try {
    const key = timeSeriesCacheKey(req.params.seriesName, null, 'today 12-m')
    const data = await cacheFirstSerpApi(key, TIMESERIES_TTL_MS, () =>
      fetchTrendsTimeSeriesRaw(req.params.seriesName, null, 'today 12-m')
    )
    res.json(data)
  } catch (err) {
    console.error('[trends/timeseries] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

// TrendsExplorer.jsx — zaman serisi grafiğinin altındaki AI yorumu. Yukarıdaki /api/trends/
// timeseries/:seriesName ile AYNI cache anahtarını (timeSeriesCacheKey) kullanır — o rota zaten
// çağrılmışsa burada YENİDEN bir SerpAPI isteği atılmaz, sadece LLM katmanı eklenir. Aynı
// gerekçeyle (yukarıdaki not) /api/trends/:seriesName'den ÖNCE tanımlı.
app.get('/api/trends/insight/:seriesName', async (req, res) => {
  try {
    const seriesName = req.params.seriesName
    const key = timeSeriesCacheKey(seriesName, null, 'today 12-m')
    const timeseries = await cacheFirstSerpApi(key, TIMESERIES_TTL_MS, () =>
      fetchTrendsTimeSeriesRaw(seriesName, null, 'today 12-m')
    )
    const data = await getSeriesTrendInsight(seriesName, timeseries.timeline)
    res.json(data)
  } catch (err) {
    console.error('[trends/insight] hata:', err.message)
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

// TrendsExplorer.jsx — "Gelişmiş Medya & Sosyal Taramayı Çalıştır". Mevcut haftalık toplu işlerin
// (autoNewsScheduler/socialEnricher) TEK bir dizi + en görünür 15 ülke için anlık, kullanıcı
// tetiklemeli versiyonu — aynı fetch/cache fonksiyonlarını çağırır, yeni bir mantık YOK. SerpAPI
// kotası harcadığı için (en fazla 15×3 = 45 gerçek çağrı) yöneticiyle sınırlı.
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
    // Sıralı (paralel DEĞİL) — ikisi de aynı paylaşılan aylık SerpAPI bütçe sayacını kontrol
    // edip artırıyor (bkz. serpApiCache.js), paralel çalıştırılırsa iki döngü birbirinin
    // kontrolünü geçersiz kılıp bütçeyi hafifçe aşabilir (aynı sebep scheduler.js'in 3 haftalık
    // işi de sıralı çalıştırmasının nedeni).
    const news = await enrichSeriesNewsNow(seriesId, series.name, topCountries)
    const social = await enrichSeriesSocialNow(series.name, topCountries)
    res.json({ ok: true, seriesId, seriesName: series.name, countriesTargeted: topCountries.length, news, social })
  } catch (err) {
    console.error('[series/enrich-now] hata:', err.message)
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

// data-pipeline-python/batch_run.py'nin ürettiği Dizilah topluluk puanı + IMDb ülke
// bazlı yerelleştirilmiş isim verisi — pipeline hiç çalıştırılmamışsa ya da bu dizi
// için veri yoksa (services/pipelineData.js) dürüstçe { dizilah: null, imdb: null }
// döner, hata fırlatmaz.
app.get('/api/series-enrichment/:tmdbId', (req, res) => {
  try {
    const data = getSeriesEnrichment(Number(req.params.tmdbId))
    res.json(data || { dizilah: null, imdb: null })
  } catch (err) {
    console.error('[series-enrichment] hata:', err.message)
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

// Proje raporu §4.6 "Basın/Haber Duygu Analizi" — dizi ve ülke bazlı duygu oranları, baskın
// ton, LLM'in kurumsal Türkçe özeti ve son 5 haber künyesi. seriesId TMDB kimliği; dizi adı
// canlı raw-series-providers önbelleğinden çözülür (data-pipeline.js'in doldurduğu, bkz.
// server/data-pipeline.js) — bu önbellek henüz hiç dolmamışsa (uygulama az önce başladıysa)
// dürüstçe 404 döneriz, uydurma bir isimle SerpAPI'ye gitmeyiz. Bu kod tabanında henüz o
// ülkeye özel yerelleştirilmiş bir dizi adı kaynağı yok (bkz. data-pipeline-python'daki AYRI
// imdb_localized_titles, Node tarafından erişilemiyor) — localTitle bilerek null geçilir,
// fetchAndAnalyzeSentiment bu durumda dürüstçe seriesName'e düşer.
app.get('/api/media-sentiment/:seriesId/:iso2', async (req, res) => {
  try {
    const seriesId = Number(req.params.seriesId)
    const rawSeries = getCached('raw-series-providers')
    const series = rawSeries?.series?.find((s) => s.id === seriesId)
    if (!series) {
      res.status(404).json({ error: `${seriesId} kimlikli dizi için canlı veri bulunamadı` })
      return
    }
    const data = await fetchAndAnalyzeSentiment(seriesId, series.name, null, req.params.iso2)
    res.json(data)
  } catch (err) {
    console.error('[media-sentiment] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

// TrendsExplorer.jsx — Tekli Analiz'in "Küresel Ayak İzi & Medya Algısı" bloğu. Yukarıdaki
// /api/media-sentiment/:seriesId/:iso2 TEK bir ülke içindir (tetiklemeli) — burası o ana kadar
// taranmış TÜM ülkelerin bu dizi için özetidir, senkron SQLite okuması (yeni bir SerpAPI çağrısı
// YAPMAZ, sadece var olan kayıtları özetler).
app.get('/api/media-sentiment-summary/:seriesId', (req, res) => {
  try {
    const data = getMediaSentimentForSeries(Number(req.params.seriesId))
    res.json(data)
  } catch (err) {
    console.error('[media-sentiment-summary] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

// TrendsExplorer.jsx — Tekli Analiz'in "Dizi Başlık & Tema Bloğu". Poster/yayın tarihi/özet
// raw-series-providers önbelleğinden (ülkeden bağımsız, bkz. /api/media-sentiment üstündeki aynı
// desen), tema getThemeStore'dan, bölüm sayısı (varsa) offline pipeline'dan (getSeriesEnrichment) —
// pipeline hiç çalıştırılmamışsa dürüstçe null, uydurma bir sayı üretilmez.
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
    res.status(502).json({ error: err.message })
  }
})

// Proje raporu — TMDB'nin tek küresel popülerlik skoruna bağımlılığı azaltan 4 faktörlü
// (Share of Search %40, Netflix Top 10 %30, Basın Algısı %15, Yayın Varlığı %15) ülke
// liderlik tablosu (bkz. server/services/countryScoringEngine.js). Share of Search canlı bir
// SerpAPI çağrısı gerektirdiği için (cache-first olsa da ilk seferinde kota harcar) diğer
// GET uçları gibi anlık değil — bu yüzden burada da aynı honest-502 deseni korunuyor.
app.get('/api/country-leaderboard/:iso2', async (req, res) => {
  try {
    const data = await calculateCountryCompositeScore(req.params.iso2)
    res.json(data)
  } catch (err) {
    console.error('[country-leaderboard] hata:', err.message)
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

// "Etki & İhracat Analizi" ekranının 3 sekmesi (Kültürel/Turizm/İhracat) — /api/impact geriye
// dönük uyumluluk için aynen duruyor, ama yeni önyüz (ImpactAnalysisTabs.jsx) artık sadece
// aktif sekmenin ihtiyaç duyduğu veriyi çekiyor.
app.get('/api/impact/cultural', (req, res) => {
  try {
    res.json(buildCulturalImpact())
  } catch (err) {
    console.error('[impact/cultural] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/impact/tourism', async (req, res) => {
  try {
    const { data, raw, destinationStore } = await getEnrichedVisibility()
    const destinationRanking = buildDestinationRanking(data.countries, raw.series, destinationStore)
    res.json(await buildTourismImpact(data.countries, destinationRanking))
  } catch (err) {
    console.error('[impact/tourism] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/impact/export', async (req, res) => {
  try {
    const { data } = await getEnrichedVisibility()
    res.json(await buildExportImpact(data.countries))
  } catch (err) {
    console.error('[impact/export] hata:', err.message)
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
