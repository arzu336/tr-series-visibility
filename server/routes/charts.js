import express from 'express'
import { isValidIso2, normalizeIso2 } from '../services/requestGuards.js'
import {
  getChartsMeta,
  getGlobalTop,
  getTurkeyTv,
  getCountryCharts,
  getContinentCharts,
  getSeriesCharts,
} from '../services/charts.js'
import continentByIso2 from '../../src/data/continents.json' with { type: 'json' }
import { upstream } from './shared.js'
import { getCountryContext } from '../services/countryContext.js'

// src/lib/continents.js Vite'a özgüdür (JSON'u attribute'suz içe alır, Node'da çökertir); kıta listesi
// burada yinelenir — src/lib/continents.js'teki CONTINENTS ile aynı sıra ve adlar.
const CONTINENTS = [
  { id: 'europe', name: 'Avrupa' },
  { id: 'middle_east', name: 'Orta Doğu' },
  { id: 'latin_america', name: 'Latin Amerika' },
  { id: 'asia_pacific', name: 'Asya-Pasifik' },
  { id: 'africa', name: 'Afrika' },
  { id: 'north_america', name: 'Kuzey Amerika' },
]

// Liste uçları: hangi sağlayıcıdan gelirse gelsin aynı biçim; her yanıt `source` (kaynak + son güncelleme) taşır.
export const chartsRouter = express.Router()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const dateParam = (v) => (typeof v === 'string' && DATE_RE.test(v) ? v : undefined)

chartsRouter.get(
  '/api/charts/meta',
  upstream('charts/meta', async (req, res) => {
    res.json(await getChartsMeta())
  })
)

chartsRouter.get(
  '/api/charts/global',
  upstream('charts/global', async (req, res) => {
    res.json(await getGlobalTop({ week: dateParam(req.query.week) }))
  })
)

chartsRouter.get(
  '/api/charts/turkey-tv',
  upstream('charts/turkey-tv', async (req, res) => {
    const segment = ['Total', 'AB', '20+ABC1'].includes(req.query.segment) ? req.query.segment : 'Total'
    res.json(await getTurkeyTv({ date: dateParam(req.query.date), segment, onlySeries: req.query.onlySeries !== '0' }))
  })
)

chartsRouter.get(
  '/api/charts/country/:iso2',
  upstream('charts/country', async (req, res) => {
    if (!isValidIso2(req.params.iso2)) return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    const range = req.query.range === 'yearly' ? 'yearly' : 'monthly'
    res.json(await getCountryCharts(normalizeIso2(req.params.iso2), { week: dateParam(req.query.week), range }))
  })
)

// Yayın kataloğu olmayan ülkelerin paneli: öğrenci, basın, bağlı ülkenin listesi.
chartsRouter.get(
  '/api/country/:iso2/context',
  upstream('country/context', async (req, res) => {
    if (!isValidIso2(req.params.iso2)) return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    res.json(await getCountryContext(normalizeIso2(req.params.iso2)))
  })
)

chartsRouter.get(
  '/api/charts/continents',
  upstream('charts/continents', async (req, res) => {
    res.json({ continents: await getContinentCharts(continentByIso2, CONTINENTS) })
  })
)

chartsRouter.get(
  '/api/charts/series/:tmdbId',
  upstream('charts/series', async (req, res) => {
    const id = Number(req.params.tmdbId)
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz dizi kimliği' })
    res.json(await getSeriesCharts(id))
  })
)
