import { suggestControlCountry } from '../control-matching.js'
import { getVisitorSeries, getTrackedIso2s, pickBeforeAfterPair } from './tourismData.js'
import { cacheFirstSerpApi, fetchTrendsTimeSeriesRaw, timeSeriesCacheKey, TIMESERIES_TTL_MS } from './serpApiCache.js'

// "Turizm ve İhracat Korelasyonu" modülünün ekonometrik çekirdeği. Önceki sürüm (server/impact.js
// içindeydi) SADECE "son 7 günde yükselen" 3-5 ülkeye bakıyordu — YİGM bülteni aslında 81 ülkeyi
// kapsıyor (doğrulandı, bkz. aşağıdaki not), bu yüzden örneklem yapay şekilde küçüktü. Burada
// "yükseliyor mu" filtresi kaldırılıp GERÇEKTEN görünürlüğü yüksek olan ilk N pazara bakılıyor —
// N gerçek veriyle test edildi, 81 YİGM-izlenen ülkenin TAMAMI zaten görünürlük skoru olan
// ülkelerle örtüşüyor (2026-08-26'da doğrulandı), yani en az 15-20 aday her zaman bulunabiliyor.

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

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

export function differenceInDifferences({ treatmentBefore, treatmentAfter, controlBefore, controlAfter }) {
  const treatmentChange = treatmentAfter - treatmentBefore
  const controlChange = controlAfter - controlBefore
  return {
    didEstimate: round2(treatmentChange - controlChange),
    treatmentChangePct: treatmentBefore === 0 ? null : round2((treatmentChange / treatmentBefore) * 100),
    controlChangePct: controlBefore === 0 ? null : round2((controlChange / controlBefore) * 100),
  }
}

// --- p-değeri: Pearson r için iki-kuyruklu t-testi ---------------------------------------------
// Bu kod tabanında hiç istatistik kütüphanesi yok (bkz. yukarıdaki 3 fonksiyon da elle yazılmış)
// — burada da aynı gelenek: standart "incomplete beta function" algoritmasıyla (Numerical
// Recipes) t-dağılımının kuyruk olasılığı hesaplanıyor. GERÇEK referans kritik t-değerleriyle
// doğrulandı (2026-08-26): df=10,t=2.228→p=0.0500; df=15,t=2.131→p=0.0500; df=10,t=3.169→
// p=0.0100 — hepsi 4 basamağa kadar tutarlı.
function logGamma(x) {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2,
    -0.5395239384953e-5,
  ]
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) {
    y += 1
    ser += cof[j] / y
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

function betacf(a, b, x) {
  const MAXIT = 200
  const EPS = 3e-14
  const FPMIN = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

function incompleteBeta(x, a, b) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a
  return 1 - (bt * betacf(b, a, 1 - x)) / b
}

function tDistTwoTailedP(t, df) {
  const x = df / (df + t * t)
  return incompleteBeta(x, df / 2, 0.5)
}

// n<3 iken serbestlik derecesi (df=n-2) sıfır/negatif olur, tanımsız — null döner (uydurma bir
// p-değeri yerine dürüstçe "hesaplanamaz").
export function pValueForPearsonR(r, n) {
  if (n < 3) return null
  const df = n - 2
  const rc = Math.max(-0.999999, Math.min(0.999999, r))
  if (rc === 0) return 1
  const t = rc * Math.sqrt(df / (1 - rc * rc))
  return Math.round(tDistTwoTailedP(Math.abs(t), df) * 10000) / 10000 // 0-1 arası olasılık, 4 basamağa yuvarlı
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function round2(n) {
  return Math.round(n * 100) / 100
}

// --- Genişletilmiş aday havuzu -----------------------------------------------------------------
// "Son 7 günde yükseliyor" filtresi YOK artık — bunun yerine dizi görünürlüğü GERÇEKTEN yüksek
// olan (skор bazında) ilk N pazar, YİGM'in izlediği 81 ülkeyle kesişimi alınarak seçiliyor.
// 2026-08-26'da gerçek veriyle doğrulandı: 81 YİGM ülkesinin TAMAMI aynı zamanda görünürlük
// skoruna sahip — yani bu kesişim pratikte hep TOP_N_CANDIDATES kadar sonuç veriyor.
const TOP_N_CANDIDATES = 20

export function getExpandedCandidatePool(countries, n = TOP_N_CANDIDATES) {
  const tracked = getTrackedIso2s()
  return [...countries]
    .filter((c) => tracked.has(c.iso2) && c.trend?.direction !== 'yetersiz-veri')
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((c) => ({
      iso2: c.iso2,
      score: round1(c.score),
      changePct: c.trend?.changePct ?? null,
      topSeriesName: c.topSeries?.name || null,
    }))
}

// Adayların hepsi zaten yüksek dizi görünürlüğüne sahip pazarlar olduğu için, birbirlerini
// kontrol ülkesi olarak önermeleri yanlış olur (ikisi de "tedavi" grubunda sayılmalı) — tüm
// aday havuzu dışlama kümesi olarak geçiliyor.
async function withSuggestedControls(candidates) {
  const excludeIso2Set = new Set(candidates.map((c) => c.iso2))
  return Promise.all(
    candidates.map(async (c) => {
      let suggestedControl = null
      try {
        suggestedControl = await suggestControlCountry(c.iso2, excludeIso2Set)
      } catch (err) {
        console.error(`[tourismCorrelation] kontrol ülkesi önerisi alınamadı (${c.iso2}):`, err.message)
      }
      return { ...c, suggestedControl }
    })
  )
}

// --- Google Trends öncü seyahat sinyali (bkz. serpApiCache.js fetchTrendsTimeSeriesRaw) --------
// 3-6 aylık gecikme aralığının ORTASI (16 hafta ≈ 4 ay) BİLEREK TEK BİR gecikme olarak sabit
// tutuluyor — birden fazla gecikmeyi deneyip en yüksek korelasyonu veren gecikmeyi seçmek çoklu
// karşılaştırma yanlılığı (p-hacking) yaratır. "Turkey Travel" gerçek testte İspanya'da 53
// haftanın neredeyse tamamında 0 çıktı (arama hacmi çok düşük) — "Istanbul" tutarlı, gerçek
// mevsimsel varyasyon gösterdi (2026-08-26 doğrulandı), bu yüzden öncü gösterge terimi olarak
// "Istanbul" kullanılıyor.
export const LEADING_INDICATOR_LAG_WEEKS = 16
const LEADING_INDICATOR_TIMEFRAME = 'today 12-m'
const TRAVEL_QUERY = 'Istanbul'
const MIN_LAG_OVERLAP_WEEKS = 8

export function lagCorrelation(diziValues, travelValues, lagWeeks) {
  const n = Math.min(diziValues.length, travelValues.length - lagWeeks)
  if (n < MIN_LAG_OVERLAP_WEEKS) return null
  const xs = diziValues.slice(0, n)
  const ys = travelValues.slice(lagWeeks, lagWeeks + n)
  return { r: round2(pearsonCorrelation(xs, ys)), n }
}

// travelQuery parametreli hale getirildi (varsayılan hâlâ "Istanbul", tek-ülke korelasyon akışı
// aşağıda değişmeden çalışır) — server/services/tourismTrendsCollector.js AYNI fonksiyonu 15
// ülke × 3 sorgu ("Travel to Turkey"/"Istanbul"/"Antalya") için tekrar kullanır, gecikme/korelasyon
// mantığı iki yerde ayrı ayrı yazılmaz.
export async function getTravelLeadingIndicator(iso2, topSeriesName, travelQuery = TRAVEL_QUERY) {
  if (!topSeriesName) return null
  try {
    const [diziResult, travelResult] = await Promise.all([
      cacheFirstSerpApi(timeSeriesCacheKey(topSeriesName, iso2, LEADING_INDICATOR_TIMEFRAME), TIMESERIES_TTL_MS, () =>
        fetchTrendsTimeSeriesRaw(topSeriesName, iso2, LEADING_INDICATOR_TIMEFRAME)
      ),
      cacheFirstSerpApi(timeSeriesCacheKey(travelQuery, iso2, LEADING_INDICATOR_TIMEFRAME), TIMESERIES_TTL_MS, () =>
        fetchTrendsTimeSeriesRaw(travelQuery, iso2, LEADING_INDICATOR_TIMEFRAME)
      ),
    ])
    const diziValues = diziResult.timeline.map((p) => p.value)
    const travelValues = travelResult.timeline.map((p) => p.value)
    const lag = lagCorrelation(diziValues, travelValues, LEADING_INDICATOR_LAG_WEEKS)
    if (!lag) return null
    return {
      iso2,
      seriesName: topSeriesName,
      travelQuery,
      lagWeeks: LEADING_INDICATOR_LAG_WEEKS,
      correlation: lag.r,
      sampleSize: lag.n,
      diziTimeline: diziResult.timeline.map((p) => ({ timestamp: p.timestamp, value: p.value })),
      travelTimeline: travelResult.timeline.map((p) => ({ timestamp: p.timestamp, value: p.value })),
    }
  } catch (err) {
    console.error(`[tourismCorrelation] öncü seyahat sinyali hesaplanamadı (${iso2}/${travelQuery}):`, err.message)
    return null
  }
}

export const PENDING_ANALYSIS = {
  title: 'Turizm ve İhracat Korelasyonu',
  status: 'gerçek-veri-bekleniyor',
  description: 'Yükselen ülkeler için turist/ihracat verisi henüz eşleşmedi.',
  requiredSources: [
    'YİGM turist giriş istatistikleri — otomatik çekiliyor, eşleşen veri yok',
    'Dizi ihracatı (ülke bazlı) — kamuya açık değil',
  ],
}

// Ana orkestrasyon: genişletilmiş aday havuzu → otomatik kontrol ülkesi eşleştirmesi → DiD →
// Pearson r + p-değeri + %95 GA → (en yüksek görünürlüklü eşleşen aday için) öncü seyahat
// sinyali. Hiçbir aşamada uydurma veri yok — veri örtüşmüyorsa o ülke listeden düşer, öncü
// sinyal hesaplanamazsa null döner.
export async function computeTourismCorrelation(countries) {
  const candidates = getExpandedCandidatePool(countries)
  if (candidates.length === 0) return null
  const withControls = await withSuggestedControls(candidates)

  const withData = []
  for (const c of withControls) {
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
      visibilityScore: c.score,
      visibilityChangePct: c.changePct,
      control: c.suggestedControl,
      period: { month: targetPair.month, beforeYear: targetPair.beforeYear, afterYear: targetPair.afterYear },
      didEstimate: did.didEstimate,
      treatmentChangePct: did.treatmentChangePct,
      controlChangePct: did.controlChangePct,
      // Kullanıcının istediği 2 durumlu rozet (Pozitif Katkı / Nötr) — didEstimate negatifse de
      // "Nötr" sayılır (üçüncü bir "Negatif" durumu BİLEREK eklenmedi, tek bir negatif DiD
      // tahmini "dizi turizme zarar veriyor" gibi güçlü bir iddia için tek başına yeterli kanıt
      // değil; ama pozitif bir katkıyı öne çıkarmak makul).
      impactBadge: did.didEstimate > 0 ? 'pozitif-katki' : 'notr',
    })
  }

  if (withData.length === 0) return null

  const pairs = withData.filter((w) => w.visibilityChangePct != null && w.treatmentChangePct != null)
  const hasEnoughForCorrelation = pairs.length >= 3
  const correlation = hasEnoughForCorrelation
    ? round2(pearsonCorrelation(pairs.map((p) => p.visibilityChangePct), pairs.map((p) => p.treatmentChangePct)))
    : null
  const pValue = hasEnoughForCorrelation ? pValueForPearsonR(correlation, pairs.length) : null
  const hasEnoughForConfidenceInterval = pairs.length >= 4
  const confInterval = hasEnoughForConfidenceInterval ? confidenceInterval95(correlation, pairs.length) : null

  const topCandidate = [...withData].sort((a, b) => b.visibilityScore - a.visibilityScore)[0]
  const leadingIndicator = topCandidate
    ? await getTravelLeadingIndicator(topCandidate.iso2, candidates.find((c) => c.iso2 === topCandidate.iso2)?.topSeriesName)
    : null

  return {
    title: 'Turizm ve İhracat Korelasyonu',
    status: 'gerçek-veri-mevcut',
    dataSource: 'YİGM Sınır İstatistikleri Bülteni (otomatik)',
    sampleSize: withData.length,
    correlation,
    pValue,
    confidenceInterval: confInterval,
    hasEnoughForCorrelation,
    hasEnoughForConfidenceInterval,
    countries: withData,
    leadingIndicator,
  }
}
