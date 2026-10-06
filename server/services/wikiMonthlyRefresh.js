import db from '../db.js'
import { refreshRecentMonths } from './wikipediaBackfill.js'

// Okunma ilgisi (ülke brifingi) için aylık tazeleme: her ayın 2'sinden itibaren bir kez, son 3 tamamlanmış
// ay yeniden çekilir (Wikimedia aylık toplamları ay bitiminden sonraki ilk gün içinde kesinleşir). Önceden bu
// veri yalnızca elle çalıştırılan bir betikle bir kez toplanıyordu ve son ay yarım kalıyordu.

export const META_LAST_MONTH = 'lastWikiMonthlyRefresh'
export const READY_FROM_DAY = 2

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

const monthKey = (d) => d.toISOString().slice(0, 7)

/** Bu ay henüz tazelenmediyse ve ayın 2'si geldiyse. */
export function isWikiRefreshDue({ now = new Date(), lastMonth = null } = {}) {
  if (now.getUTCDate() < READY_FROM_DAY) return false
  return lastMonth !== monthKey(now)
}

let running = false

export async function runWikiMonthlyRefreshIfNeeded({ now = new Date(), refresh = refreshRecentMonths } = {}) {
  if (running) return { status: 'skipped', reason: 'running' }
  if (!isWikiRefreshDue({ now, lastMonth: getMetaStmt.get(META_LAST_MONTH)?.value ?? null })) return null
  running = true
  const basladi = Date.now()
  try {
    console.log('[wiki-refresh] aylık okunma tazelemesi başladı (son 3 ay)')
    const sonuc = await refresh({ now })
    // Çoğu istek başarısızsa (ağ sorunu) bu ay tekrar denensin diye işaretlenmez.
    if (sonuc.cift > 0 && sonuc.hatali / sonuc.cift > 0.5) {
      console.error(`[wiki-refresh] başarısız: ${sonuc.hatali}/${sonuc.cift} istek hata verdi`)
      return { status: 'failed', ...sonuc }
    }
    setMetaStmt.run(META_LAST_MONTH, monthKey(now))
    console.log(
      `[wiki-refresh] tamamlandı (${Math.round((Date.now() - basladi) / 1000)} sn): ${sonuc.yazilanSatir} satır, son ay ${sonuc.son}`
    )
    return { status: 'ok', ...sonuc }
  } finally {
    running = false
  }
}
