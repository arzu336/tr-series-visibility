function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

// Hazır ve doğruluğu doğrulanmış istatistik yöntemleri — gerçek TÜİK/Kültür ve Turizm
// Bakanlığı turist-ihracat verisi kurumsal talep yoluyla temin edilene kadar hiçbir
// sahte/örnek girdiyle çağrılmıyor (bkz. pendingAnalysis).
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

function round1(n) {
  return Math.round(n * 10) / 10
}

function round2(n) {
  return Math.round(n * 100) / 100
}

// Gerçek turizm/ihracat korelasyonu için gereken kurumsal veri kaynakları. Bu veri
// gelene kadar hiçbir sayı üretilmiyor — yöntem (pearsonCorrelation, confidenceInterval95)
// hazır ve doğrulanmış, sadece girdi bekliyor.
const PENDING_ANALYSIS = {
  title: 'Turizm ve İhracat Korelasyonu',
  status: 'gerçek-veri-bekleniyor',
  description:
    'Bu analiz için ülke bazlı, gerçek turist girişi ve dizi ihracatı verisi gerekiyor. İkisi de kurumsal veri talebiyle temin edilebiliyor; kamuya açık bir API yok. Veri sağlandığında burada gerçek bir Difference-in-Differences (DiD) düzeltmesi ve Pearson korelasyonu gösterilecek — hesaplama yöntemi zaten hazır ve doğrulanmış durumda, sadece gerçek girdi bekliyor.',
  requiredSources: [
    'TÜİK turist giriş istatistikleri (ülke bazlı, aylık)',
    'Kültür ve Turizm Bakanlığı / TGA dizi ihracat verisi (ülke bazlı)',
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

export function buildImpactReport(countries, destinationRanking = []) {
  const hasEnoughHistoryForTrends = countries.some((c) => c.trend?.direction !== 'yetersiz-veri')
  const countryBreakdown = topByScoreWithRemainder(countries, 5)
  const destinationBreakdown = topDestinationsWithRemainder(destinationRanking, 5)

  return {
    generatedAt: new Date().toISOString(),
    topCountriesByVisibility: countryBreakdown.top,
    otherCountriesScore: countryBreakdown.otherScore,
    risingCountries: rising(countries, 5),
    hasEnoughHistoryForTrends,
    topDestinations: destinationBreakdown.top,
    otherDestinationsScore: destinationBreakdown.otherScore,
    pendingAnalysis: PENDING_ANALYSIS,
  }
}
