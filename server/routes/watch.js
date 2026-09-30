import express from 'express'
import { isValidIso2, normalizeIso2 } from '../services/requestGuards.js'
import { getWatchSignals, getSeriesGlobal, getCountrySeries } from '../services/watchSignal.js'
import { upstream } from './shared.js'

// İzlenme sinyali uçları. Ülke endeksleri /api/visibility içinde de (watchSignal alanı) gelir;
// burası tam liste, küresel dizi tablosu ve ülke içi dizi sıralaması için.
export const watchRouter = express.Router()

watchRouter.get(
  '/api/watch/countries',
  upstream('watch/countries', async (req, res) => {
    res.json(await getWatchSignals({ fresh: req.query.fresh === '1' }))
  })
)

watchRouter.get(
  '/api/watch/series-global',
  upstream('watch/series-global', async (req, res) => {
    res.json(await getSeriesGlobal())
  })
)

watchRouter.get(
  '/api/watch/country/:iso2/series',
  upstream('watch/country-series', async (req, res) => {
    if (!isValidIso2(req.params.iso2)) return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    res.json(await getCountrySeries(normalizeIso2(req.params.iso2)))
  })
)
