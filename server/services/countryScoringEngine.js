import db from '../db.js'
import { getCached } from '../cache.js'
import { calculateShareOfSearch } from './trendsShareOfSearch.js'
import { getPipelineDb } from './pipelineDb.js'

const TOP_N_CANDIDATES = 5

// TMDB'nin tek küresel popülerlik sayısı burada SADECE hangi 5 dizinin karşılaştırmaya
// gireceğini belirlemek için (aday havuzu) kullanılır — o ülkede GERÇEKTEN yayında olan
// (providersById'de kaydı olan) diziler arasından en popüler 5'i seçer. NİHAİ sıralama ise
// aşağıdaki 4 faktörün ağırlıklı bileşimiyle belirlenir, TMDB skoru bileşime hiç girmez —
// proje raporunun "TMDB'nin tekil global popülerlik skoruna bağımlılığı azalt" hedefi bu
// ayrımla korunuyor: TMDB sadece "kimler yarışacak" sorusuna, resmi kaynaklar "kim kazandı"
// sorusuna cevap veriyor.
const WEIGHTS = {
  shareOfSearch: 0.4,
  netflix: 0.3,
  mediaSentiment: 0.15,
  availability: 0.15,
}

function getNetflixScore(iso2, tmdbId) {
  const conn = getPipelineDb()
  if (!conn) return null
  try {
    const row = conn
      .prepare('SELECT rank_score, weeks_in_top10, peak_rank, last_week_date FROM netflix_country_rankings WHERE country_iso2 = ? AND tmdb_id = ?')
      .get(iso2, tmdbId)
    if (!row) return null
    return {
      value: row.rank_score,
      evidence: `Resmi platform Top 10: ${row.weeks_in_top10} hafta, en iyi #${row.peak_rank} (${row.last_week_date || 'tarih yok'})`,
    }
  } catch (err) {
    // Tablo henüz yok (netflix_pipeline.py hiç bu ülke için koşulmadı) — dürüstçe "veri yok".
    return null
  }
}

const getMediaSentimentStmt = db.prepare(
  'SELECT positive_score, negative_score, dominant_sentiment, total_news_count FROM media_sentiment WHERE series_id = ? AND country_iso2 = ? AND expires_at > ?'
)

function getMediaSentimentScore(iso2, tmdbId) {
  const row = getMediaSentimentStmt.get(tmdbId, iso2, Date.now())
  if (!row || row.dominant_sentiment === 'yetersiz-veri' || row.positive_score == null) return null
  // 100 = tamamen olumlu, 50 = nötr, 0 = tamamen olumsuz (bkz. server/llm.js
  // analyzeMediaSentiment — positive/neutral/negative toplamı ~1.0).
  const value = Math.round(((row.positive_score - row.negative_score + 1) / 2) * 1000) / 10
  return { value, evidence: `Basın algısı: ${row.dominant_sentiment} (${row.total_news_count} haber)` }
}

function getAvailabilityScore(providersForCountry) {
  if (!providersForCountry) return { value: 0, evidence: 'Bu ülkede yayın sağlayıcısı kaydı yok' }
  const categories = ['flatrate', 'free', 'ads', 'rent', 'buy']
  const distinctProviders = new Set()
  for (const cat of categories) {
    for (const p of providersForCountry[cat] || []) {
      if (p.provider_id != null) distinctProviders.add(p.provider_id)
    }
  }
  // Basit, şeffaf bir ölçek: 4+ farklı platformda bulunmak "geniş yayın varlığı" sayılır
  // (100), tek platform 25 — kesin bir sektör standardı değil, açıkça etiketlenen bir
  // sezgisel (heuristic) puan.
  const value = Math.min(100, distinctProviders.size * 25)
  return {
    value,
    evidence: `${distinctProviders.size} farklı platformda yayında`,
  }
}

function weightedComposite(factors) {
  // factors: [{ key, weight, value: number|null, evidence }]. Eksik (null) faktörler
  // toplama dahil edilmez, kalan faktörlerin ağırlığı KENDİ ARALARINDA yeniden normalize
  // edilir — veri eksikliği asla 0 puan gibi cezalandırılmaz (bkz. proje genelindeki "veri
  // yoksa dürüstçe eksik say, uydurma" prensibi).
  const available = factors.filter((f) => f.value != null)
  const weightSum = available.reduce((s, f) => s + f.weight, 0)
  if (weightSum === 0) return { score: null, usedFactors: [] }
  const score = available.reduce((s, f) => s + f.value * f.weight, 0) / weightSum
  return { score: Math.round(score * 10) / 10, usedFactors: available.map((f) => f.key) }
}

function badgeFor(usedFactors) {
  const hasNetflix = usedFactors.includes('netflix')
  const hasShareOfSearch = usedFactors.includes('shareOfSearch')
  // Etiketler kullanıcı talebiyle "resmi veri"/"yetersiz veri" ibarelerinden arındırıldı —
  // level (verified/partial/weak) aynı kalıyor, sadece görünen metin değişti; hiçbir sayı
  // olduğundan daha kesin gösterilmiyor, sadece kelime seçimi sadeleşti.
  if (hasNetflix && hasShareOfSearch) {
    return { label: 'Çift Kaynakla Doğrulandı', level: 'verified' }
  }
  if (hasShareOfSearch) {
    return { label: 'Arama İlgisiyle Kısmi Doğrulama', level: 'partial' }
  }
  if (hasNetflix) {
    return { label: 'Platform Verisiyle Kısmi Doğrulama', level: 'partial' }
  }
  return { label: 'Sadece Medya/Yayın Sinyali', level: 'weak' }
}

/**
 * Ülkede yayında olan (providersById'de kaydı olan) en popüler 5 Türk dizisini 4 faktörle
 * (Share of Search %40, Netflix Top 10 %30, Basın Algısı %15, Yayın Varlığı %15) yeniden
 * sıralar. TMDB popülerliği SADECE aday havuzunu belirlemek için kullanılır, nihai sıralamaya
 * girmez (bkz. yukarıdaki WEIGHTS notu). Hiçbir gerçek veri yoksa (Share of Search bile
 * çekilemezse) boş entries + açık bir `error` alanıyla döner, uydurma bir sıralama üretilmez.
 */
export async function calculateCountryCompositeScore(countryIso2) {
  const iso2 = countryIso2.toUpperCase()
  const raw = getCached('raw-series-providers')
  if (!raw) {
    return { iso2, generatedAt: new Date().toISOString(), entries: [], error: 'Canlı veri önbelleği henüz dolmamış' }
  }

  const candidates = raw.series
    .filter((s) => raw.providersById[s.id]?.[iso2])
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, TOP_N_CANDIDATES)

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
    const sos = await calculateShareOfSearch(iso2, titles)
    shareOfSearchByTitle = new Map(sos.items.map((it) => [it.title, it]))
    shareOfSearchMeta = { fromCache: sos.fromCache, stale: sos.stale }
  } catch (err) {
    console.error(`[countryScoringEngine] ${iso2} Share of Search alınamadı:`, err.message)
  }

  const entries = candidates.map((s) => {
    const sos = shareOfSearchByTitle.get(s.name)
    const netflix = getNetflixScore(iso2, s.id)
    const sentiment = getMediaSentimentScore(iso2, s.id)
    const availability = getAvailabilityScore(raw.providersById[s.id]?.[iso2])

    const factors = [
      { key: 'shareOfSearch', weight: WEIGHTS.shareOfSearch, value: sos ? sos.shareOfSearchPct : null, evidence: sos ? `Arama payı: %${sos.shareOfSearchPct}` : null },
      { key: 'netflix', weight: WEIGHTS.netflix, value: netflix?.value ?? null, evidence: netflix?.evidence ?? null },
      { key: 'mediaSentiment', weight: WEIGHTS.mediaSentiment, value: sentiment?.value ?? null, evidence: sentiment?.evidence ?? null },
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
