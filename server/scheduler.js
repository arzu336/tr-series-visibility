import db from './db.js'
import { getEnrichedVisibility } from './data-pipeline.js'

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
    setMetaStmt.run(META_KEY, String(Date.now()))
    console.log('[scheduler] zamanlanmış veri tazeleme tamamlandı')
  } catch (err) {
    console.error('[scheduler] zamanlanmış veri tazeleme başarısız:', err.message)
  }
}

// Proje raporunun §4.7'sinde önerilen n8n tabanlı "zamanlanmış tetikleme"
// katmanının kod-içi karşılığı — ayrı bir workflow aracı kurmadan, TMDB +
// LLM tema sınıflandırma + görünürlük geçmişi anlık görüntüsünü günde bir
// kez otomatik tetikler. Böylece hiç kullanıcı gelmese bile trend takibi
// (visibility_history) kesintiye uğramaz ve veri her zaman en fazla ~24
// saatlik.
//
// SerpAPI/Trakt bilerek bu döngüye DAHİL EDİLMEDİ: onlar talep-üzerine ve
// aylık kotalı (bkz. bütçe raporu, SerpAPI free tier 250 sorgu/ay) — 200
// diziyi otomatik taramak kotayı anında tüketir. TMDB ve dahili LLM
// sunucusunun böyle bir kısıtı yok.
export function startScheduler() {
  setInterval(() => {
    const row = getMetaStmt.get(META_KEY)
    const lastRunAt = row ? Number(row.value) : 0
    if (Date.now() - lastRunAt >= REFRESH_INTERVAL_MS) {
      runScheduledRefresh()
    }
  }, CHECK_INTERVAL_MS)
}
