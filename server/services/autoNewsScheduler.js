import db from '../db.js'
import { getEnrichmentTargets } from './enrichmentTargets.js'
import { fetchAndAnalyzeSentiment } from './newsSentiment.js'
import { GDELT_PRIORITY } from './gdeltNews.js'

const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000
const META_KEY = 'lastAutoNewsScanAt'

const MAX_RUN_MS = 25 * 60 * 1000
const DELAY_AFTER_LIVE_CALL_MS = 1500

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * `priority`: GDELT kuyruğundaki sıra — zamanlanmış tarama BACKGROUND, kullanıcı tetiklemeli
 * tarama INTERACTIVE (öne geçer). `onProgress({ done, total, current })` her ülkeden sonra çağrılır.
 */
export async function scanSeriesAcrossCountries(
  seriesId,
  seriesName,
  countryIso2s,
  { throttle, deadline, priority = GDELT_PRIORITY.BACKGROUND, onProgress } = {}
) {
  let scanned = 0
  let liveCalls = 0
  let failed = 0
  let deadlineReached = false
  const total = countryIso2s.length
  for (const iso2 of countryIso2s) {
    if (deadline && Date.now() >= deadline) {
      deadlineReached = true
      break
    }
    try {
      const result = await fetchAndAnalyzeSentiment(seriesId, seriesName, null, iso2, { priority })
      scanned++
      if (!result.fromCache) {
        liveCalls++
        if (throttle) await sleep(DELAY_AFTER_LIVE_CALL_MS)
      }
    } catch (err) {
      failed++
      console.error(`[autoNewsScheduler] ${seriesName}/${iso2} taranamadı:`, err.message)
    }
    onProgress?.({ done: scanned + failed, total, current: iso2 })
  }
  return { scanned, liveCalls, failed, deadlineReached }
}

export async function runAutoNewsScanIfNeeded() {
  const row = getMetaStmt.get(META_KEY)
  const lastRunAt = row ? Number(row.value) : 0
  if (Date.now() - lastRunAt < WEEKLY_MS) return

  const deadline = Date.now() + MAX_RUN_MS
  console.log('[autoNewsScheduler] haftalık otomatik basın taraması dilimi başladı')
  let totalScanned = 0
  let totalLive = 0
  let totalFailed = 0
  let tamamlandi = true

  try {
    const { topSeries, topCountries } = await getEnrichmentTargets()

    for (const series of topSeries) {
      const result = await scanSeriesAcrossCountries(series.id, series.name, topCountries, {
        throttle: true,
        deadline,
      })
      totalScanned += result.scanned
      totalLive += result.liveCalls
      totalFailed += result.failed
      if (result.deadlineReached) {
        tamamlandi = false
        break
      }
    }

    if (tamamlandi) {
      setMetaStmt.run(META_KEY, String(Date.now()))
      console.log(
        `[autoNewsScheduler] TUR TAMAMLANDI — bu dilimde ${totalScanned} çift işlendi (${totalLive} canlı GDELT çağrısı, ${totalFailed} hata).`
      )
    } else {
      console.log(
        `[autoNewsScheduler] dilim süre sınırına ulaştı — ${totalScanned} çift işlendi (${totalLive} canlı GDELT çağrısı, ${totalFailed} hata). Tur bitmedi, sıradaki tetiklemede kaldığı yerden devam edecek.`
      )
    }
  } catch (err) {
    console.error('[autoNewsScheduler] otomatik basın taraması başarısız:', err.message)
  }
}

export async function enrichSeriesNewsNow(seriesId, seriesName, countryIso2s, { onProgress } = {}) {
  return scanSeriesAcrossCountries(seriesId, seriesName, countryIso2s, {
    throttle: false,
    priority: GDELT_PRIORITY.INTERACTIVE,
    onProgress,
  })
}
