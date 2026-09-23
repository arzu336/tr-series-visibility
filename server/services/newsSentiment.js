import db from '../db.js'
import { fetchNewsArticlesGdeltCached } from './gdeltNews.js'
import { analyzeMediaSentiment } from '../llm.js'

const NEWS_SENTIMENT_TTL_MS = 14 * 24 * 60 * 60 * 1000
const MAX_STORED_ARTICLES = 20

const NEWS_SOURCE = 'gdelt'

const getStmt = db.prepare('SELECT * FROM media_sentiment WHERE series_id = ? AND country_iso2 = ?')
const upsertStmt = db.prepare(`
  INSERT INTO media_sentiment
    (series_id, country_iso2, query_used, total_news_count, positive_score, neutral_score,
     negative_score, dominant_sentiment, llm_summary, raw_articles, created_at, expires_at, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(series_id, country_iso2) DO UPDATE SET
    source = excluded.source,
    query_used = excluded.query_used,
    total_news_count = excluded.total_news_count,
    positive_score = excluded.positive_score,
    neutral_score = excluded.neutral_score,
    negative_score = excluded.negative_score,
    dominant_sentiment = excluded.dominant_sentiment,
    llm_summary = excluded.llm_summary,
    raw_articles = excluded.raw_articles,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at
`)

const getSummaryStmt = db.prepare(`
  SELECT AVG(positive_score) AS avgPositive, AVG(neutral_score) AS avgNeutral, AVG(negative_score) AS avgNegative,
         COUNT(*) AS sampleSize, COUNT(DISTINCT series_id) AS seriesCount
  FROM media_sentiment
  WHERE dominant_sentiment != 'yetersiz-veri' AND positive_score IS NOT NULL
`)

export function getMediaSentimentSummary() {
  const row = getSummaryStmt.get()
  if (!row || row.sampleSize === 0) {
    return { status: 'pending', sampleSize: 0 }
  }
  return {
    status: 'ready',
    sampleSize: row.sampleSize,
    seriesCount: row.seriesCount,
    avgPositive: Math.round(row.avgPositive * 1000) / 1000,
    avgNeutral: Math.round(row.avgNeutral * 1000) / 1000,
    avgNegative: Math.round(row.avgNegative * 1000) / 1000,
  }
}

const getByCountryStmt = db.prepare(`
  SELECT country_iso2, COUNT(*) AS scannedCount, COUNT(DISTINCT series_id) AS seriesCount,
         AVG(positive_score) AS avgPositive, AVG(negative_score) AS avgNegative
  FROM media_sentiment
  WHERE dominant_sentiment != 'yetersiz-veri' AND positive_score IS NOT NULL
  GROUP BY country_iso2
  ORDER BY scannedCount DESC
`)

const TONE_MARGIN = 0.15
function classifyTone(avgPositive, avgNegative) {
  if (avgPositive - avgNegative > TONE_MARGIN) return 'positive'
  if (avgNegative - avgPositive > TONE_MARGIN) return 'negative'
  return 'neutral'
}

export function getMediaSentimentByCountry() {
  return getByCountryStmt.all().map((row) => ({
    iso2: row.country_iso2,
    scannedCount: row.scannedCount,
    seriesCount: row.seriesCount,
    avgPositivePct: Math.round(row.avgPositive * 1000) / 10,
    dominantTone: classifyTone(row.avgPositive, row.avgNegative),
  }))
}

const getBySeriesStmt = db.prepare(`
  SELECT country_iso2, total_news_count, positive_score, negative_score, dominant_sentiment, created_at
  FROM media_sentiment
  WHERE series_id = ?
  ORDER BY country_iso2
`)

export function getMediaSentimentForSeries(seriesId) {
  const rows = getBySeriesStmt.all(seriesId)
  if (rows.length === 0) {
    return { status: 'pending', scannedCount: 0, countries: [] }
  }

  const countries = rows.map((r) => ({
    iso2: r.country_iso2,
    totalNewsCount: r.total_news_count,
    positivePct: r.positive_score != null ? Math.round(r.positive_score * 1000) / 10 : null,
    negativePct: r.negative_score != null ? Math.round(r.negative_score * 1000) / 10 : null,
    dominantSentiment: r.dominant_sentiment,
  }))

  const withData = rows.filter((r) => r.dominant_sentiment !== 'yetersiz-veri' && r.positive_score != null)
  if (withData.length === 0) {
    return { status: 'no-data', scannedCount: rows.length, countries }
  }

  const avgPositive = withData.reduce((sum, r) => sum + r.positive_score, 0) / withData.length
  const avgNegative = withData.reduce((sum, r) => sum + r.negative_score, 0) / withData.length
  return {
    status: 'ready',
    scannedCount: rows.length,
    withDataCount: withData.length,
    avgPositivePct: Math.round(avgPositive * 1000) / 10,
    avgNegativePct: Math.round(avgNegative * 1000) / 10,
    dominantTone: classifyTone(avgPositive, avgNegative),
    countries,
  }
}

const listAllStmt = db.prepare('SELECT * FROM media_sentiment ORDER BY created_at DESC')
const getByIdStmt = db.prepare('SELECT * FROM media_sentiment WHERE id = ?')
const setOverrideStmt = db.prepare(`
  UPDATE media_sentiment SET override_sentiment = ?, override_reviewer = ?, override_at = ? WHERE id = ?
`)
const clearOverrideStmt = db.prepare(`
  UPDATE media_sentiment SET override_sentiment = NULL, override_reviewer = NULL, override_at = NULL WHERE id = ?
`)
const VALID_SENTIMENTS = new Set(['positive', 'neutral', 'negative'])

function rowToAuditEntry(row, seriesName) {
  return {
    id: row.id,
    seriesId: row.series_id,
    seriesName: seriesName ?? null,
    countryIso2: row.country_iso2,
    totalNewsCount: row.total_news_count,
    articles: row.raw_articles
      ? JSON.parse(row.raw_articles)
          .slice(0, 5)
          .map((a) => ({ title: a.title, source: a.source || null, url: a.url || null }))
      : [],
    dominantSentiment: row.dominant_sentiment,
    effectiveSentiment: row.override_sentiment || row.dominant_sentiment,
    override: row.override_sentiment
      ? { sentiment: row.override_sentiment, reviewer: row.override_reviewer, at: row.override_at }
      : null,
    createdAt: row.created_at,
  }
}

export function getMediaSentimentAuditRows(liveSeriesById) {
  return listAllStmt
    .all()
    .filter((row) => liveSeriesById.has(row.series_id))
    .map((row) => rowToAuditEntry(row, liveSeriesById.get(row.series_id)))
}

export function setSentimentOverride(id, sentiment, reviewer) {
  if (!VALID_SENTIMENTS.has(sentiment)) {
    throw new Error(`Geçersiz ton: ${sentiment}`)
  }
  const numId = Number(id)
  const row = getByIdStmt.get(numId)
  if (!row) {
    throw new Error(`Kayıt bulunamadı: ${id}`)
  }
  setOverrideStmt.run(sentiment, reviewer || 'anonim', new Date().toISOString(), numId)
  return rowToAuditEntry(getByIdStmt.get(numId))
}

export function clearSentimentOverride(id) {
  const numId = Number(id)
  const row = getByIdStmt.get(numId)
  if (!row) {
    throw new Error(`Kayıt bulunamadı: ${id}`)
  }
  clearOverrideStmt.run(numId)
  return rowToAuditEntry(getByIdStmt.get(numId))
}

function rowToResult(row, extra) {
  return {
    seriesId: row.series_id,
    countryIso2: row.country_iso2,
    queryUsed: row.query_used,
    totalNewsCount: row.total_news_count,
    positiveScore: row.positive_score,
    neutralScore: row.neutral_score,
    negativeScore: row.negative_score,
    dominantSentiment: row.dominant_sentiment,
    llmSummary: row.llm_summary,
    latestArticles: row.raw_articles ? JSON.parse(row.raw_articles).slice(0, 5) : [],
    createdAt: row.created_at,
    fromCache: true,
    ...extra,
  }
}

/**
 * 1. media_sentiment'te geçerli (expires_at > şimdi) bir kayıt varsa SerpAPI/LLM'e hiç
 *    gitmeden onu döner.
 * 2. Yoksa GDELT DOC 2.0'dan haber çeker; hiç haber yoksa dürüstçe "yetersiz-veri" olarak
 *    cache'ler (LLM'e hiç gitmez, boşuna prompt harcanmaz).
 * 3. Haber varsa LLM'e gönderir; LLM başarısız olursa (timeout/hata) sayısal veri yine de
 *    cache'lenir (total_news_count, raw_articles) — sadece duygu skorları/özet null kalır ve
 *    dominant_sentiment 'yetersiz-veri' işaretlenir (bkz. themeInsight.js'teki aynı prensip:
 *    ham veri asla LLM'in başarısına bağımlı değil).
 */
export async function fetchAndAnalyzeSentiment(seriesId, seriesName, localTitle, countryIso2, { priority } = {}) {
  const iso2 = countryIso2.toUpperCase()
  const existing = getStmt.get(seriesId, iso2)
  if (existing && Date.now() <= existing.expires_at && existing.source === NEWS_SOURCE) {
    return rowToResult(existing, { stale: false })
  }

  const query = localTitle || seriesName
  const now = new Date()
  const nowIso = now.toISOString()

  let articles
  try {
    const sonuc = await fetchNewsArticlesGdeltCached(query, iso2, { priority })
    if (sonuc.unsupported) {
      return {
        seriesId,
        countryIso2: iso2,
        queryUsed: query,
        unsupported: true,
        totalNewsCount: null,
        dominantSentiment: null,
        llmSummary: null,
        latestArticles: [],
        fromCache: false,
      }
    }
    articles = sonuc.news
  } catch (err) {
    if (existing) {
      console.error(`[newsSentiment] ${seriesName}/${iso2} için canlı istek başarısız (${err.message}), stale önbellek dönülüyor.`)
      return rowToResult(existing, { stale: true, staleReason: err.message })
    }
    throw err
  }

  const rawArticles = articles.slice(0, MAX_STORED_ARTICLES)
  const expiresAt = now.getTime() + NEWS_SENTIMENT_TTL_MS

  if (articles.length === 0) {
    upsertStmt.run(seriesId, iso2, query, 0, null, null, null, 'yetersiz-veri', null, JSON.stringify([]), nowIso, expiresAt, NEWS_SOURCE)
    return rowToResult(getStmt.get(seriesId, iso2), { fromCache: false, stale: false })
  }

  let sentiment = null
  try {
    sentiment = await analyzeMediaSentiment(articles, seriesName)
  } catch (err) {
    console.error(`[newsSentiment] ${seriesName}/${iso2} için LLM analizi başarısız:`, err.message)
  }

  upsertStmt.run(
    seriesId,
    iso2,
    query,
    articles.length,
    sentiment?.positive ?? null,
    sentiment?.neutral ?? null,
    sentiment?.negative ?? null,
    sentiment?.dominant ?? 'yetersiz-veri',
    sentiment?.summary ?? null,
    JSON.stringify(rawArticles),
    nowIso,
    expiresAt,
    NEWS_SOURCE
  )

  return rowToResult(getStmt.get(seriesId, iso2), { fromCache: false, stale: false })
}
