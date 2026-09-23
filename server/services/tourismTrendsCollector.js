import db from '../db.js'
import { getEnrichedVisibility } from '../data-pipeline.js'
import { getExpandedCandidatePool, getTravelLeadingIndicator, LEADING_INDICATOR_LAG_WEEKS } from './tourismCorrelation.js'
import { getSerpApiUsageThisMonth, TIMESERIES_TTL_MS } from './serpApiCache.js'

const TRAVEL_QUERIES = ['Travel to Turkey', 'Istanbul', 'Antalya']
const TOP_COUNTRY_COUNT = 15
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000
const META_KEY = 'lastTourismTrendsCollectAt'
const DELAY_AFTER_LIVE_CALL_MS = 1500

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)
const upsertSignalStmt = db.prepare(`
  INSERT INTO tourism_leading_signal
    (country_iso2, travel_query, top_series_name, lag_weeks, correlation, sample_size, computed_at, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(country_iso2, travel_query) DO UPDATE SET
    top_series_name = excluded.top_series_name,
    lag_weeks = excluded.lag_weeks,
    correlation = excluded.correlation,
    sample_size = excluded.sample_size,
    computed_at = excluded.computed_at,
    expires_at = excluded.expires_at
`)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runTourismTrendsCollectionIfNeeded() {
  const row = getMetaStmt.get(META_KEY)
  const lastRunAt = row ? Number(row.value) : 0
  if (Date.now() - lastRunAt < WEEKLY_MS) return

  console.log('[tourismTrendsCollector] haftalık öncü turizm sinyali taraması başladı')
  let computed = 0
  let skippedNoSeries = 0
  let failed = 0

  try {
    const { data } = await getEnrichedVisibility()
    const candidates = getExpandedCandidatePool(data.countries, TOP_COUNTRY_COUNT)
    const nowIso = new Date().toISOString()

    outer: for (const candidate of candidates) {
      if (!candidate.topSeriesName) {
        skippedNoSeries++
        continue
      }
      for (const travelQuery of TRAVEL_QUERIES) {
        const usage = getSerpApiUsageThisMonth()
        if (usage.used >= usage.budget - 1) {
          const remaining = (candidates.length - computed - skippedNoSeries) * TRAVEL_QUERIES.length
          console.warn(
            `[tourismTrendsCollector] aylık SerpAPI kotası doldu (${usage.used}/${usage.budget}) — kalan ~${remaining} ülke/sorgu çifti bir sonraki döngüye bırakıldı.`
          )
          break outer
        }
        try {
          const signal = await getTravelLeadingIndicator(candidate.iso2, candidate.topSeriesName, travelQuery)
          if (signal) {
            upsertSignalStmt.run(
              candidate.iso2,
              travelQuery,
              candidate.topSeriesName,
              signal.lagWeeks,
              signal.correlation,
              signal.sampleSize,
              nowIso,
              Date.now() + TIMESERIES_TTL_MS
            )
            computed++
          }
        } catch (err) {
          failed++
          console.error(`[tourismTrendsCollector] ${candidate.iso2}/${travelQuery} hesaplanamadı:`, err.message)
        }
        await sleep(DELAY_AFTER_LIVE_CALL_MS)
      }
    }

    setMetaStmt.run(META_KEY, String(Date.now()))
    console.log(
      `[tourismTrendsCollector] tarama tamamlandı — ${computed} sinyal hesaplandı (${skippedNoSeries} ülke dizi eksikliğinden atlandı, ${failed} hata).`
    )
  } catch (err) {
    console.error('[tourismTrendsCollector] öncü turizm sinyali taraması başarısız:', err.message)
  }
}

const getFreshSignalsStmt = db.prepare(
  'SELECT country_iso2, travel_query, top_series_name, lag_weeks, correlation, sample_size, computed_at FROM tourism_leading_signal WHERE expires_at > ?'
)

function kritikKorelasyon(sampleSize) {
  const df = sampleSize - 2
  if (df < 3) return null
  const t = df >= 30 ? 2.04 : df >= 20 ? 2.09 : df >= 10 ? 2.23 : 2.57
  return Math.round((t / Math.sqrt(df + t * t)) * 1000) / 1000
}

export function getTourismLeadingSignalSummary() {
  const rows = getFreshSignalsStmt.all(Date.now())
  if (rows.length === 0) {
    return { status: 'gerçek-veri-bekleniyor', lagWeeksRange: '3-6 ay', signals: [], strongestSignal: null }
  }
  const signals = rows.map((r) => {
    const criticalR = kritikKorelasyon(r.sample_size)
    return {
      iso2: r.country_iso2,
      travelQuery: r.travel_query,
      topSeriesName: r.top_series_name,
      lagWeeks: r.lag_weeks,
      correlation: r.correlation,
      sampleSize: r.sample_size,
      computedAt: r.computed_at,
      direction: r.correlation > 0 ? 'pozitif' : r.correlation < 0 ? 'negatif' : 'nötr',
      criticalR,
      significant: criticalR != null && Math.abs(r.correlation) >= criticalR,
    }
  })
  const sirali = [...signals].sort((a, b) => {
    if (a.significant !== b.significant) return a.significant ? -1 : 1
    return Math.abs(b.correlation) - Math.abs(a.correlation)
  })
  const anlamliSayisi = signals.filter((s) => s.significant).length
  return {
    status: 'gerçek-veri-mevcut',
    lagWeeksRange: `${LEADING_INDICATOR_LAG_WEEKS} hafta (~4 ay)`,
    countriesScanned: new Set(signals.map((s) => s.iso2)).size,
    signalCount: signals.length,
    significantCount: anlamliSayisi,
    signals: sirali,
    strongestSignal: anlamliSayisi > 0 ? sirali[0] : null,
  }
}
