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
import { runReytingtvSyncIfNeeded } from './services/reytingtvRunner.js'
import { runFlixpatrolSyncIfNeeded } from './services/flixpatrolRunner.js'
import { runNightlyPrefillIfNeeded } from './services/nightlyPrefill.js'
import { runFlixpatrolTitlesIfNeeded } from './services/flixpatrolTitlesRunner.js'
import { runImdbSyncIfNeeded } from './services/imdbRunner.js'
import { runWikiMonthlyRefreshIfNeeded } from './services/wikiMonthlyRefresh.js'
import { syncForeignStudentsIfNeeded } from './services/foreignStudents.js'
import { runYoutubeSyncIfNeeded } from './services/youtubeAnalytics.js'
import { runYoutubePublicIfNeeded } from './services/youtubePublic.js'
import { runTvGuideIfNeeded } from './services/tvGuide.js'
import { runSearchFillIfNeeded } from './services/searchFill.js'

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

// Günlük tazeleme (TMDB verisi + yapay zekâ sınıflandırması) uzarsa en fazla bu kadar beklenir; sonra arka planda
// sürer ve zenginleştirme zinciri (basın taraması, arama doldurma, TV rehberi…) sırasını kaybetmez. Önceden
// tazeleme takıldığında (2026-10-05'ten beri) zincirin hiçbir işi çalışmıyordu.
export const DAILY_REFRESH_WAIT_MS = 10 * 60 * 1000
let gunlukCalisiyor = false

export async function runScheduledRefreshInner({ dailyWaitMs = DAILY_REFRESH_WAIT_MS } = {}) {
  if (gunlukTazelemeSirasiGeldi() && !gunlukCalisiyor) {
    gunlukCalisiyor = true
    const tazeleme = runGunlukTazeleme().finally(() => {
      gunlukCalisiyor = false
    })
    let zamanAsimi
    const bekle = new Promise((resolve) => {
      zamanAsimi = setTimeout(() => {
        console.warn('[scheduler] günlük tazeleme uzadı; arka planda sürüyor, zincire geçiliyor')
        resolve()
      }, dailyWaitMs)
      zamanAsimi.unref?.()
    })
    await Promise.race([tazeleme, bekle])
    clearTimeout(zamanAsimi)
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
    await syncForeignStudentsIfNeeded()
  } catch (err) {
    console.error('[scheduler] öğrenci verisi eşitlemesi başarısız:', err.message)
  }

  try {
    await runWikiMonthlyRefreshIfNeeded()
  } catch (err) {
    console.error('[scheduler] aylık okunma tazelemesi başarısız:', err.message)
  }

  // Bağlı YouTube kanalları (yapılandırma yoksa hiçbir şey yapmaz).
  try {
    await runYoutubeSyncIfNeeded()
  } catch (err) {
    console.error('[scheduler] YouTube eşitlemesi başarısız:', err.message)
  }

  // Afrika televizyon rehberi (izinli; TV_GUIDE_ENABLED=false ile kapanır), günde bir kez.
  try {
    await runTvGuideIfNeeded()
  } catch (err) {
    console.error('[scheduler] televizyon rehberi toplaması başarısız:', err.message)
  }

  // Aylık arama verisi doldurma (SerpApi; brifinglerin arama ilgisi ve arama payı, Türkçe öğrenme ilgisi).
  try {
    await runSearchFillIfNeeded()
  } catch (err) {
    console.error('[scheduler] aylık arama verisi doldurma başarısız:', err.message)
  }

  // Gece ön doldurma (Türkiye saatiyle 01–10, günde bir kez): dizi raporu basın tonu ve ülke paneli bölgesel ilgisi tıklamada
  // ücretli sorgu yapmasın diye önceden hazırlanır.
  try {
    await runNightlyPrefillIfNeeded()
  } catch (err) {
    console.error('[scheduler] gece ön doldurma başarısız:', err.message)
  }

  // YouTube herkese açık veri (YOUTUBE_API_KEY yoksa hiçbir şey yapmaz).
  try {
    await runYoutubePublicIfNeeded()
  } catch (err) {
    console.error('[scheduler] YouTube herkese açık veri toplaması başarısız:', err.message)
  }

  try {
    await runNetflixSyncIfNeeded()
  } catch (err) {
    console.error('[scheduler] Netflix senkronizasyonu başarısız:', err.message)
  }

  // Türkiye TV günlük listesi bağımsız çalışır. Önceden Netflix'in catch bloğunun içindeydi, yani
  // yalnızca Netflix hata verdiğinde çalışıyordu (zamanlanmış hiçbir reytingtv koşusu kaydı yoktu).
  try {
    await runReytingtvSyncIfNeeded()
  } catch (err) {
    console.error('[scheduler] Türkiye TV listesi çekimi başarısız:', err.message)
  }

  // IMDb puan/oy senkronu günlük ve kısa (~1 dk); oy artışı ölçüsü gün atlamamalı, bu yüzden 2,5 saate
  // kadar sürebilen FlixPatrol'dan ÖNCE çalışır.
  try {
    await runImdbSyncIfNeeded()
  } catch (err) {
    console.error('[scheduler] IMDb senkronizasyonu başarısız:', err.message)
  }

  // FlixPatrol bağımsız çalışır (Netflix/reyting sonucundan etkilenmez); haftalık kapı
  // runFlixpatrolSyncIfNeeded içinde. Cloudflare/tarayıcı gerektirdiğinden yalnızca yerelde.
  try {
    await runFlixpatrolSyncIfNeeded()
    // Dizi sayfaları: liste taramasının görmediği platformlar ve son 7 günün sıraları (günde bir, en fazla 45 dk).
    await runFlixpatrolTitlesIfNeeded()
  } catch (err) {
    console.error('[scheduler] FlixPatrol senkronizasyonu başarısız:', err.message)
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
