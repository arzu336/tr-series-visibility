import express from 'express'
import { requireAdmin } from './auth.js'
import { isValidIso2, normalizeIso2 } from '../services/requestGuards.js'
import { startJob } from '../services/jobs.js'
import { getCountryTv, getSeriesTv, tvGuideStatus, runTvGuideIfNeeded, setTitleMapping } from '../services/tvGuide.js'
import {
  importDistributionCsv,
  getCountrySales,
  getSeriesSales,
  distributionStatus,
} from '../services/distributionSales.js'

// Televizyon yayınları (izinli rehber toplama) ve dağıtımcı satış kayıtları.
export const tvRouter = express.Router()

tvRouter.get('/api/country/:iso2/tv', (req, res) => {
  if (!isValidIso2(req.params.iso2)) return res.status(400).json({ error: 'Geçersiz ülke kodu' })
  const iso2 = normalizeIso2(req.params.iso2)
  res.json({ airings: getCountryTv(iso2), sales: getCountrySales(iso2) })
})

tvRouter.get('/api/series/:id/tv', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz dizi kimliği' })
  res.json({ airings: getSeriesTv(id), sales: getSeriesSales(id) })
})

tvRouter.use('/api/admin/tv', requireAdmin)

tvRouter.get('/api/admin/tv', (req, res) => {
  res.json({ guide: tvGuideStatus(), sales: distributionStatus() })
})

tvRouter.post('/api/admin/tv/run', (req, res) => {
  const { job, existing } = startJob('tv-guide', () => runTvGuideIfNeeded({ force: true }), { key: 'tv-guide' })
  res.status(202).json({ job, existing, statusUrl: `/api/jobs/${job.id}` })
})

tvRouter.post('/api/admin/tv/map', (req, res) => {
  const { provider, channel, title, seriesId } = req.body || {}
  if (!provider || !channel || !title) return res.status(400).json({ error: 'provider, channel ve title gerekli' })
  const id = seriesId == null || seriesId === '' ? null : Number(seriesId)
  if (id != null && (!Number.isInteger(id) || id <= 0)) return res.status(400).json({ error: 'Geçersiz dizi kimliği' })
  if (!setTitleMapping(provider, channel, title, id)) return res.status(404).json({ error: 'Başlık bulunamadı' })
  res.json({ ok: true })
})

// Dağıtımcı satış tablosu: CSV metni gövdede ({ csv, distributor }).
tvRouter.post('/api/admin/tv/sales', express.json({ limit: '5mb' }), (req, res) => {
  const { csv, distributor } = req.body || {}
  if (!csv || !distributor) return res.status(400).json({ error: 'csv ve distributor gerekli' })
  try {
    res.json(importDistributionCsv(String(csv), String(distributor)))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})
