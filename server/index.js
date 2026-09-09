import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import compression from 'compression'
import helmet from 'helmet'
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
import { runWithUserContext } from './services/liveCallQuota.js'
import {
  COOKIE_NAME,
  createSession,
  getSessionUserId,
  isValidSession,
  deleteSession,
  deleteSessionsForUser,
  parseCookies,
  sessionCookieHeader,
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
dotenv.config({ path: path.join(__dirname, '.env') })
const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60 // 7 gün

const app = express()

// Denetim bulgusu G-12: rota içi catch blokları üst servis hata metnini (SerpAPI'nin `data.error`
// alanı, LLM'in ≤300 karakterlik ham cevap gövdesi, TMDB/OMDb durum metinleri) istemciye AYNEN
// döndürüyordu. Bu metinler iç mimariyi, sağlayıcı adlarını, kota durumunu ve bazen sorgu
// parametrelerini sızdırır. Ayrıntı SUNUCUDA loglanmaya devam ediyor (her 502 noktasında bir
// console.error var — teşhis kaybı yok); istemci tek ve genel bir mesaj görür.
// NOT: 400'ler bilerek dokunulmadı — onlar bizim kendi doğrulama mesajlarımız ("Şifre en az 8
// karakter olmalı", "Bilinmeyen dizi" gibi), kullanıcıya dönük ve kasıtlı.
const UPSTREAM_ERROR_MESSAGE = 'Dış veri kaynağına şu anda ulaşılamıyor. Lütfen daha sonra tekrar deneyin.'

// G-12 (üst servis metnini gizle) ile G-01 (kullanıcı kotası) ayrı paketlerde doğruydu ama
// BİRLİKTE bir kör nokta üretti: kota aşımı da jenerik 502'ye dönüşüyordu ve kullanıcı günlük
// sınırına ulaştığını HİÇ öğrenemiyordu — "dış kaynağa ulaşılamıyor" deyip duruyordu.
// Kota hataları `status = 429` taşır (services/liveCallQuota.js kullanıcı sınırı,
// services/serpApiCache.js aylık kurum bütçesi) ve bu mesajlar BİZE ait, kullanıcıya dönük ve
// güvenlidir — üst servisten gelen ham metin değildir, o yüzden aynen iletilir.
function sendUpstreamError(res, err) {
  if (err?.status === 429) return res.status(429).json({ error: err.message })
  return res.status(502).json({ error: UPSTREAM_ERROR_MESSAGE })
}

// Denetim bulgusu G-08: hicbir guvenlik basligi yoktu. helmet varsayilanlari (nosniff,
// X-Frame-Options: SAMEORIGIN, Referrer-Policy, HSTS, X-DNS-Prefetch-Control...) + uygulamaya
// gore ELLE daraltilmis bir CSP. Sunucu uretimde dist/'i de servis ettigi (asagida
// express.static) icin bu CSP gercek uygulama sayfasina uygulanir — bu yuzden calisma
// zamaninda gercekten yuklenen TEK dis kaynak acikca izinli:
//   - image.tmdb.org      -> dizi afisleri (img)
// Kure dokulari (unpkg) ve ulke sinirlari GeoJSON'u (GitHub raw) B-06 kapsaminda public/map/
// altina alindi; artik kendi origin'imizden geliyorlar, bu yuzden CSP'den cikarildilar.
// styleSrc'ta 'unsafe-inline': React'in style={{...}} nitelikleri; scriptSrc'ta YOK.
// upgradeInsecureRequests kapali: kurum ici HTTP dagitimini kirmasin. Cerez tarafi da bununla
// tutarli: Secure bayragi artik ISTEGIN protokolunden turetiliyor (auth.js isSecureRequest) —
// bu yorum daha once "zaten req.secure'a bagli" diyordu ama kod NODE_ENV'e bakiyordu (denetim
// O-3); iddia ile kod artik ayni.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // unpkg.com ve raw.githubusercontent.com KALDIRILDI: küre dokuları ve ülke sınırı
        // GeoJSON'u artık public/map/ altında, uygulamanın kendi origin'inden geliyor
        // (denetim B-06). Dışarıya kalan tek çalışma zamanı bağımlılığı TMDB afişleri.
        imgSrc: ["'self'", 'data:', 'blob:', 'https://image.tmdb.org'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    // COEP acilirsa CORP basligi gondermeyen capraz-origin gorseller (TMDB afisleri)
    // engellenir; kapatiyoruz.
    crossOriginEmbedderPolicy: false,
    // TMDB afisleri farkli origin'den geldigi icin same-origin degil, cross-origin kaynak
    // paylasimina izin veren varsayilan gerekli.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
)

// Ters proxy (nginx/IIS) arkasında express-rate-limit her isteği proxy'nin IP'siyle görüyordu:
// herhangi birinin 10 hatalı girişi TÜM kurumun girişini kilitliyor, 300 istek/15 dk kurum
// geneline bölünüyordu (denetim G-02/B-07 — kendi kendine DoS).
//
// Denetim bulgusu O-2: bu ayar KOŞULSUZDU ve buradaki eski yorum "proxy yoksa X-Forwarded-For
// gelmeyeceği için davranış değişmez" diyordu — bu YANLIŞ. Proxy olmadan da istemci bu başlığı
// kendisi uydurabilir; Express onu `req.ip` olarak kabul eder ve saldırgan her istekte farklı bir
// sahte IP göndererek giriş/kayıt/genel hız sınırlarının ÜÇÜNÜ de sürekli sıfırlar. Yani G-02'yi
// düzeltmek için eklenen satır, proxy'siz kurulumda G-02'nin koruduğu şeyi deliyordu.
//
// Artık dağıtım topolojisi açıkça beyan ediliyor. Varsayılan KAPALI: doğrudan çalıştırma
// (README'deki `npm start`) güvenli tarafta kalır; ters proxy arkasına konurken TRUST_PROXY=true
// verilir. Değer hop sayısı da olabilir (ör. TRUST_PROXY=2).
const trustProxyEnv = String(process.env.TRUST_PROXY || '').trim().toLowerCase()
if (trustProxyEnv && trustProxyEnv !== 'false' && trustProxyEnv !== '0') {
  // Sayı verildiyse hop sayısı, 'true' verildiyse tek hop.
  const hop = Number(trustProxyEnv)
  app.set('trust proxy', Number.isInteger(hop) && hop > 0 ? hop : 1)
  console.log(`[server] trust proxy açık (${Number.isInteger(hop) && hop > 0 ? hop : 1} hop)`)
}

// CORS artık her origin'i credential ile yansıtmıyor (denetim G-03): üretimde yalnızca
// APP_ORIGIN (+ isteğin kendi origin'i), geliştirmede yerel/LAN origin'leri. Vite dev sunucusu
// /api'yi aynı origin'den proxy'lediği için normal geliştirme akışı zaten CORS'a takılmaz; bu
// izin doğrudan tarayıcıdan başka bir origin ile bağlanan durumlar içindir.
const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const ALLOWED_ORIGINS = [process.env.APP_ORIGIN].filter(Boolean)

// Geliştirmede sabit ['http://localhost:5173', 'http://127.0.0.1:5173'] listesi çok dardı:
// Vite 5173 doluyken 5174'e düşüyor, tarayıcı bazen `[::1]` (IPv6 loopback) kullanıyor, telefondan
// test için `--host` ile LAN IP'si gerekiyor ve VS Code'un yerleşik önizleme penceresi de başka bir
// port açıyor. Bunların hepsi geçerli geliştirme senaryosu ama listede olmadıkları için 403
// alıyorlardı (canlı olarak yaşandı). Artık liste yerine DESEN: sadece loopback ve özel LAN
// aralıkları, herhangi bir portta. Genel internetteki hiçbir origin buraya uymaz.
// ÜRETİMDE (NODE_ENV=production) devrede DEĞİL — orada yalnızca APP_ORIGIN + isteğin kendi
// origin'i geçerlidir, denetim G-03'ün gerektirdiği sıkılık aynen korunur.
const LOCAL_DEV_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/

function isAllowedOrigin(origin, selfOrigins) {
  if (selfOrigins.includes(origin) || ALLOWED_ORIGINS.includes(origin)) return true
  return !IS_PRODUCTION && LOCAL_DEV_ORIGIN_RE.test(origin)
}

// DİKKAT (canlı testte yakalandı): sunucu üretimde dist/'i de servis ediyor ve Vite'ın
// ürettiği <script type="module" crossorigin> / <link crossorigin> etiketleri AYNI ORIGIN'e
// giden isteklerde bile Origin başlığı gönderir. Bu yüzden isteğin KENDİ origin'i de her
// zaman izinli olmalı — aksi halde uygulama kendi JS/CSS'ini 403 alır ve hiç açılmaz.
// Bu yüzden basit `origin` listesi yerine req'e erişebilen delege biçimi kullanılıyor.
app.use(
  cors((req, callback) => {
    const origin = req.headers.origin
    const host = req.headers.host
    const selfOrigins = host ? [`http://${host}`, `https://${host}`] : []
    // Origin başlığı olmayan istekler (curl, sunucu-sunucu) zaten tarayıcı kaynaklı
    // çapraz-site istekleri değildir, engellenmez.
    if (!origin || isAllowedOrigin(origin, selfOrigins)) {
      return callback(null, { origin: true, credentials: true })
    }
    // Red sessizdi: kullanıcı tarayıcıda "CORS izni yok" görüyor, sunucuda HANGİ origin'in
    // reddedildiğine dair hiçbir iz kalmıyordu — teşhis edilemez bir hata sınıfı.
    console.warn(`[cors] Reddedilen origin: ${origin} (host: ${host || 'yok'})`)
    const err = new Error('Bu origin için CORS izni yok')
    err.status = 403 // aşağıdaki hata middleware'i bunu 500 değil 403 olarak döndürsün
    callback(err)
  })
)
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
  // Denetim G-10: kullanıcı yoksa scrypt hiç çalışmıyor, cevap ölçülebilir şekilde daha hızlı
  // dönüyor ve bu tek başına "bu e-posta kayıtlı mı" sorusunu yanıtlıyordu. burnPasswordVerification
  // var-olmayan kullanıcı yolunda da aynı scrypt maliyetini ödetir.
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
  res.json({ authenticated: Boolean(user), user: user ? publicUser(user) : null })
})

app.post('/api/auth/logout', (req, res) => {
  deleteSession(req.cookies[COOKIE_NAME])
  res.setHeader('Set-Cookie', sessionCookieHeader('', 0, req))
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
    // Şifre değişti → eski çerezler (başka cihaz/oturum) geçersiz olmalı; mevcut istemciye
    // taze bir oturum verilir ki kullanıcı kendi kendini dışarı atmasın.
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

  // Denetim G-05: oturum satırının varlığı tek başına yeterli değildi — silinmiş, reddedilmiş
  // veya onayı geri alınmış bir kullanıcının çerezi 7 güne kadar geçerli kalıyordu. Her istekte
  // kullanıcının HÂLÂ var ve 'approved' olduğu doğrulanıyor.
  const user = getUser(userId)
  if (!user || user.status !== 'approved') {
    deleteSessionsForUser(userId)
    res.setHeader('Set-Cookie', sessionCookieHeader('', 0, req))
    return res.status(401).json({ error: 'Oturumunuz sonlandırıldı, lütfen tekrar giriş yapın' })
  }

  req.currentUser = user
  // Ücretli çağrıların kullanıcı başına günlük kotaya yazılabilmesi için (bkz.
  // services/liveCallQuota.js) — isteğin tüm asenkron zinciri bu bağlamda çalışır.
  runWithUserContext(userId, next)
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
    deleteSessionsForUser(req.params.id) // reddedilen hesabın açık oturumu kalmasın
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

// E-posta altyapısı yok — "şifremi unuttum" bu yüzden self-servis değil,
// yönetici geçici bir şifre üretip güvenli bir kanaldan iletiyor.
app.post('/api/admin/users/:id/reset-password', (req, res) => {
  try {
    const tempPassword = resetUserPassword(req.params.id)
    deleteSessionsForUser(req.params.id) // eski şifreyle açılmış oturumlar da kapansın
    res.json({ tempPassword })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// Kendi hesabını ve son yöneticiyi silmeye karşı kilit users.js deleteUser içinde (bkz. orada).
app.post('/api/admin/users/:id/delete', (req, res) => {
  try {
    deleteUser(req.params.id, req.currentUser.id)
    deleteSessionsForUser(req.params.id) // silinen kullanıcının çerezi anında geçersiz
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

// Ay/yıl periyodu görünümü — server/period-history.js. `range` yoksa/geçersizse aylık.
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

// T.C. Kültür ve Turizm Bakanlığı (YİGM) sınır bülteninden otomatik çekilen turist giriş
// verisinin ham, ülke bazlı listesi — src/components/ContinentSidebar.jsx kıtaya göre süzüyor
// (bkz. findTopLearningCountry ile aynı client-side filtre deseni).
app.get('/api/tourism-summary', (req, res) => {
  try {
    res.json({ items: getAllLatestArrivals() })
  } catch (err) {
    console.error('[tourism-summary] hata:', err.message)
    sendUpstreamError(res, err)
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

// try/catch BİLEREK: bu, projedeki tek try/catch'siz async rotaydı ve soğuk önbellekte TMDB
// hata verdiğinde (intranette egress yoksa olası) reddedilen promise Express 4 tarafından
// yutulup Node'un varsayılan --unhandled-rejections=throw davranışıyla SÜRECİ KAPATIYORDU
// (denetim bulgusu B-01). Diğer tüm rotalarla aynı desene getirildi.
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

// Denetim bulgusu G-11: `reviewer` istek gövdesinden alınıyordu — yönetici, denetim izine
// istediği ismi (ya da hiç isim vermeyip themes.js'teki 'anonim' fallback'ini) yazdırabiliyordu,
// yani kürasyon kaydı sahte doldurulabilirdi. Artık YALNIZCA oturumdan geliyor; gövdedeki alan
// tamamen yok sayılıyor. req.currentUser'ı /api middleware'i dolduruyor (bkz. G-05).
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

// keywords eklendi (Analist Paneli'nin "anahtar kelime vurgulama" özelliği için) — bu, hangi
// kelimenin bir dizinin özetinde bir destinasyonu tetiklediğini istemci tarafında vurgulayabilmek
// için kullanılıyor, hassas bir veri değil (zaten server/destinations.js'te sabit/genel).
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

// Analist Paneli'nin "Basın & Medya Algısı" denetim sekmesi — tema/destinasyon uçlarıyla aynı
// erişim modeli: listeleme herkese (canEdit'siz de) açık, düzeltme sadece Yönetici'ye.
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

// TrendsExplorer.jsx — Kıyaslama Modu. En fazla 5 (arayüz 3'e sınırlıyor) dizinin göreceli
// arama payı, KÜRESEL (geo verilmez — bkz. trendsShareOfSearch.js'teki iso2 genellemesi).
// DİKKAT: bu route'un aşağıdaki /api/trends/:seriesName'den ÖNCE tanımlı olması ZORUNLU —
// Express route'ları kayıt SIRASINA göre eşleştirir, sonra tanımlansaydı ":seriesName" joker
// deseni "share-of-search"i sahte bir dizi adı sanıp önce yakalardı (gerçek bir bug olarak
// yaşandı: SerpAPI'nin "share-of-search" diye bir dizi bulamaması gibi yanıltıcı bir hataya yol
// açıyordu — aynı sebeple /api/trends/timeseries/:seriesName da spesifik önce gelmeli).
// Aşağıdaki ücretli uçların HEPSİ, ham kullanıcı girdisini dış servise geçirmeden önce onu
// canlı dizi listesine / geçerli ISO2 listesine karşı çözümler (denetim G-01). Bilinmeyen bir
// değer 400 ile döner: ne SerpAPI çağrısı yapılır ne de o değerle yeni bir önbellek satırı açılır.
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

// ComparisonView.jsx — "Bölgesel Üstünlük". Aynı sebeple (yukarıdaki not) /api/trends/:seriesName'
// den ÖNCE tanımlı.
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

// TrendsExplorer.jsx — Küresel 12 Aylık Trend Çizgisi. Tek dizi, geo verilmez (dünya geneli
// haftalık arama hacmi) — bkz. serpApiCache.js'teki fetchTrendsTimeSeriesRaw'ın iso2-opsiyonel hâli.
// Aynı gerekçeyle (yukarıdaki not) /api/trends/:seriesName'den ÖNCE tanımlı.
app.get('/api/trends/timeseries/:seriesName', async (req, res) => {
  try {
    const seriesName = await resolveKnownSeriesName(req.params.seriesName)
    if (!seriesName) return res.status(400).json({ error: 'Bilinmeyen dizi' })
    const key = timeSeriesCacheKey(seriesName, null, 'today 12-m')
    const data = await cacheFirstSerpApi(key, TIMESERIES_TTL_MS, () =>
      fetchTrendsTimeSeriesRaw(seriesName, null, 'today 12-m')
    )
    res.json(data)
  } catch (err) {
    console.error('[trends/timeseries] hata:', err.message)
    sendUpstreamError(res, err)
  }
})

// TrendsExplorer.jsx — zaman serisi grafiğinin altındaki AI yorumu. Yukarıdaki /api/trends/
// timeseries/:seriesName ile AYNI cache anahtarını (timeSeriesCacheKey) kullanır — o rota zaten
// çağrılmışsa burada YENİDEN bir SerpAPI isteği atılmaz, sadece LLM katmanı eklenir. Aynı
// gerekçeyle (yukarıdaki not) /api/trends/:seriesName'den ÖNCE tanımlı.
app.get('/api/trends/insight/:seriesName', async (req, res) => {
  try {
    const seriesName = await resolveKnownSeriesName(req.params.seriesName)
    if (!seriesName) return res.status(400).json({ error: 'Bilinmeyen dizi' })
    const key = timeSeriesCacheKey(seriesName, null, 'today 12-m')
    const timeseries = await cacheFirstSerpApi(key, TIMESERIES_TTL_MS, () =>
      fetchTrendsTimeSeriesRaw(seriesName, null, 'today 12-m')
    )
    const data = await getSeriesTrendInsight(seriesName, timeseries.timeline)
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
    sendUpstreamError(res, err)
  }
})

app.get('/api/imdb/:tmdbId', async (req, res) => {
  try {
    const data = await getImdbDataForTmdbSeries(req.params.tmdbId)
    res.json(data)
  } catch (err) {
    console.error('[imdb] hata:', err.message)
    sendUpstreamError(res, err)
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
    if (!isValidIso2(req.params.iso2)) return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    const data = await fetchAndAnalyzeSentiment(seriesId, series.name, null, normalizeIso2(req.params.iso2))
    res.json(data)
  } catch (err) {
    console.error('[media-sentiment] hata:', err.message)
    sendUpstreamError(res, err)
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
    sendUpstreamError(res, err)
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
    sendUpstreamError(res, err)
  }
})

// Proje raporu — TMDB'nin tek küresel popülerlik skoruna bağımlılığı azaltan 4 faktörlü
// (Share of Search %40, Netflix Top 10 %30, Basın Algısı %15, Yayın Varlığı %15) ülke
// liderlik tablosu (bkz. server/services/countryScoringEngine.js). Share of Search canlı bir
// SerpAPI çağrısı gerektirdiği için (cache-first olsa da ilk seferinde kota harcar) diğer
// GET uçları gibi anlık değil — bu yüzden burada da aynı honest-502 deseni korunuyor.
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

// Etki & İhracat analizi YÖNETİCİ görünümüne alındı (arayüzde sekme yalnızca yöneticiye
// gösteriliyor). Uçların da korunması şart: yalnızca düğmeyi gizlemek, oturumu olan herkesin
// /api/impact* adreslerini doğrudan çağırabildiği anlamına gelirdi — yani görsel bir önlem.
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

// "Etki & İhracat Analizi" ekranının 3 sekmesi (Kültürel/Turizm/İhracat) — /api/impact geriye
// dönük uyumluluk için aynen duruyor, ama yeni önyüz (ImpactAnalysisTabs.jsx) artık sadece
// aktif sekmenin ihtiyaç duyduğu veriyi çekiyor.
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

// Prod: build edilmiş frontend'i de servis et
const distPath = path.join(__dirname, '..', 'dist')
// Denetim bulgusu D-16: varsayılan `maxAge: 0` ile 2 MB'lık küre dokuları ve 488 KB'lık ülke
// GeoJSON'u HER açılışta yeniden doğrulanıyordu (koşullu istek + ağ gidiş-dönüşü). Bu dosyalar
// depoya alınmış, sürüm kontrollü ve İÇERİĞİ DEĞİŞMEYEN varlıklar (bkz. public/map/) — değişmeleri
// gerekirse yeni bir dağıtımla gelirler. `immutable`, tarayıcıya "süre dolana kadar sormaya bile
// gerek yok" der; intranet gibi düşük bant genişlikli ortamda açılış maliyetini doğrudan düşürür.
app.use(
  '/map',
  express.static(path.join(distPath, 'map'), { maxAge: '30d', immutable: true })
)
// Geri kalan build çıktısı (index.html ve hash'li asset'ler) varsayılan davranışta kalır:
// index.html asla önbelleklenmemeli, hash'li dosyalar zaten adlarıyla sürümlenir.
app.use(express.static(distPath))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) next()
  })
})

const port = process.env.PORT || 3001
// Son savunma katmanı (denetim B-01/L3): yakalanmamış bir promise reddi ya da senkron
// istisna SÜRECİ KAPATMASIN — loglanır, sunucu ayakta kalır. Express'in varsayılan hata
// sayfası yerine JSON döndüren bir hata middleware'i de eklendi (istemci her zaman JSON
// bekliyor; ayrıca üretim dışında stack trace sızdırmasın diye mesaj genel tutuldu).
process.on('unhandledRejection', (reason) => {
  console.error('[process] yakalanmamış promise reddi:', reason instanceof Error ? reason.message : reason)
})
process.on('uncaughtException', (err) => {
  console.error('[process] yakalanmamış istisna:', err.message)
})

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // CORS reddi gibi BİLİNÇLİ retler kendi durum kodunu taşır (err.status) ve gerçek sebebini
  // söyleyebilir; geri kalan her şey beklenmeyen bir hatadır → 500 + genel mesaj (denetim L3:
  // üst servis hata metinleri/stack trace istemciye sızmasın).
  const status = Number.isInteger(err.status) ? err.status : 500
  console.error('[express] işlenmemiş hata:', err.message)
  if (res.headersSent) return
  res.status(status).json({ error: status === 500 ? 'Beklenmeyen bir sunucu hatası oluştu.' : err.message })
})

app.listen(port, () => {
  console.log(`Sunucu http://localhost:${port} adresinde çalışıyor`)
})
