import { suggestControlCountry } from './control-matching.js'
import { getMediaSentimentSummary, getMediaSentimentByCountry } from './services/newsSentiment.js'
import { getSocialEnrichmentSummary } from './services/socialEnricher.js'
import { getTourismLeadingSignalSummary } from './services/tourismTrendsCollector.js'
import { getPipelineDb } from './services/pipelineDb.js'
import { computeTourismCorrelation, PENDING_ANALYSIS } from './services/tourismCorrelation.js'
import { getCached, setCached } from './cache.js'

// Ekonometrik çekirdek (pearsonCorrelation, confidenceInterval95, differenceInDifferences,
// pValueForPearsonR, computeTourismCorrelation) artık server/services/tourismCorrelation.js'te
// — server/impact.test.js'in mevcut importları kırılmasın diye buradan re-export ediliyor.
export { pearsonCorrelation, confidenceInterval95, differenceInDifferences } from './services/tourismCorrelation.js'

function round1(n) {
  return Math.round(n * 10) / 10
}

// Toplam içindeki en öndeki n taneyi + geri kalan her şeyin "Diğer" toplamını döner —
// pasta grafiğin bütünü dürüstçe temsil etmesi için (sadece ilk n'i %100 gibi göstermemek).
function topByScoreWithRemainder(countries, n) {
  const sorted = [...countries].sort((a, b) => b.score - a.score)
  const top = sorted.slice(0, n).map((c) => ({
    iso2: c.iso2,
    score: round1(c.score),
    seriesCount: c.seriesCount,
    dominantTheme: c.dominantTheme,
    trend: c.trend || null,
  }))
  const totalScore = sorted.reduce((sum, c) => sum + c.score, 0)
  const topScore = top.reduce((sum, c) => sum + c.score, 0)
  return { top, otherScore: round1(Math.max(0, totalScore - topScore)) }
}

function topDestinationsWithRemainder(destinationRanking, n) {
  const top = destinationRanking.slice(0, n)
  const totalScore = destinationRanking.reduce((sum, d) => sum + d.totalScore, 0)
  const topScore = top.reduce((sum, d) => sum + d.totalScore, 0)
  return { top, otherScore: round1(Math.max(0, totalScore - topScore)) }
}

function rising(countries, n) {
  return countries
    .filter((c) => c.trend?.direction === 'yükseliyor')
    .sort((a, b) => b.trend.changePct - a.trend.changePct)
    .slice(0, n)
    .map((c) => ({ iso2: c.iso2, changePct: c.trend.changePct, windowDays: c.trend.windowDays }))
}

// Yükselen her ülke için otomatik bir DiD kontrol ülkesi önerir (bkz.
// control-matching.js) — kendi dizi trendi yaşayan ülkeler (risingIso2Set)
// geçerli bir kontrol olamayacağı için eleniyor. World Bank isteği
// başarısız olursa (ağ, kota vb.) o ülke için öneri null kalır, tüm rapor
// çökmez.
async function withSuggestedControls(risingList, risingIso2Set) {
  return Promise.all(
    risingList.map(async (c) => {
      let suggestedControl = null
      try {
        suggestedControl = await suggestControlCountry(c.iso2, risingIso2Set)
      } catch (err) {
        console.error(`[impact] kontrol ülkesi önerisi alınamadı (${c.iso2}):`, err.message)
      }
      return { ...c, suggestedControl }
    })
  )
}

// "İhracat & Ticari Etki" sekmesindeki "Yükselen Pazarlar" tablosu için — World Bank'a gerçek
// bir HTTP isteği attığı için (suggestControlCountry), sekmeler arası hızlı geçişte gereksiz
// tekrar istek atılmasın diye kısa süreli (15 dk) cache'leniyor. Turizm korelasyonunun KENDİ,
// çok daha geniş aday listesi ve kendi ekonometrik hesaplaması artık
// server/services/tourismCorrelation.js'te — burasıyla karıştırılmıyor.
const RISING_CONTROLS_CACHE_KEY = 'impact:rising-with-controls'
const RISING_CONTROLS_TTL_MS = 15 * 60 * 1000

async function getRisingCountriesWithControls(countries, n = 5) {
  const cached = getCached(RISING_CONTROLS_CACHE_KEY)
  if (cached) return cached
  const risingList = rising(countries, n)
  const risingIso2Set = new Set(countries.filter((c) => c.trend?.direction === 'yükseliyor').map((c) => c.iso2))
  const result = await withSuggestedControls(risingList, risingIso2Set)
  setCached(RISING_CONTROLS_CACHE_KEY, result, RISING_CONTROLS_TTL_MS)
  return result
}

async function getTourismCorrelation(countries) {
  try {
    return await computeTourismCorrelation(countries)
  } catch (err) {
    console.error('[impact] turizm korelasyonu hesaplanamadı:', err.message)
    return null
  }
}

// Bir tek destinasyonun toplam skorun çoğunu taşıması (ör. İstanbul'un neredeyse her dizide
// doğal olarak geçmesi) uydurma bir "eşitsizlik" değil, gerçek ve beklenen bir yoğunlaşma —
// ama analiste ham sayı yerine bunun FARKINDA olduğunu açıkça göstermek için bir eşik üstünde
// otomatik bir not üretiliyor. Eşik (%50) keyfi ama makul: tek destinasyonun payı bunu
// aşıyorsa "geri kalan her şey küçük" demektir, bu okuyucuya söylenmeye değer.
const CONCENTRATION_WARNING_THRESHOLD_PCT = 50

function buildConcentrationWarning(top, otherScore) {
  if (top.length === 0) return null
  const totalScore = top.reduce((sum, d) => sum + d.totalScore, 0) + otherScore
  if (totalScore === 0) return null
  const leader = top[0]
  const leaderSharePct = round1((leader.totalScore / totalScore) * 100)
  if (leaderSharePct < CONCENTRATION_WARNING_THRESHOLD_PCT) return null
  return {
    destinationId: leader.id,
    destinationName: leader.name,
    sharePct: leaderSharePct,
    note: `${leader.name}, destinasyon görünürlüğünün %${leaderSharePct}'ini tek başına taşıyor — bu, ${leader.name}'ın ${leader.seriesCount} dizide sahne olarak geçmesinden kaynaklanan doğal bir yoğunlaşma, uydurma bir ağırlıklandırma değil.`,
  }
}

// netflix_country_rankings pipeline.db'de (bkz. server/services/pipelineDb.js) — burada sadece
// "bu ülke için EN AZ BİR resmi platform Top 10 kaydı var mı" sorusuna bakılıyor (belirli bir
// diziyle eşleşme değil, "Yükselen Pazarlar" tablosu ülke bazlı olduğu için). Tablo/dosya henüz
// yoksa (netflix_pipeline.py hiç çalıştırılmadıysa) boş Set döner, hiçbir rozet uydurulmaz.
function getNetflixCoveredIso2s() {
  const conn = getPipelineDb()
  if (!conn) return new Set()
  try {
    const rows = conn.prepare('SELECT DISTINCT country_iso2 FROM netflix_country_rankings').all()
    return new Set(rows.map((r) => r.country_iso2))
  } catch {
    return new Set()
  }
}

// Sekme 1 — Kültürel Etki & Kamu Diplomasisi. Tema dağılımı (/api/theme-insight), küresel
// kıyaslama (/api/benchmark) ve Türkçe öğrenme endeksi (/api/duolingo-stats,
// /api/turkish-learning-index) ZATEN kendi bağımsız uçları — burada TEKRAR hesaplanmıyor,
// sadece bu sekme için GERÇEKTEN yeni olan parçalar (medya/basın algısı özeti + ülke kırılımı)
// döner.
export function buildCulturalImpact() {
  return {
    generatedAt: new Date().toISOString(),
    mediaSentimentSummary: getMediaSentimentSummary(),
    mediaSentimentByCountry: getMediaSentimentByCountry(),
    // server/services/socialEnricher.js'in haftalık zenginleştirmesi — hedef ülkeye özel yayın
    // platformu/puan/fragman taraması kaç dizi/ülke çiftinde tamamlandı, dürüst bir sayım.
    socialEnrichmentSummary: getSocialEnrichmentSummary(),
  }
}

const TOURISM_IMPACT_CACHE_KEY = 'impact:tourism-tab'
const TOURISM_IMPACT_TTL_MS = 10 * 60 * 1000 // ImpactStats.jsx VE TourismImpactTab.jsx aynı ucu
// çağırıyor (bkz. ImpactStats'ın İstanbul payı göstergesi) — turizm korelasyonu World Bank'a
// gerçek istek attığı için (getTourismCorrelation) ikisi art arda çağrılınca iki kat hesaplanmasın.

// Sekme 2 — Turizm & Destinasyon Etkisi.
export async function buildTourismImpact(countries, destinationRanking = []) {
  const cached = getCached(TOURISM_IMPACT_CACHE_KEY)
  if (cached) return cached

  const destinationBreakdown = topDestinationsWithRemainder(destinationRanking, 5)
  const tourismCorrelation = await getTourismCorrelation(countries)

  const result = {
    generatedAt: new Date().toISOString(),
    topDestinations: destinationBreakdown.top,
    otherDestinationsScore: destinationBreakdown.otherScore,
    concentrationWarning: buildConcentrationWarning(destinationBreakdown.top, destinationBreakdown.otherScore),
    pendingAnalysis: tourismCorrelation || PENDING_ANALYSIS,
    // server/services/tourismTrendsCollector.js'in haftalık taraması — "3-6 Aylık Öncü Turizm
    // Sinyali" (YİGM'e eşleşen ilk 15 ülke × 3 seyahat sorgusu, senkron SQLite okuması, ekstra
    // SerpAPI çağrısı YOK burada).
    leadingSignal: getTourismLeadingSignalSummary(),
  }
  setCached(TOURISM_IMPACT_CACHE_KEY, result, TOURISM_IMPACT_TTL_MS)
  return result
}

// Sekme 3 — İhracat & Ticari Etki. Türkiye'nin küresel pazar payı (%X) kasıtlı olarak burada
// YOK — o zaten /api/benchmark'ın (Türkiye vs ABD/Kore/İspanya) bir alanı, burada tekrarlamak
// yerine ExportImpactTab.jsx kendi ayrıca fetchBenchmark() çağırıp TR satırını okur.
export async function buildExportImpact(countries) {
  const countryBreakdown = topByScoreWithRemainder(countries, 5)
  const risingCountriesRaw = await getRisingCountriesWithControls(countries, 5)
  const netflixCovered = getNetflixCoveredIso2s()
  const risingCountries = risingCountriesRaw.map((c) => ({ ...c, hasOfficialPlatformData: netflixCovered.has(c.iso2) }))

  return {
    generatedAt: new Date().toISOString(),
    totalCountries: countries.length,
    topCountriesByVisibility: countryBreakdown.top,
    otherCountriesScore: countryBreakdown.otherScore,
    risingCountries,
  }
}

// Eski, tek parça uç (/api/impact) — GERİYE DÖNÜK UYUMLULUK için birebir aynı yanıt şeklini
// korur, ama artık içeride yukarıdaki 3 odaklı fonksiyonun (ve paylaşılan
// getRisingCountriesWithControls cache'inin) bileşimi olarak çalışır — mantık TEKRARLANMIYOR.
export async function buildImpactReport(countries, destinationRanking = []) {
  const hasEnoughHistoryForTrends = countries.some((c) => c.trend?.direction !== 'yetersiz-veri')
  const countryBreakdown = topByScoreWithRemainder(countries, 5)
  const destinationBreakdown = topDestinationsWithRemainder(destinationRanking, 5)

  const risingCountries = await getRisingCountriesWithControls(countries, 5)
  const tourismCorrelation = await getTourismCorrelation(countries)

  return {
    generatedAt: new Date().toISOString(),
    totalCountries: countries.length,
    risingCount: countries.filter((c) => c.trend?.direction === 'yükseliyor').length,
    fallingCount: countries.filter((c) => c.trend?.direction === 'düşüyor').length,
    topCountriesByVisibility: countryBreakdown.top,
    otherCountriesScore: countryBreakdown.otherScore,
    risingCountries,
    hasEnoughHistoryForTrends,
    topDestinations: destinationBreakdown.top,
    otherDestinationsScore: destinationBreakdown.otherScore,
    pendingAnalysis: tourismCorrelation || PENDING_ANALYSIS,
  }
}
