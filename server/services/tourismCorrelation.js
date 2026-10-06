import { getTrackedIso2s } from './tourismData.js'
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
  /* eslint-disable no-loss-of-precision -- Lanczos katsayıları (Numerical Recipes); double'a yuvarlanması yöntemin parçası, değiştirilmemeli */
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2,
    -0.5395239384953e-5,
  ]
  /* eslint-enable no-loss-of-precision */
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) {
    y += 1
    ser += cof[j] / y
  }
  // eslint-disable-next-line no-loss-of-precision -- sqrt(2π) sabiti, aynı gerekçe
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
