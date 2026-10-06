import db from '../db.js'
import { getCached } from '../cache.js'
import { calculateShareOfSearch } from './trendsShareOfSearch.js'
import { getPipelineDb } from './pipelineDb.js'
import { PLATFORM_LABELS, weekEndOf } from './charts.js'

const TOP_N_CANDIDATES = 5

const WEIGHTS = {
  shareOfSearch: 0.4,
  lists: 0.3,
  mediaSentiment: 0.15,
  availability: 0.15,
}

// Liste faktörü: dizinin bu ülkede son 52 haftada TÜM platformların Top 10 listelerindeki başarısı
// (Netflix haftalık + Disney+/Prime Video/HBO Max/Apple TV+/Shahid günlük anlık görüntüleri). Önceden
// yalnızca Netflix'ti; Shahid'de 1. olan bir dizi bu faktörden sıfır alıyordu.
const LIST_WINDOW_DAYS = 364
const LIST_WEEKS_CAP = 26

function addDaysIso(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Satırlar → dizi başına { weeks, bestRank, platforms, value, evidence }. Değer 0-100: listede kalınan
 * hafta (26 haftada tavan) %60 + en iyi sıra (#1 = tam, #10 = onda bir) %40. Aynı hafta birden çok
 * platformda olmak tek hafta sayılır.
 */
export function listPerformance(rows) {
  const by = new Map()
  for (const r of rows) {
    const a = by.get(r.series_id) || { weeks: new Set(), bestRank: 99, platforms: new Set() }
    a.weeks.add(weekEndOf(r.period_date))
    a.bestRank = Math.min(a.bestRank, r.rank)
    a.platforms.add(
      r.provider === 'netflix_tudum' ? PLATFORM_LABELS.netflix : (PLATFORM_LABELS[r.segment] ?? r.segment)
    )
    by.set(r.series_id, a)
  }
  const out = new Map()
  for (const [id, a] of by) {
    const weeks = a.weeks.size
    const value =
      Math.round(((60 * Math.min(weeks, LIST_WEEKS_CAP)) / LIST_WEEKS_CAP + (40 * (11 - a.bestRank)) / 10) * 10) / 10
    const platforms = [...a.platforms].sort()
    out.set(id, {
      weeks,
      bestRank: a.bestRank,
      platforms,
      value,
      evidence: `Listelerde ${weeks} hafta`,
    })
  }
  return out
}

function readListPerformance(iso2, { conn = getPipelineDb(), today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!conn) return new Map()
  try {
    const rows = conn
      .prepare(
        `SELECT provider, segment, period_date, rank, series_id FROM chart_entries
         WHERE country_iso2 = ? AND period_date >= ? AND series_id IS NOT NULL AND program_kind = 'series'
           AND provider IN ('netflix_tudum', 'flixpatrol')`
      )
      .all(iso2, addDaysIso(today, -LIST_WINDOW_DAYS))
    return listPerformance(rows)
  } catch {
    return new Map()
  }
}

/**
 * Aday havuzu: önce bu ülkede Top 10 listelerine girmiş diziler (liste başarısına göre), kalan yer
 * ülkede yayında olan en popüler dizilerle dolar. Listelerde zirveye çıkan bir dizi, TMDB popülerliği
 * düşük diye "en çok ilgi gören diziler"in dışında kalmasın.
 */
export function pickCandidates(raw, iso2, lists, n = TOP_N_CANDIDATES) {
  const inCatalog = new Map(raw.series.map((s) => [s.id, s]))
  const charted = [...lists.entries()]
    .filter(([id]) => inCatalog.has(id))
    .sort((a, b) => b[1].value - a[1].value)
    .map(([id]) => inCatalog.get(id))
  const popular = raw.series.filter((s) => raw.providersById[s.id]?.[iso2]).sort((a, b) => b.popularity - a.popularity)
  const seen = new Set()
  const out = []
  for (const s of [...charted, ...popular]) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    out.push(s)
    if (out.length === n) break
  }
  return out
}

const getMediaSentimentStmt = db.prepare(
  'SELECT positive_score, negative_score, dominant_sentiment, total_news_count FROM media_sentiment WHERE series_id = ? AND country_iso2 = ? AND expires_at > ?'
)

function getMediaSentimentScore(iso2, tmdbId) {
  const row = getMediaSentimentStmt.get(tmdbId, iso2, Date.now())
  if (!row || row.dominant_sentiment === 'yetersiz-veri' || row.positive_score == null) return null
  const value = Math.round(((row.positive_score - row.negative_score + 1) / 2) * 1000) / 10
  return { value, evidence: `Basın algısı: ${row.dominant_sentiment} (${row.total_news_count} haber)` }
}

export function getAvailabilityScore(providersForCountry, listed = null) {
  // TMDB'nin platform verisi bazı platformları (ör. Shahid) tanımıyor; dizi o ülkede bir platformun Top 10
  // listesindeyse orada yayında olduğu kesindir — kayıt yokken liste platformları kanıt olarak sayılır.
  if (!providersForCountry && listed?.platforms?.length) {
    return {
      value: Math.min(100, listed.platforms.length * 25),
      evidence: `Listede olduğu ${listed.platforms.length} platformda yayında`,
    }
  }
  if (!providersForCountry) return { value: 0, evidence: 'Bu ülkede yayın sağlayıcısı kaydı yok' }
  const categories = ['flatrate', 'free', 'ads', 'rent', 'buy']
  const distinctProviders = new Set()
  for (const cat of categories) {
    for (const p of providersForCountry[cat] || []) {
      if (p.provider_id != null) distinctProviders.add(p.provider_id)
    }
  }
  const value = Math.min(100, distinctProviders.size * 25)
  return {
    value,
    evidence: `${distinctProviders.size} farklı platformda yayında`,
  }
}

function weightedComposite(factors) {
  const available = factors.filter((f) => f.value != null)
  const weightSum = available.reduce((s, f) => s + f.weight, 0)
  if (weightSum === 0) return { score: null, usedFactors: [] }
  const score = available.reduce((s, f) => s + f.value * f.weight, 0) / weightSum
  return { score: Math.round(score * 10) / 10, usedFactors: available.map((f) => f.key) }
}

function badgeFor(usedFactors) {
  const hasLists = usedFactors.includes('lists')
  const hasShareOfSearch = usedFactors.includes('shareOfSearch')
  if (hasLists && hasShareOfSearch) {
    return { label: 'Çift Kaynakla Doğrulandı', level: 'verified' }
  }
  if (hasShareOfSearch) {
    return { label: 'Arama İlgisiyle Kısmi Doğrulama', level: 'partial' }
  }
  if (hasLists) {
    return { label: 'Platform Listesiyle Kısmi Doğrulama', level: 'partial' }
  }
  return { label: 'Sadece Medya/Yayın Sinyali', level: 'weak' }
}

/**
 * Ülkede Top 10 listelerine girmiş ve yayında olan en popüler Türk dizilerinden 5 aday seçer
 * (pickCandidates) ve 4 faktörle (Share of Search %40, platform Top 10 listeleri %30, Basın Algısı %15,
 * Yayın Varlığı %15) sıralar. TMDB popülerliği SADECE aday havuzunu doldurmak için kullanılır, nihai
 * sıralamaya girmez. Hiçbir gerçek veri yoksa boş entries + açık bir `error` alanıyla döner, uydurma
 * bir sıralama üretilmez.
 */
export async function calculateCountryCompositeScore(countryIso2, { cachedOnly = false, pipelineConn } = {}) {
  const iso2 = countryIso2.toUpperCase()
  const raw = getCached('raw-series-providers')
  if (!raw) {
    return { iso2, generatedAt: new Date().toISOString(), entries: [], error: 'Canlı veri önbelleği henüz dolmamış' }
  }

  const lists = readListPerformance(iso2, pipelineConn !== undefined ? { conn: pipelineConn } : {})
  const candidates = pickCandidates(raw, iso2, lists)

  if (candidates.length < 2) {
    return {
      iso2,
      generatedAt: new Date().toISOString(),
      entries: [],
      error: `Bu ülkede yayında Share of Search karşılaştırması için yeterli (en az 2) Türk dizisi yok (${candidates.length} bulundu)`,
    }
  }

  const titles = candidates.map((s) => s.name)
  let shareOfSearchByTitle = new Map()
  let shareOfSearchMeta = null
  try {
    const sos = await calculateShareOfSearch(iso2, titles, 'today 12-m', { cachedOnly })
    shareOfSearchByTitle = new Map(sos.items.map((it) => [it.title, it]))
    shareOfSearchMeta = { fromCache: sos.fromCache, stale: sos.stale }
  } catch (err) {
    if (err?.code === 'CACHE_MISS') {
      // Rapor modu: ücretli sorgu yapılmadı, faktör dışlanır (ağırlık yeniden dağıtılır).
      shareOfSearchMeta = { skipped: 'cache-miss' }
    } else {
      console.error(`[countryScoringEngine] ${iso2} Share of Search alınamadı:`, err.message)
    }
  }

  const entries = candidates.map((s) => {
    const sos = shareOfSearchByTitle.get(s.name)
    const listed = lists.get(s.id) ?? null
    const sentiment = getMediaSentimentScore(iso2, s.id)
    const availability = getAvailabilityScore(raw.providersById[s.id]?.[iso2], listed)

    const factors = [
      {
        key: 'shareOfSearch',
        weight: WEIGHTS.shareOfSearch,
        value: sos ? sos.shareOfSearchPct : null,
        evidence: sos ? `Arama payı: %${sos.shareOfSearchPct}` : null,
      },
      { key: 'lists', weight: WEIGHTS.lists, value: listed?.value ?? null, evidence: listed?.evidence ?? null },
      {
        key: 'mediaSentiment',
        weight: WEIGHTS.mediaSentiment,
        value: sentiment?.value ?? null,
        evidence: sentiment?.evidence ?? null,
      },
      { key: 'availability', weight: WEIGHTS.availability, value: availability.value, evidence: availability.evidence },
    ]
    const { score, usedFactors } = weightedComposite(factors)

    return {
      tmdbId: s.id,
      name: s.name,
      posterPath: s.posterPath,
      compositeScore: score,
      breakdown: Object.fromEntries(factors.map((f) => [f.key, f.value])),
      evidence: factors.filter((f) => f.evidence).map((f) => f.evidence),
      dataConfidence: badgeFor(usedFactors),
    }
  })

  entries.sort((a, b) => (b.compositeScore ?? -1) - (a.compositeScore ?? -1))

  return {
    iso2,
    generatedAt: new Date().toISOString(),
    shareOfSearchMeta,
    entries,
  }
}
