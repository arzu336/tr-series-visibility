import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import { buildVisibilityData } from './tmdb.js'
import { getCached, setCached } from './cache.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '.env') })
const CACHE_KEY = 'visibility'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 saat

const app = express()
app.use(cors())

app.get('/api/visibility', async (req, res) => {
  try {
    const cached = getCached(CACHE_KEY)
    if (cached) {
      res.set('X-Cache', 'HIT')
      return res.json(cached)
    }

    const data = await buildVisibilityData()
    setCached(CACHE_KEY, data, CACHE_TTL_MS)
    res.set('X-Cache', 'MISS')
    res.json(data)
  } catch (err) {
    console.error('[visibility] hata:', err.message)
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
