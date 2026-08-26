import db from './db.js'
import { getEnrichedVisibility } from './data-pipeline.js'
import { rollupMonthlyIfNeeded } from './period-history.js'
import { rollupSeriesMonthlyIfNeeded } from './series-period-history.js'
import { syncTourismDataIfNeeded } from './services/tourismData.js'
import { runAutoNewsScanIfNeeded } from './services/autoNewsScheduler.js'
import { runTourismTrendsCollectionIfNeeded } from './services/tourismTrendsCollector.js'
import { runSocialEnrichmentIfNeeded } from './services/socialEnricher.js'

const CHECK_INTERVAL_MS = 30 * 60 * 1000 // her 30 dakikada bir "sırası geldi mi" kontrolü
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000 // hedef: günde 1 kez
export const META_KEY = 'lastScheduledRefreshAt'

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

async function runScheduledRefresh() {
  console.log('[scheduler] zamanlanmış veri tazeleme başladı')
  try {
    await getEnrichedVisibility()
    // Ham visibility_history budanmadan önce (bkz. MAX_SNAPSHOTS_PER_COUNTRY, history.js)
    // tamamlanmış ayları kalıcı özet tabloya taşır — kendi günlük kapısı var (period-history.js).
    rollupMonthlyIfNeeded()
    rollupSeriesMonthlyIfNeeded()
    setMetaStmt.run(META_KEY, String(Date.now()))
    console.log('[scheduler] zamanlanmış veri tazeleme tamamlandı')
  } catch (err) {
    console.error('[scheduler] zamanlanmış veri tazeleme başarısız:', err.message)
  }

  // Turizm bülteni ayda bir yayınlanıyor — günlük tazelemeden BAĞIMSIZ, kendi haftalık kapısıyla
  // (tourismData.js) çalışır; başarısız olursa (site erişilemez, format değişmiş) diğer hiçbir
  // özelliği etkilemez.
  try {
    await syncTourismDataIfNeeded()
  } catch (err) {
    console.error('[scheduler] turizm verisi senkronizasyonu başarısız:', err.message)
  }

  // SerpAPI'ye dayalı 3 haftalık toplu zenginleştirme (basın taraması, öncü turizm sinyali,
  // sosyal/YouTube) — sırayla (paralel DEĞİL) çalıştırılır ki paylaşılan aylık kota bütçesi
  // (bkz. serpApiCache.js SERPAPI_MONTHLY_BUDGET) üç işin arasında öngörülebilir şekilde
  // bölüşülsün. Her biri kendi 7 günlük meta-kapısını kontrol eder, hazır değilse anında döner;
  // biri başarısız olursa (kota, ağ) diğer ikisi etkilenmez.
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
  try {
    await runSocialEnrichmentIfNeeded()
  } catch (err) {
    console.error('[scheduler] sosyal zenginleştirme başarısız:', err.message)
  }
}

// Proje raporunun §4.7'sinde önerilen n8n tabanlı "zamanlanmış tetikleme"
// katmanının kod-içi karşılığı — ayrı bir workflow aracı kurmadan, TMDB +
// LLM tema sınıflandırma + görünürlük geçmişi anlık görüntüsünü günde bir
// kez otomatik tetikler. Böylece hiç kullanıcı gelmese bile trend takibi
// (visibility_history) kesintiye uğramaz ve veri her zaman en fazla ~24
// saatlik.
//
// IMDb (OMDb) bilerek bu döngüye DAHİL EDİLMEDİ: talep-üzerine ve kendi kotası var, 200 diziyi
// otomatik taramak o kotayı anında tüketir. TMDB ve dahili LLM sunucusunun böyle bir kısıtı yok.
//
// SerpAPI ise ARTIK dahil — plan 5.000 sorgu/ay'a yükseltildi (2026-08-26, kullanıcı teyidi; bu
// yorumun önceki "250 sorgu/ay" hâli GÜNCEL DEĞİLDİ). Yine de tüm SerpAPI çağrıları TEK bir
// merkezi aylık bütçe sayacından geçiyor (bkz. serpApiCache.js SERPAPI_MONTHLY_BUDGET) — bu
// üç haftalık toplu iş (aşağıda) o bütçeyi kullanıcı tetiklemeli aramalarla (trend/sosyal/basın
// tıklamaları) PAYLAŞIR, aşarsa dürüstçe kalanı bir sonraki haftaya bırakır, uygulamayı çökertmez.
export function startScheduler() {
  setInterval(() => {
    const row = getMetaStmt.get(META_KEY)
    const lastRunAt = row ? Number(row.value) : 0
    if (Date.now() - lastRunAt >= REFRESH_INTERVAL_MS) {
      runScheduledRefresh()
    }
  }, CHECK_INTERVAL_MS)
}
