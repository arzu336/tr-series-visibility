import express from 'express'
import { getThemeStore, setHumanOverride, clearHumanOverride, effectiveTheme, effectiveConfidence } from '../themes.js'
import { getRawSeriesDataCached } from '../data-pipeline.js'
import { DESTINATIONS, ensureDetected, setHumanTags, clearHumanTags, effectiveDestinations } from '../destinations.js'
import { getMediaSentimentAuditRows, setSentimentOverride, clearSentimentOverride } from '../services/newsSentiment.js'
import { requireAdmin } from './auth.js'
import { upstream, badRequest } from './shared.js'

// Analist paneli: LLM etiketlerinin (tema, destinasyon, basın tonu) listelenmesi ve insan
// düzeltmesi. Okuma uçları oturumla, yazma uçları yöneticiyle korunur.
export const analystRouter = express.Router()

function reviewerFrom(req) {
  return req.currentUser?.name || req.currentUser?.email || 'bilinmeyen kullanıcı'
}

function themeView(entry) {
  return {
    id: entry.id,
    name: entry.name,
    overview: entry.overview,
    theme: entry.theme,
    confidence: entry.confidence,
    effectiveTheme: effectiveTheme(entry),
    effectiveConfidence: effectiveConfidence(entry),
    humanOverride: entry.humanOverride,
  }
}

function destinationView(entry) {
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
}

analystRouter.get(
  '/api/themes',
  upstream('themes', async (req, res) => {
    const raw = await getRawSeriesDataCached()
    const liveIds = new Set(raw.series.map((s) => s.id))
    const list = Object.values(getThemeStore())
      .filter((entry) => liveIds.has(entry.id))
      .map(themeView)
      .sort((a, b) => a.effectiveConfidence - b.effectiveConfidence)
    res.json({ items: list })
  })
)

analystRouter.post(
  '/api/themes/:seriesId/override',
  requireAdmin,
  badRequest((req, res) => {
    const { theme } = req.body || {}
    res.json(themeView(setHumanOverride(req.params.seriesId, theme, reviewerFrom(req))))
  })
)

analystRouter.post(
  '/api/themes/:seriesId/clear-override',
  requireAdmin,
  badRequest((req, res) => {
    res.json(themeView(clearHumanOverride(req.params.seriesId)))
  })
)

analystRouter.get('/api/destinations/taxonomy', (req, res) => {
  res.json({ destinations: DESTINATIONS.map((d) => ({ id: d.id, name: d.name, keywords: d.keywords })) })
})

analystRouter.get(
  '/api/destinations',
  upstream('destinations', async (req, res) => {
    const raw = await getRawSeriesDataCached()
    const liveIds = new Set(raw.series.map((s) => s.id))
    const store = await ensureDetected(raw.series)
    const list = Object.values(store)
      .filter((entry) => liveIds.has(entry.id))
      .map(destinationView)
      .sort((a, b) => (b.isUntagged ? 1 : 0) - (a.isUntagged ? 1 : 0))
    res.json({ items: list })
  })
)

analystRouter.post(
  '/api/destinations/:seriesId/override',
  requireAdmin,
  badRequest((req, res) => {
    const { destinationIds } = req.body || {}
    res.json(destinationView(setHumanTags(req.params.seriesId, destinationIds, reviewerFrom(req))))
  })
)

analystRouter.post(
  '/api/destinations/:seriesId/clear-override',
  requireAdmin,
  badRequest((req, res) => {
    res.json(destinationView(clearHumanTags(req.params.seriesId)))
  })
)

analystRouter.get(
  '/api/media-sentiment-audit',
  upstream('media-sentiment-audit', async (req, res) => {
    const raw = await getRawSeriesDataCached()
    const liveSeriesById = new Map(raw.series.map((s) => [s.id, s.name]))
    res.json({ items: getMediaSentimentAuditRows(liveSeriesById) })
  })
)

analystRouter.post(
  '/api/media-sentiment-audit/:id/override',
  requireAdmin,
  badRequest((req, res) => {
    const { sentiment } = req.body || {}
    res.json(setSentimentOverride(req.params.id, sentiment, reviewerFrom(req)))
  })
)

analystRouter.post(
  '/api/media-sentiment-audit/:id/clear-override',
  requireAdmin,
  badRequest((req, res) => {
    res.json(clearSentimentOverride(req.params.id))
  })
)
