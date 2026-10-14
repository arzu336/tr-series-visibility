import db from '../db.js'
import { getEnrichedVisibility } from '../data-pipeline.js'
import { STREAMABLE_KEYS } from '../tmdb.js'
import { getSeriesCharts } from './charts.js'
import { getSeriesYoutube } from './youtubePublic.js'
import { getSeriesOnlineViews } from './onlineViews.js'
import { getMediaSentimentForSeries } from './newsSentiment.js'
import { getImdbDataForTmdbSeries } from '../imdb.js'

// Kıyaslama (2026-10-14): seçilen dizilerin eldeki bütün göstergeleri yan yana — ücretli sorgu yok, yalnızca kayıtlı
// veri. Göstergeler: platform listeleri (ülke, ülke-hafta, en iyi sıra, platform sayısı), yayında olduğu ülke sayısı,
// yabancı dillerde okunma (son 12 ay), resmî YouTube kanallarında izlenme (dile göre), ülke video sitelerindeki
// izlenme, basın (haber sayısı, olumlu oranı), izleyici puanı ve oyu.

const READING_MONTHS = 12
const MAX_IDS = 5

function readingSince(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - READING_MONTHS, 1))
  return d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1)
}

function languageName(lang) {
  if (lang === 'mul') return 'Çok dilli'
  if (String(lang).includes(',')) return lang.split(',').map(languageName).join('/')
  try {
    const n = new Intl.DisplayNames(['tr'], { type: 'language' }).of(lang)
    return n ? n.charAt(0).toLocaleUpperCase('tr') + n.slice(1) : lang
  } catch {
    return lang
  }
}

/** Dizinin yabancı dillerde son 12 ay okunması: toplam ve en çok okunan 3 dil. */
export function readingSummary(seriesId, now = new Date()) {
  const rows = db
    .prepare(
      `SELECT lang, SUM(views) views FROM series_language_interest
       WHERE tmdb_id = ? AND lang <> 'tr' AND year * 100 + month >= ? GROUP BY lang ORDER BY views DESC`
    )
    .all(seriesId, readingSince(now))
  const total = rows.reduce((n, r) => n + r.views, 0)
  return {
    total,
    languages: rows.slice(0, 3).map((r) => ({ lang: r.lang, name: languageName(r.lang), views: r.views })),
  }
}

/** Listeler: Türkiye dışı ülke sayısı, ülke-hafta, en iyi sıra, platform sayısı. */
export function listingSummary(listings = []) {
  const abroad = listings.filter((l) => l.iso2 !== 'TR')
  return {
    countries: new Set(abroad.map((l) => l.iso2)).size,
    countryWeeks: abroad.reduce((n, l) => n + (l.weeks || 0), 0),
    bestRank: abroad.length ? Math.min(...abroad.map((l) => l.bestRank)) : null,
    platforms: new Set(abroad.map((l) => l.platform)).size,
  }
}

export function availabilitySummary(providersForSeries = {}) {
  let n = 0
  for (const [iso2, e] of Object.entries(providersForSeries)) {
    if (iso2 === 'TR') continue
    if (STREAMABLE_KEYS.some((k) => Array.isArray(e?.[k]) && e[k].length > 0)) n++
  }
  return { countries: n }
}

export function pressSummary(sentiment) {
  const countries = sentiment?.countries || []
  const withNews = countries.filter((c) => c.totalNewsCount > 0)
  const toned = withNews.filter((c) => c.positivePct != null)
  return {
    countriesScanned: countries.length,
    countriesWithNews: withNews.length,
    news: withNews.reduce((n, c) => n + c.totalNewsCount, 0),
    positivePct: toned.length ? Math.round(toned.reduce((n, c) => n + c.positivePct, 0) / toned.length) : null,
  }
}

export async function buildComparison(idsRaw, { now = new Date() } = {}) {
  const ids = [...new Set(idsRaw.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_IDS)
  const { raw } = await getEnrichedVisibility()
  const byId = new Map(raw.series.map((s) => [s.id, s]))
  const items = []
  for (const id of ids) {
    const s = byId.get(id)
    if (!s) continue
    const charts = await getSeriesCharts(id)
    const yt = getSeriesYoutube(id)
    const imdb = await getImdbDataForTmdbSeries(id).catch(() => null)
    const online = getSeriesOnlineViews(id)
    items.push({
      id,
      name: s.name,
      posterPath: s.posterPath ?? null,
      firstAirDate: s.firstAirDate ?? null,
      lists: listingSummary(charts?.listings || []),
      availability: availabilitySummary(raw.providersById[id] || {}),
      reading: readingSummary(id, now),
      youtube: yt
        ? {
            views: yt.totals.views,
            videos: yt.totals.videos,
            growth30: yt.growth30?.views ?? null,
            byLang: (yt.byLang || [])
              .slice(0, 3)
              .map((l) => ({ lang: l.lang, name: l.lang === 'tr' ? 'Türkçe' : languageName(l.lang), views: l.views })),
          }
        : null,
      online: online.map((o) => ({ iso2: o.iso2, views: o.views, videos: o.videos })),
      press: pressSummary(getMediaSentimentForSeries(id)),
      imdb:
        imdb?.status === 'ready'
          ? { rating: imdb.rating, votes: imdb.votes, votes30: imdb.votesGrowth?.d30?.votes ?? null }
          : null,
    })
  }
  return { items, generatedAt: now.toISOString() }
}
