import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import { getRawSeriesData } from './tmdb.js'
import { buildVisibility } from './aggregate.js'
import { THEMES, ensureClassified, getThemeStore, setHumanOverride, effectiveTheme, effectiveConfidence } from './themes.js'
import { queryTrends } from './serpapi.js'
import { buildImpactReport } from './impact.js'
import { getTrend, maybeRecordSnapshot, loadHistoryStore } from './history.js'
import { getCached, setCached } from './cache.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '.env') })
const RAW_CACHE_KEY = 'raw-series-providers'
const RAW_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 saat

const app = express()
app.use(cors())
app.use(express.json())

async function getRawSeriesDataCached() {
  const cached = getCached(RAW_CACHE_KEY)
  if (cached) return cached
  const data = await getRawSeriesData()
  setCached(RAW_CACHE_KEY, data, RAW_CACHE_TTL_MS)
  return data
}

app.get('/api/visibility', async (req, res) => {
  try {
    const raw = await getRawSeriesDataCached()
    const themeStore = ensureClassified(raw.series)
    const data = buildVisibility(raw, themeStore)

    const history = loadHistoryStore()
    data.countries = data.countries.map((c) => ({
      ...c,
      trend: getTrend(history, c.iso2, c.score),
      history: (history[c.iso2] || []).slice(-20),
    }))
    maybeRecordSnapshot(history, data.countries)

    res.json(data)
  } catch (err) {
    console.error('[visibility] hata:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/taxonomy', (req, res) => {
  res.json({ themes: THEMES })
})

app.get('/api/themes', (req, res) => {
  const store = getThemeStore()
  const list = Object.values(store)
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

app.post('/api/themes/:seriesId/override', (req, res) => {
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

app.get('/api/impact', (req, res) => {
  res.json(buildImpactReport())
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
