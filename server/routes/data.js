import express from 'express'
import { THEMES } from '../themes.js'
import { getEnrichedVisibility } from '../data-pipeline.js'
import { getMonthlyPeriods, getYearlyPeriods, getGlobalMonthlyPeriods, getGlobalYearlyPeriods } from '../period-history.js'
import { getThemeInsight } from '../services/themeInsight.js'
import { getAllLatestArrivals } from '../services/tourismData.js'
import { getSeriesPopularityMap } from '../series-period-history.js'
import { buildBenchmark } from '../benchmark.js'
import { getTurkishLearningIndex } from '../turkish-learning-interest.js'
import { getDuolingoTurkishStats } from '../duolingo.js'
import { upstream } from './shared.js'

// Harita ve genel panellerin okuduğu, oturum isteyen ama yönetici gerektirmeyen veri uçları.
export const dataRouter = express.Router()

dataRouter.get(
  '/api/visibility',
  upstream('visibility', async (req, res) => {
    const { data } = await getEnrichedVisibility()
    res.json(data)
  })
)

dataRouter.get('/api/taxonomy', (req, res) => {
  res.json({ themes: THEMES })
})

dataRouter.get(
  '/api/history/global-periods',
  upstream('history/global-periods', (req, res) => {
    const range = req.query.range === 'yearly' ? 'yearly' : 'monthly'
    const periods = range === 'yearly' ? getGlobalYearlyPeriods() : getGlobalMonthlyPeriods()
    res.json({ range, periods })
  })
)

dataRouter.get(
  '/api/history/:iso2/periods',
  upstream('history/:iso2/periods', (req, res) => {
    const range = req.query.range === 'yearly' ? 'yearly' : 'monthly'
    const iso2 = req.params.iso2.toUpperCase()
    const periods = range === 'yearly' ? getYearlyPeriods(iso2) : getMonthlyPeriods(iso2)
    res.json({ range, iso2, periods })
  })
)

dataRouter.get(
  '/api/tourism-summary',
  upstream('tourism-summary', (req, res) => {
    res.json({ items: getAllLatestArrivals() })
  })
)

dataRouter.get(
  '/api/series-popularity',
  upstream('series-popularity', (req, res) => {
    const range = ['monthly', 'yearly', '5yearly'].includes(req.query.range) ? req.query.range : 'monthly'
    res.json({ range, items: Object.fromEntries(getSeriesPopularityMap(range)) })
  })
)

dataRouter.get(
  '/api/theme-insight',
  upstream('theme-insight', async (req, res) => {
    res.json(await getThemeInsight())
  })
)

dataRouter.get(
  '/api/benchmark',
  upstream('benchmark', async (req, res) => {
    res.json(await buildBenchmark())
  })
)

dataRouter.get(
  '/api/turkish-learning-index',
  upstream('turkish-learning-index', async (req, res) => {
    res.json(await getTurkishLearningIndex())
  })
)

dataRouter.get(
  '/api/duolingo-stats',
  upstream('duolingo-stats', async (req, res) => {
    res.json(await getDuolingoTurkishStats())
  })
)
