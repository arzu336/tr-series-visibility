import express from 'express'
import { getThemeStore, effectiveTheme } from '../themes.js'
import { getRawSeriesDataCached } from '../data-pipeline.js'
import { getSeriesEnrichment } from '../services/pipelineData.js'
import { queryTrends } from '../serpapi.js'
import { querySocialListening } from '../social-listening.js'
import { getImdbDataForTmdbSeries } from '../imdb.js'
import { buildPersonImpact } from '../cast.js'
import { getRegionalInterest } from '../regional-interest.js'
import { fetchAndAnalyzeSentiment, getMediaSentimentForSeries } from '../services/newsSentiment.js'
import { calculateCountryCompositeScore } from '../services/countryScoringEngine.js'
import { calculateShareOfSearch, getRegionalBreakdown } from '../services/trendsShareOfSearch.js'
import { cacheFirstSerpApi, fetchTrendsTimeSeriesRaw, timeSeriesCacheKey, TIMESERIES_TTL_MS } from '../services/serpApiCache.js'
import { getEnrichmentTargets } from '../services/enrichmentTargets.js'
import { getSeriesTrendInsight } from '../services/seriesTrendInsight.js'
import { enrichSeriesNewsNow } from '../services/autoNewsScheduler.js'
import { enrichSeriesSocialNow } from '../services/socialEnricher.js'
import { getCached } from '../cache.js'
import { isValidIso2, normalizeIso2, resolveKnownSeriesName, resolveKnownSeriesNames } from '../services/requestGuards.js'
import { countryNameFromIso2 } from '../services/countryLookup.js'
import { requireAdmin } from './auth.js'
import { upstream } from './shared.js'

// Dizi/oyuncu/ülke bazlı canlı sinyaller: arama ilgisi, sosyal dinleme, IMDb, basın algısı,
// bileşik ülke sıralaması. Ücretli dış çağrılar önbellek + kota katmanlarından geçer.
export const trendsRouter = express.Router()

function parseTitles(query) {
  return String(query || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

function liveSeriesOr404(res, seriesId) {
  const rawSeries = getCached('raw-series-providers')
  const series = rawSeries?.series?.find((s) => s.id === seriesId)
  if (!series) {
    res.status(404).json({ error: `${seriesId} kimlikli dizi için canlı veri bulunamadı` })
    return null
  }
  return series
}

// Zaman serisi çekimi iki uç tarafından paylaşılıyor (grafik + AI yorumu), aynı önbellek
// anahtarıyla — ikisi birlikte tek ücretli çağrıya mal olur.
async function timeSeriesFor(seriesName, iso2) {
  const key = timeSeriesCacheKey(seriesName, iso2, 'today 12-m')
  return cacheFirstSerpApi(key, TIMESERIES_TTL_MS, () => fetchTrendsTimeSeriesRaw(seriesName, iso2, 'today 12-m'))
}

async function resolveSeriesAndGeo(req, res) {
  const seriesName = await resolveKnownSeriesName(req.params.seriesName)
  if (!seriesName) {
    res.status(400).json({ error: 'Bilinmeyen dizi' })
    return null
  }
  const { geo } = req.query
  if (geo != null && geo !== '' && !isValidIso2(geo)) {
    res.status(400).json({ error: 'Geçersiz ülke kodu' })
    return null
  }
  return { seriesName, iso2: geo ? normalizeIso2(geo) : null }
}

trendsRouter.get(
  '/api/trends/series',
  upstream('trends/series', async (req, res) => {
    const raw = await getRawSeriesDataCached()
    res.json({ items: raw.series.map((s) => ({ id: s.id, name: s.name })) })
  })
)

trendsRouter.get(
  '/api/trends/share-of-search',
  upstream('trends/share-of-search', async (req, res) => {
    const resolved = await resolveKnownSeriesNames(parseTitles(req.query.titles))
    if (!resolved.ok) return res.status(400).json({ error: `Bilinmeyen dizi: ${resolved.unknown}` })
    res.json(await calculateShareOfSearch(null, resolved.titles))
  })
)

trendsRouter.get(
  '/api/trends/regional-breakdown',
  upstream('trends/regional-breakdown', async (req, res) => {
    const resolved = await resolveKnownSeriesNames(parseTitles(req.query.titles))
    if (!resolved.ok) return res.status(400).json({ error: `Bilinmeyen dizi: ${resolved.unknown}` })
    res.json(await getRegionalBreakdown(resolved.titles))
  })
)

trendsRouter.get(
  '/api/trends/timeseries/:seriesName',
  upstream('trends/timeseries', async (req, res) => {
    const target = await resolveSeriesAndGeo(req, res)
    if (!target) return
    res.json(await timeSeriesFor(target.seriesName, target.iso2))
  })
)

trendsRouter.get(
  '/api/trends/insight/:seriesName',
  upstream('trends/insight', async (req, res) => {
    const target = await resolveSeriesAndGeo(req, res)
    if (!target) return
    const timeseries = await timeSeriesFor(target.seriesName, target.iso2)
    const scopeLabel = target.iso2 ? `${countryNameFromIso2(target.iso2)}'daki` : null
    res.json(await getSeriesTrendInsight(target.seriesName, timeseries.timeline, scopeLabel))
  })
)

trendsRouter.get(
  '/api/trends/:seriesName',
  upstream('trends', async (req, res) => {
    const seriesName = await resolveKnownSeriesName(req.params.seriesName)
    if (!seriesName) return res.status(400).json({ error: 'Bilinmeyen dizi' })
    res.json(await queryTrends(seriesName))
  })
)

trendsRouter.get(
  '/api/social/:seriesName',
  upstream('social', async (req, res) => {
    const seriesName = await resolveKnownSeriesName(req.params.seriesName)
    if (!seriesName) return res.status(400).json({ error: 'Bilinmeyen dizi' })
    res.json(await querySocialListening(seriesName))
  })
)

trendsRouter.post(
  '/api/series/enrich-now/:id',
  requireAdmin,
  upstream('series/enrich-now', async (req, res) => {
    const seriesId = Number(req.params.id)
    const series = liveSeriesOr404(res, seriesId)
    if (!series) return
    const { topCountries } = await getEnrichmentTargets()
    const news = await enrichSeriesNewsNow(seriesId, series.name, topCountries)
    const social = await enrichSeriesSocialNow(series.name, topCountries)
    res.json({ ok: true, seriesId, seriesName: series.name, countriesTargeted: topCountries.length, news, social })
  })
)

trendsRouter.get(
  '/api/imdb/:tmdbId',
  upstream('imdb', async (req, res) => {
    // Her farklı parametre bir dış çağrı + önbellek satırı demek; TMDB kimliği pozitif tam sayıdır.
    const tmdbId = Number(req.params.tmdbId)
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || tmdbId > 2_147_483_647) {
      return res.status(400).json({ error: 'Geçersiz TMDB kimliği' })
    }
    res.json(await getImdbDataForTmdbSeries(tmdbId))
  })
)

trendsRouter.get(
  '/api/series-enrichment/:tmdbId',
  upstream('series-enrichment', (req, res) => {
    res.json(getSeriesEnrichment(Number(req.params.tmdbId)) || { dizilah: null, imdb: null })
  })
)

trendsRouter.get(
  '/api/person/:personId',
  upstream('person', async (req, res) => {
    res.json(await buildPersonImpact(req.params.personId))
  })
)

trendsRouter.get(
  '/api/regional-interest/:seriesName/:iso2',
  upstream('regional-interest', async (req, res) => {
    const seriesName = await resolveKnownSeriesName(req.params.seriesName)
    if (!seriesName) return res.status(400).json({ error: 'Bilinmeyen dizi' })
    if (!isValidIso2(req.params.iso2)) return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    res.json(await getRegionalInterest(seriesName, normalizeIso2(req.params.iso2)))
  })
)

trendsRouter.get(
  '/api/media-sentiment/:seriesId/:iso2',
  upstream('media-sentiment', async (req, res) => {
    const seriesId = Number(req.params.seriesId)
    const series = liveSeriesOr404(res, seriesId)
    if (!series) return
    if (!isValidIso2(req.params.iso2)) return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    res.json(await fetchAndAnalyzeSentiment(seriesId, series.name, null, normalizeIso2(req.params.iso2)))
  })
)

trendsRouter.get(
  '/api/media-sentiment-summary/:seriesId',
  upstream('media-sentiment-summary', (req, res) => {
    res.json(getMediaSentimentForSeries(Number(req.params.seriesId)))
  })
)

trendsRouter.get(
  '/api/series/:tmdbId',
  upstream('series', (req, res) => {
    const seriesId = Number(req.params.tmdbId)
    const series = liveSeriesOr404(res, seriesId)
    if (!series) return
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
  })
)

trendsRouter.get(
  '/api/country-leaderboard/:iso2',
  upstream('country-leaderboard', async (req, res) => {
    if (!isValidIso2(req.params.iso2)) return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    res.json(await calculateCountryCompositeScore(normalizeIso2(req.params.iso2)))
  })
)
