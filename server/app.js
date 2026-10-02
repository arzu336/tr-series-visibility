import './env.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import compression from 'compression'
import helmet from 'helmet'
import { ensureBootstrapAdmin } from './users.js'
import { authRouter } from './routes/auth.js'
import { adminRouter } from './routes/admin.js'
import { dataRouter } from './routes/data.js'
import { analystRouter } from './routes/analyst.js'
import { trendsRouter } from './routes/trends.js'
import { impactRouter } from './routes/impact.js'
import { reportRouter } from './routes/report.js'
import { watchRouter } from './routes/watch.js'
import { chartsRouter } from './routes/charts.js'

// Uygulama kurulumu index.js'ten ayrıldı ki route testleri (supertest) sunucuyu dinlemeye almadan
// ve zamanlayıcıyı başlatmadan aynı app'i kullanabilsin. index.js: app + scheduler + listen.

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const app = express()

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Magazin kartlarının görselleri haber sitelerinin farklı CDN'lerinden gelir (alan adı listesi
        // tutulamaz); https görsellerine izin verilir. Görseller betik çalıştıramaz; script/connect kısıtlı kalır.
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
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

const trustProxyEnv = String(process.env.TRUST_PROXY || '')
  .trim()
  .toLowerCase()
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

// Sıra: auth (çerez, hız sınırı, oturum duvarı) her şeyden önce; gerisi bağımsız.
app.use(authRouter)
app.use(adminRouter)
app.use(dataRouter)
app.use(analystRouter)
app.use(trendsRouter)
app.use(impactRouter)
app.use(reportRouter)
app.use(watchRouter)
app.use(chartsRouter)

const distPath = path.join(__dirname, '..', 'dist')
app.use('/map', express.static(path.join(distPath, 'map'), { maxAge: '30d', immutable: true }))
app.use(express.static(distPath))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) next()
  })
})

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = Number.isInteger(err.status) ? err.status : 500
  console.error('[express] işlenmemiş hata:', err.message)
  if (res.headersSent) return
  res.status(status).json({ error: status === 500 ? 'Beklenmeyen bir sunucu hatası oluştu.' : err.message })
})
