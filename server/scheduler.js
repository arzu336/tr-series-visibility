import db from './db.js'
import { purgeExpiredSessions } from './auth.js'
import { purgeExpiredCacheEntries } from './cache.js'
import { getEnrichedVisibility } from './data-pipeline.js'
import { rollupMonthlyIfNeeded } from './period-history.js'
import { rollupSeriesMonthlyIfNeeded } from './series-period-history.js'
import { syncTourismDataIfNeeded } from './services/tourismData.js'
import { runAutoNewsScanIfNeeded } from './services/autoNewsScheduler.js'
import { runTourismTrendsCollectionIfNeeded } from './services/tourismTrendsCollector.js'
import { runSocialEnrichmentIfNeeded } from './services/socialEnricher.js'
import { runActorTrendsCollectionIfNeeded } from './services/actorTrendsCollector.js'
import { runNetflixSyncIfNeeded } from './services/netflixPipelineRunner.js'

const CHECK_INTERVAL_MS = 30 * 60 * 1000
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
export const META_KEY = 'lastScheduledRefreshAt'

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

let refreshRunning = false

async function runScheduledRefresh() {
  if (refreshRunning) {
    console.log('[scheduler] önceki tur hâlâ sürüyor — bu tetikleme atlandı')
    return
  }
  refreshRunning = true
  try {
    await runScheduledRefreshInner()
  } finally {
    refreshRunning = false
  }
}

function gunlukTazelemeSirasiGeldi() {
  const row = getMetaStmt.get(META_KEY)
  const lastRunAt = row ? Number(row.value) : 0
  return Date.now() - lastRunAt >= REFRESH_INTERVAL_MS
}

export async function runScheduledRefreshInner() {
  if (gunlukTazelemeSirasiGeldi()) {
    await runGunlukTazeleme()
  }
  await runZenginlestirmeZinciri()
}

async function runGunlukTazeleme() {
  console.log('[scheduler] zamanlanmış veri tazeleme başladı')
  try {
    const purged = purgeExpiredSessions()
    if (purged > 0) console.log(`[scheduler] süresi geçmiş ${purged} oturum temizlendi`)

    const purgedCache = purgeExpiredCacheEntries()
    if (purgedCache > 0) console.log(`[scheduler] süresi geçmiş ${purgedCache} önbellek kaydı temizlendi`)

    await getEnrichedVisibility({ waitForClassification: true })
    rollupMonthlyIfNeeded()
    rollupSeriesMonthlyIfNeeded()
    setMetaStmt.run(META_KEY, String(Date.now()))
    console.log('[scheduler] zamanlanmış veri tazeleme tamamlandı')
  } catch (err) {
    console.error('[scheduler] zamanlanmış veri tazeleme başarısız:', err.message)
  }
}

async function runZenginlestirmeZinciri() {
  try {
    await syncTourismDataIfNeeded()
  } catch (err) {
    console.error('[scheduler] turizm verisi senkronizasyonu başarısız:', err.message)
  }

  try {
    await runAutoNewsScanIfNeeded()
  } catch (err) {
    console.error('[scheduler] otomatik basın taraması başarısız:', err.message)
  }
  try {
    await runTourismTrendsCollectionIfNeeded()
  } catch (err) {
    console.error('[scheduler] öncü turizm sinyali taraması başarısız:', err.message)
  }
  if (process.env.ENABLE_SOCIAL_ENRICHMENT === 'true') {
    try {
      await runSocialEnrichmentIfNeeded()
    } catch (err) {
      console.error('[scheduler] sosyal zenginleştirme başarısız:', err.message)
    }
  }
  if (process.env.ENABLE_ACTOR_TRENDS === 'true') {
    try {
      await runActorTrendsCollectionIfNeeded()
    } catch (err) {
      console.error('[scheduler] oyuncu trend taraması başarısız:', err.message)
    }
  }

  try {
    await runNetflixSyncIfNeeded()
  } catch (err) {
    console.error('[scheduler] Netflix senkronizasyonu başarısız:', err.message)
  }
}

// Yeniden başlatma sonrası ilk tur 30 dakika beklemesin: sunucu ayağa kalkıp ilk istekleri
// karşıladıktan kısa süre sonra bir tur atılır (günlük kapı kapalıysa yalnızca haftalık zincir
// sırasını alır, boşa iş yapılmaz).
export const INITIAL_DELAY_MS = 60 * 1000

export function startScheduler({ initialDelayMs = INITIAL_DELAY_MS, intervalMs = CHECK_INTERVAL_MS } = {}) {
  const ilk = setTimeout(() => {
    runScheduledRefresh()
  }, initialDelayMs)
  ilk.unref()
  const periyodik = setInterval(() => {
    runScheduledRefresh()
  }, intervalMs)
  periyodik.unref()
  return () => {
    clearTimeout(ilk)
    clearInterval(periyodik)
  }
}
