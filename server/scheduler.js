import db from './db.js'
import { purgeExpiredSessions } from './auth.js'
import { purgeExpiredCacheEntries } from './cache.js'
import { getEnrichedVisibility } from './data-pipeline.js'
import { rollupMonthlyIfNeeded } from './period-history.js'
import { rollupSeriesMonthlyIfNeeded } from './series-period-history.js'
import { syncTourismDataIfNeeded } from './services/tourismData.js'
import { syncExportsIfNeeded } from './services/exportsData.js'
import { runAutoNewsScanIfNeeded } from './services/autoNewsScheduler.js'
import { runTourismTrendsCollectionIfNeeded } from './services/tourismTrendsCollector.js'
import { runSocialEnrichmentIfNeeded } from './services/socialEnricher.js'
import { runActorTrendsCollectionIfNeeded } from './services/actorTrendsCollector.js'
import { runNetflixSyncIfNeeded } from './services/netflixPipelineRunner.js'
import { fetchNetflixReleaseIfNeeded } from './services/netflixRelease.js'
import { runReytingtvSyncIfNeeded } from './services/reytingtvRunner.js'
import { runFlixpatrolSyncIfNeeded } from './services/flixpatrolRunner.js'
import { runNightlyPrefillIfNeeded } from './services/nightlyPrefill.js'
import { runFlixpatrolTitlesIfNeeded } from './services/flixpatrolTitlesRunner.js'
import { runTabiiCatalogIfNeeded } from './services/tabiiCatalog.js'
import { runElcinemaGuideIfNeeded } from './services/elcinemaGuide.js'
import { runMiTvGuideIfNeeded } from './services/miTvGuide.js'
import { runEpgPwGuideIfNeeded } from './services/epgPwGuide.js'
import { runItvUzGuideIfNeeded } from './services/itvUzGuide.js'
import { runMagticomGuideIfNeeded } from './services/magticomGuide.js'
import { refreshWikidataLabelsIfNeeded } from './services/wikidataLabels.js'
import { runOnlineViewsIfNeeded } from './services/onlineViews.js'
import { runSalesNewsIfNeeded } from './services/salesNews.js'
import { warmImageCacheIfNeeded } from './services/imageCache.js'
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

/**
 * Zincir adımı (2026-10-16): hata yalnızca loga değil meta'ya da yazılır (jobAttempt:<ad>, jobError:<ad>) — sunucu logu
 * elde olmadan hangi adımın ne zaman, neden takıldığı görülebilsin. Bir adımın hatası zinciri durdurmaz.
 */
async function adim(ad, fn) {
  setMetaStmt.run(`jobAttempt:${ad}`, String(Date.now()))
  try {
    const sonuc = await fn()
    // İşin kendisi hata yutup `errors` listesiyle dönüyorsa (yayın akışı, çevrimiçi izlenme…) o da görünür olsun.
    const hatalar = Array.isArray(sonuc?.errors) ? sonuc.errors.filter(Boolean) : []
    setMetaStmt.run(
      `jobError:${ad}`,
      hatalar.length ? `${new Date().toISOString()} ${hatalar.slice(0, 3).join(' | ')}`.slice(0, 300) : ''
    )
  } catch (err) {
    setMetaStmt.run(`jobError:${ad}`, `${new Date().toISOString()} ${err.message}`.slice(0, 300))
    console.error(`[scheduler] ${ad}:`, err.message)
  }
}

async function runZenginlestirmeZinciri() {
  await adim('turizm verisi senkronizasyonu başarısız', syncTourismDataIfNeeded)

  // Ülke × sektör × ay ihracat (aylık yeni dosya; geçmiş dosyalar çalıştırma başına sınırlı).
  await adim('ihracat verisi senkronizasyonu başarısız', syncExportsIfNeeded)

  await adim('otomatik basın taraması başarısız', runAutoNewsScanIfNeeded)
  await adim('öncü turizm sinyali taraması başarısız', runTourismTrendsCollectionIfNeeded)
  if (process.env.ENABLE_SOCIAL_ENRICHMENT === 'true') {
    await adim('sosyal zenginleştirme başarısız', runSocialEnrichmentIfNeeded)
  }
  if (process.env.ENABLE_ACTOR_TRENDS === 'true') {
    await adim('oyuncu trend taraması başarısız', runActorTrendsCollectionIfNeeded)
  }

  await adim('öğrenci verisi eşitlemesi başarısız', syncForeignStudentsIfNeeded)

  await adim('aylık okunma tazelemesi başarısız', runWikiMonthlyRefreshIfNeeded)

  // Bağlı YouTube kanalları (yapılandırma yoksa hiçbir şey yapmaz).
  await adim('YouTube eşitlemesi başarısız', runYoutubeSyncIfNeeded)

  // Afrika televizyon rehberi (izinli; TV_GUIDE_ENABLED=false ile kapanır), günde bir kez.
  await adim('televizyon rehberi toplaması başarısız', runTvGuideIfNeeded)

  // Aylık arama verisi doldurma (SerpApi; brifinglerin arama ilgisi ve arama payı, Türkçe öğrenme ilgisi).
  await adim('aylık arama verisi doldurma başarısız', runSearchFillIfNeeded)

  // tabii kataloğu ve ülkeleri (haftalık) — TRT dizilerinin tabii'deki yayın kaydı.
  await adim('tabii kataloğu alınamadı', runTabiiCatalogIfNeeded)

  // elcinema Arap kanalları yayın akışı (günlük, ~5–15 dk).
  await adim('elcinema yayın akışı alınamadı', runElcinemaGuideIfNeeded)

  // mi.tv Latin Amerika yayın akışı (günlük; bilinen kanallar + dönüşümlü dilim).
  await adim('mi.tv yayın akışı alınamadı', runMiTvGuideIfNeeded)

  // Rusya ve Orta Asya yayın akışı (günlük; tek XMLTV dosyası, ~10 MB).
  await adim('Rusya/Orta Asya yayın akışı alınamadı', runEpgPwGuideIfNeeded)

  // Özbekistan yayın akışı (günlük; ~30 kanal).
  await adim('Özbekistan yayın akışı alınamadı', runItvUzGuideIfNeeded)

  // Gürcistan yayın akışı (günlük; ~60 Gürcüce kanal).
  await adim('Gürcistan yayın akışı alınamadı', runMagticomGuideIfNeeded)

  // Dizilerin Wikidata'daki yerel adları (ayda bir; yayın akışı eşlemesi için).
  await adim('dizi yerel adları alınamadı', refreshWikidataLabelsIfNeeded)

  // İran'da çevrimiçi izlenme (haftalık; Farsça adı bilinen ~180 dizi).
  await adim('çevrimiçi izlenme alınamadı', runOnlineViewsIfNeeded)

  // Dizi satış/yayın kayıtları (haftalık; dağıtımcı duyuruları, sektör basını, yayın tabloları; çalıştırma başına sınırlı).
  await adim('satış kayıtları alınamadı', runSalesNewsIfNeeded)

  // Afiş ve kadro fotoğrafları diske (haftalık; görseller dış sunucuya bağımlı kalmasın).
  await adim('görsel önbelleği doldurulamadı', warmImageCacheIfNeeded)

  // Ön doldurma (günde bir kez, sunucu açıkken ilk fırsatta): dizi raporu basın tonu ve ülke paneli bölgesel ilgisi tıklamada
  // ücretli sorgu yapmasın diye önceden hazırlanır.
  await adim('gece ön doldurma başarısız', runNightlyPrefillIfNeeded)

  // YouTube herkese açık veri (YOUTUBE_API_KEY yoksa hiçbir şey yapmaz).
  await adim('YouTube herkese açık veri toplaması başarısız', runYoutubePublicIfNeeded)

  // Netflix kaynak dosyası yayımlanan sürümden (kurum ağında doğrudan inmiyor); yeni hafta varsa hattı çevrimdışı koşar.
  await adim('Netflix kaynak sürümü alınamadı', fetchNetflixReleaseIfNeeded)

  await adim('Netflix senkronizasyonu başarısız', runNetflixSyncIfNeeded)

  // Türkiye TV günlük listesi bağımsız çalışır. Önceden Netflix'in catch bloğunun içindeydi, yani
  // yalnızca Netflix hata verdiğinde çalışıyordu (zamanlanmış hiçbir reytingtv koşusu kaydı yoktu).
  await adim('Türkiye TV listesi çekimi başarısız', runReytingtvSyncIfNeeded)

  // IMDb puan/oy senkronu günlük ve kısa (~1 dk); oy artışı ölçüsü gün atlamamalı, bu yüzden 2,5 saate
  // kadar sürebilen FlixPatrol'dan ÖNCE çalışır.
  await adim('IMDb senkronizasyonu başarısız', runImdbSyncIfNeeded)

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
