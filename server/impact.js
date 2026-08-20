import { suggestControlCountry } from './control-matching.js'
import { getVisitorSeries, getTrackedIso2s, pickBeforeAfterPair } from './services/tourismData.js'

// "Yükselen Ülkeler" kartında gösterilen top-5, dünyadaki en çok yükselen 5 ülkeyi gösterir —
// bunlar genelde çok küçük/az turistli ülkeler oluyor (ör. Ekvator Ginesi, Monako), YİGM bülteninde
// ayrı satırları yok. Turizm korelasyonu bu yüzden top-5'e değil, bültende ayrı satırı OLAN
// (getTrackedIso2s) tüm yükselen ülkelere bakar — World Bank kontrol-ülkesi aramasını sınırsız
// büyütmemek için makul bir tavana (bkz. buildImpactReport) kesilir.
const TOURISM_CANDIDATE_CAP = 15

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

// Hazır ve doğruluğu doğrulanmış istatistik yöntemleri — server/services/tourismData.js
// TÜİK/Kültür ve Turizm Bakanlığı'nın (YİGM) aylık sınır bültenini otomatik çektiği için artık
// gerçek girdiyle çalışabiliyor (bkz. computeTourismCorrelation). Veri henüz yoksa (ilk
// senkronizasyondan önce, ya da o ülke bültende hiç geçmiyorsa) PENDING_ANALYSIS'a düşülür —
// hiçbir zaman sahte/örnek girdiyle çağrılmaz.
export function pearsonCorrelation(xs, ys) {
  const n = xs.length
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let dx2 = 0
  let dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  const denom = Math.sqrt(dx2 * dy2)
  return denom === 0 ? 0 : num / denom
}

export function confidenceInterval95(r, n) {
  if (n < 4) return null
  const clamped = Math.max(-0.9999, Math.min(0.9999, r))
  const z = 0.5 * Math.log((1 + clamped) / (1 - clamped))
  const se = 1 / Math.sqrt(n - 3)
  const zLo = z - 1.96 * se
  const zHi = z + 1.96 * se
  const toR = (zVal) => (Math.exp(2 * zVal) - 1) / (Math.exp(2 * zVal) + 1)
  return { low: round2(toR(zLo)), high: round2(toR(zHi)) }
}

// Kontrol ülkeli Difference-in-Differences (DiD) tahmincisi. Hedef ülkenin
// (dizi trendi yaşayan, ör. İspanya) turizm/ihracat değişimini, benzer
// makro-ekonomik dinamiklere sahip ama AYNI DÖNEMDE dizi trendi yaşamamış bir
// kontrol ülkeyle (ör. İtalya) kıyaslar. İki ülkenin ortak etkilendiği kur
// dalgalanması/mevsimsellik gibi dışsal etkiler matematiksel olarak
// birbirinden çıkarılır; geriye sadece dizi trendine atfedilebilecek fark
// (didEstimate) kalır. `before`/`after` aynı birimde (ör. turist sayısı veya
// ihracat tutarı) ve aynı ölçüm penceresine (lag window) ait olmalıdır.
export function differenceInDifferences({ treatmentBefore, treatmentAfter, controlBefore, controlAfter }) {
  const treatmentChange = treatmentAfter - treatmentBefore
  const controlChange = controlAfter - controlBefore
  return {
    didEstimate: round2(treatmentChange - controlChange),
    treatmentChangePct: treatmentBefore === 0 ? null : round2((treatmentChange / treatmentBefore) * 100),
    controlChangePct: controlBefore === 0 ? null : round2((controlChange / controlBefore) * 100),
  }
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function round2(n) {
  return Math.round(n * 100) / 100
}

// Turist giriş verisi artık otomatik çekiliyor (bkz. server/services/tourismData.js, YİGM'in
// aylık sınır bültenini indirip parse ediyor) — ama şu anki "yükselen" ülkeler (rising()) bültende
// ayrı satırı olmayan küçük/az turistli ülkeler olabilir, ya da senkronizasyon henüz hiç
// çalışmamış olabilir. Böyle durumlarda bu sabit metne düşülür. Dizi ihracatı (ülke bazlı $)
// verisi ise hâlâ kamuya açık değil (araştırıldı — sadece toplam ulusal rakam kamuya açık),
// o kısım gerçekten kurumsal talep bekliyor.
const PENDING_ANALYSIS = {
  title: 'Turizm ve İhracat Korelasyonu',
  status: 'gerçek-veri-bekleniyor',
  description:
    'Şu anda görünürlüğü yükselen ülkelerin turist giriş verisi (T.C. Kültür ve Turizm Bakanlığı YİGM sınır bülteninden otomatik çekiliyor) ya henüz senkronize edilmedi ya da bu ülkeler bültende ayrı satırla geçmiyor (küçük/az turistli ülkeler "DİĞER ÜLKELER" alt toplamına giriyor, satır bazında ayrıştırılamıyor). Dizi ihracatı (ülke bazlı $) verisi ise hâlâ kamuya açık değil — sadece toplam ulusal rakam yayınlanıyor. Veri örtüştüğünde burada gerçek bir Difference-in-Differences (DiD) düzeltmesi ve Pearson korelasyonu gösterilecek — hesaplama yöntemi zaten hazır ve doğrulanmış durumda.',
  requiredSources: [
    'TÜİK/Kültür ve Turizm Bakanlığı (YİGM) turist giriş istatistikleri — otomatik çekiliyor, şu anki yükselen ülkeler için henüz eşleşen veri yok',
    'Kültür ve Turizm Bakanlığı / TGA dizi ihracat verisi (ülke bazlı) — hâlâ kamuya açık değil, kurumsal talep gerekiyor',
  ],
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

// rising()'in aksine, sadece YİGM bülteninde ayrı satırı olan (trackedIso2s) ülkeleri filtreler
// — turizm korelasyonu böylece "en hızlı yükselen 5" değil "yükselen VE gerçek turist verisi
// olan" ülkelere bakar, bu yüzden neredeyse her zaman bir sonuç üretebilir.
function risingWithTourismData(countries, trackedIso2s, n) {
  return countries
    .filter((c) => c.trend?.direction === 'yükseliyor' && trackedIso2s.has(c.iso2))
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

// Yükselen her ülke için: kendi turist verisi + otomatik kontrol ülkesinin (suggestControlCountry)
// turist verisi AYNI ay/yıl çiftinde örtüşüyorsa gerçek bir Difference-in-Differences tahmini
// üretir (bkz. differenceInDifferences). Yeterli ülke (≥3) varsa, dizi görünürlük değişimi (%)
// ile DiD-düzeltmeli turist değişimi (%) arasında Pearson korelasyonu + %95 güven aralığı
// hesaplanır. Hiçbir aşamada uydurma veri yok — veri örtüşmüyorsa o ülke listeden düşer.
async function computeTourismCorrelation(risingCountries) {
  const withData = []
  for (const c of risingCountries) {
    if (!c.suggestedControl) continue
    const targetPair = pickBeforeAfterPair(getVisitorSeries(c.iso2))
    const controlPair = pickBeforeAfterPair(getVisitorSeries(c.suggestedControl.iso2))
    if (!targetPair || !controlPair) continue
    if (
      targetPair.month !== controlPair.month ||
      targetPair.beforeYear !== controlPair.beforeYear ||
      targetPair.afterYear !== controlPair.afterYear
    ) {
      continue
    }

    const did = differenceInDifferences({
      treatmentBefore: targetPair.before,
      treatmentAfter: targetPair.after,
      controlBefore: controlPair.before,
      controlAfter: controlPair.after,
    })

    withData.push({
      iso2: c.iso2,
      visibilityChangePct: c.changePct,
      control: c.suggestedControl,
      period: { month: targetPair.month, beforeYear: targetPair.beforeYear, afterYear: targetPair.afterYear },
      didEstimate: did.didEstimate,
      treatmentChangePct: did.treatmentChangePct,
      controlChangePct: did.controlChangePct,
    })
  }

  if (withData.length === 0) return null

  const pairs = withData.filter((w) => w.treatmentChangePct != null)
  const hasEnoughForCorrelation = pairs.length >= 3
  const correlation = hasEnoughForCorrelation
    ? round2(pearsonCorrelation(pairs.map((p) => p.visibilityChangePct), pairs.map((p) => p.treatmentChangePct)))
    : null
  const hasEnoughForConfidenceInterval = pairs.length >= 4
  const confInterval = hasEnoughForConfidenceInterval ? confidenceInterval95(correlation, pairs.length) : null

  return {
    title: 'Turizm ve İhracat Korelasyonu',
    status: 'gerçek-veri-mevcut',
    dataSource:
      'T.C. Kültür ve Turizm Bakanlığı (YİGM) Sınır İstatistikleri Bülteni — otomatik, aylık çekiliyor (bkz. server/services/tourismData.js)',
    sampleSize: withData.length,
    correlation,
    confidenceInterval: confInterval,
    hasEnoughForCorrelation,
    hasEnoughForConfidenceInterval,
    countries: withData,
  }
}

export async function buildImpactReport(countries, destinationRanking = []) {
  const hasEnoughHistoryForTrends = countries.some((c) => c.trend?.direction !== 'yetersiz-veri')
  const countryBreakdown = topByScoreWithRemainder(countries, 5)
  const destinationBreakdown = topDestinationsWithRemainder(destinationRanking, 5)

  const risingList = rising(countries, 5)
  const risingIso2Set = new Set(countries.filter((c) => c.trend?.direction === 'yükseliyor').map((c) => c.iso2))
  const risingCountries = await withSuggestedControls(risingList, risingIso2Set)

  let tourismCorrelation = null
  try {
    const trackedIso2s = getTrackedIso2s()
    const tourismCandidates = risingWithTourismData(countries, trackedIso2s, TOURISM_CANDIDATE_CAP)
    const tourismCandidatesWithControls = await withSuggestedControls(tourismCandidates, risingIso2Set)
    tourismCorrelation = await computeTourismCorrelation(tourismCandidatesWithControls)
  } catch (err) {
    console.error('[impact] turizm korelasyonu hesaplanamadı:', err.message)
  }

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
