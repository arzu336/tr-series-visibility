import express from 'express'
import { isValidIso2, normalizeIso2 } from '../services/requestGuards.js'
import { buildCountryReport } from '../services/countryReport.js'
import { buildBriefing } from '../services/countryBriefing.js'
import { buildSeriesReport } from '../services/seriesReport.js'
import { buildGlobalReport } from '../services/globalReport.js'
import {
  buildCountryPeriodReport,
  buildSeriesPeriodReport,
  buildContinentPeriodReport,
  availableYears,
  parsePeriod,
} from '../services/yearReport.js'

// ?from=YYYY-MM&to=YYYY-MM (ya da ?year=YYYY) → dönem raporu (yalnızca o dönemin kayıtlı verisi); yoksa güncel rapor.
function periodParam(req) {
  return parsePeriod({ from: req.query.from, to: req.query.to, year: req.query.year })
}
import { requireAdmin } from './auth.js'
import { sanitizeReportPayload } from '../services/claimsGate.js'
import { direktifIceriyorMu } from '../llm.js'
import { upstream } from './shared.js'

// Ülke brifingi: tek veri kaynağı (buildCountryReport) → brifing biçimi (countryBriefing.js). Oturum açmış
// her kullanıcı aynı belgeyi görür (profil ve profil bazlı yetki 2026-10-05'te kaldırıldı).
export const reportRouter = express.Router()

reportRouter.get(
  '/api/report/country/:iso2',
  upstream('report/country', async (req, res) => {
    if (!isValidIso2(req.params.iso2)) return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    const iso2 = normalizeIso2(req.params.iso2)
    const period = periodParam(req)
    if (period) {
      const yr = await buildCountryPeriodReport(iso2, period, { useCache: req.query.fresh !== '1' })
      sanitizeReportPayload(yr, { direktifIceriyorMu })
      return res.json(yr)
    }
    const report = await buildCountryReport(iso2, { useCache: req.query.fresh !== '1' })
    const selected = buildBriefing(report)
    const { removedClaims, removedDirectives } = sanitizeReportPayload(selected, { direktifIceriyorMu })
    if (removedClaims || removedDirectives) {
      console.log(`[report] ${iso2}: ${removedClaims} doğrulanmamış iddia, ${removedDirectives} direktif elendi`)
    }
    res.json(selected)
  })
)

// Dizi raporu: öncelikli okur dağıtımcılar ve temsilcilikler; ülke brifingiyle aynı biçim ve aynı içerik kapısı.
reportRouter.get(
  '/api/report/series/:tmdbId',
  upstream('report/series', async (req, res) => {
    const id = Number(req.params.tmdbId)
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz dizi kimliği' })
    const period = periodParam(req)
    const report = period
      ? await buildSeriesPeriodReport(id, period, { useCache: req.query.fresh !== '1' })
      : await buildSeriesReport(id, { useCache: req.query.fresh !== '1' })
    if (!report) return res.status(404).json({ error: 'Dizi katalogda yok' })
    sanitizeReportPayload(report, { direktifIceriyorMu })
    res.json(report)
  })
)

// Kıta raporu: dönem verilmezse son 12 ay.
reportRouter.get(
  '/api/report/continent/:id',
  upstream('report/continent', async (req, res) => {
    const now = new Date()
    const ym = (d) => d.toISOString().slice(0, 7)
    const period = periodParam(req) || {
      from: ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1))),
      to: ym(now),
    }
    const report = await buildContinentPeriodReport(req.params.id, period, { useCache: req.query.fresh !== '1' })
    if (!report) return res.status(404).json({ error: 'Geçersiz kıta' })
    sanitizeReportPayload(report, { direktifIceriyorMu })
    res.json(report)
  })
)

reportRouter.get('/api/report/years', (req, res) => {
  res.json({ years: availableYears() })
})

// Küresel görünüm (eski "Etki analizi"): bütün ülkeleri kapsayan veriler yönetici yetkisi ister (önceki
// eski etki analizi uçlarıyla aynı kural).
reportRouter.get(
  '/api/report/global',
  requireAdmin,
  upstream('report/global', async (req, res) => {
    const report = await buildGlobalReport({ useCache: req.query.fresh !== '1' })
    sanitizeReportPayload(report, { direktifIceriyorMu })
    res.json(report)
  })
)
