import { suggestControlCountry } from '../control-matching.js'
import { getVisitorSeries, getTrackedIso2s, pickBeforeAfterPair } from './tourismData.js'
import { cacheFirstSerpApi, fetchTrendsTimeSeriesRaw, timeSeriesCacheKey, TIMESERIES_TTL_MS } from './serpApiCache.js'

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

export function pValueForPearsonR(r, n) {
  if (n < 3) return null
  const df = n - 2
  const rc = Math.max(-0.999999, Math.min(0.999999, r))
  if (rc === 0) return 1
  const t = rc * Math.sqrt(df / (1 - rc * rc))
  return Math.round(tDistTwoTailedP(Math.abs(t), df) * 10000) / 10000
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function round2(n) {
  return Math.round(n * 100) / 100
}

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
