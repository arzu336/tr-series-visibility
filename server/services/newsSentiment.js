import db from '../db.js'
import { fetchNewsArticlesRaw } from './serpApiCache.js'
import { analyzeMediaSentiment } from '../llm.js'

// Proje raporu §4.6 "Basın/Haber Duygu Analizi". Kendi tablosu (media_sentiment, bkz. db.js) —
// trends_cache gibi ham SerpAPI yanıtı değil, LLM analiziyle ZENGİNLEŞTİRİLMİŞ bir sonuç
// tutulduğu için genel cache_entries'ten ayrı. 30 günlük TTL.
const NEWS_SENTIMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_STORED_ARTICLES = 20

const getStmt = db.prepare('SELECT * FROM media_sentiment WHERE series_id = ? AND country_iso2 = ?')
const upsertStmt = db.prepare(`
  INSERT INTO media_sentiment
    (series_id, country_iso2, query_used, total_news_count, positive_score, neutral_score,
     negative_score, dominant_sentiment, llm_summary, raw_articles, created_at, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(series_id, country_iso2) DO UPDATE SET
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
 * 2. Yoksa google_news'ten haber çeker; hiç haber yoksa dürüstçe "yetersiz-veri" olarak
 *    cache'ler (LLM'e hiç gitmez, boşuna prompt harcanmaz).
 * 3. Haber varsa LLM'e gönderir; LLM başarısız olursa (timeout/hata) sayısal veri yine de
 *    cache'lenir (total_news_count, raw_articles) — sadece duygu skorları/özet null kalır ve
 *    dominant_sentiment 'yetersiz-veri' işaretlenir (bkz. themeInsight.js'teki aynı prensip:
 *    ham veri asla LLM'in başarısına bağımlı değil).
 */
export async function fetchAndAnalyzeSentiment(seriesId, seriesName, localTitle, countryIso2) {
  const iso2 = countryIso2.toUpperCase()
  const existing = getStmt.get(seriesId, iso2)
  if (existing && Date.now() <= existing.expires_at) {
    return rowToResult(existing, { stale: false })
  }

  const query = localTitle || seriesName
  const now = new Date()
  const nowIso = now.toISOString()

  let articles
  try {
    articles = await fetchNewsArticlesRaw(query, iso2)
  } catch (err) {
    // SerpAPI çağrısı başarısız oldu (429/ağ) — eski (süresi dolmuş) bir kayıt varsa çökmeden
    // onu stale:true ile döneriz, hiç kayıt yoksa hatayı olduğu gibi yukarı fırlatırız
    // (server/services/serpApiCache.js'teki cacheFirstSerpApi ile aynı dayanıklılık deseni).
    if (existing) {
      console.error(`[newsSentiment] ${seriesName}/${iso2} için canlı istek başarısız (${err.message}), stale önbellek dönülüyor.`)
      return rowToResult(existing, { stale: true, staleReason: err.message })
    }
    throw err
  }

  const rawArticles = articles.slice(0, MAX_STORED_ARTICLES)
  const expiresAt = now.getTime() + NEWS_SENTIMENT_TTL_MS

  if (articles.length === 0) {
    upsertStmt.run(seriesId, iso2, query, 0, null, null, null, 'yetersiz-veri', null, JSON.stringify([]), nowIso, expiresAt)
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
    expiresAt
  )

  return rowToResult(getStmt.get(seriesId, iso2), { fromCache: false, stale: false })
}
