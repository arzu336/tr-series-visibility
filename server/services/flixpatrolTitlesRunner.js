import db from '../db.js'
import { runFlixpatrolFetch } from './flixpatrolRunner.js'

// FlixPatrol dizi sayfaları (data-pipeline-python/fetch_flixpatrol_titles.py; 2026-10-09). Her dizinin kendi
// sayfasından girdiği BÜTÜN platformların puanları ve son 7 günün ülke sıraları alınır (liste taramasının görmediği
// STARZPLAY, Vidio… dahil). Günde bir kez, en fazla 45 dk: eşlemesi olan dizilerin sayfası haftada bir tazelenir,
// kalan süre henüz aranmamış dizilere gider (kaldığı yerden devam eder). FlixPatrol liste taramasıyla aynı izinle;
// FLIXPATROL_SCRAPE_ENABLED=0 bunu da kapatır.

export const SCRIPT = 'fetch_flixpatrol_titles.py'
export const META_LAST_SUCCESS = 'lastFlixpatrolTitlesAt'
export const META_LAST_ATTEMPT = 'lastFlixpatrolTitlesAttemptAt'
export const META_LAST_ERROR = 'lastFlixpatrolTitlesError'
export const INTERVAL_MS = 24 * 60 * 60 * 1000
export const RETRY_BACKOFF_MS = 6 * 60 * 60 * 1000
export const RUN_TIMEOUT_MS = 55 * 60 * 1000

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)
const readMetaNumber = (key) => Number(getMetaStmt.get(key)?.value) || 0

export function isTitlesSyncDue({ now = Date.now(), lastSuccessAt = 0, lastAttemptAt = 0 } = {}) {
  if (lastAttemptAt && now - lastAttemptAt < RETRY_BACKOFF_MS) return false
  return !lastSuccessAt || now - lastSuccessAt >= INTERVAL_MS
}

let running = false

export async function runFlixpatrolTitlesIfNeeded(deps = {}) {
  const now = deps.now ?? Date.now()
  if (running) return { status: 'skipped', reason: 'running' }
  const due = isTitlesSyncDue({
    now,
    lastSuccessAt: readMetaNumber(META_LAST_SUCCESS),
    lastAttemptAt: readMetaNumber(META_LAST_ATTEMPT),
  })
  if (!due) return null
  running = true
  const basladi = Date.now()
  try {
    setMetaStmt.run(META_LAST_ATTEMPT, String(now))
    console.log(`[flixpatrol-titles] dizi sayfaları taraması başladı (${SCRIPT})`)
    const sonuc = await runFlixpatrolFetch({ script: SCRIPT, timeoutMs: RUN_TIMEOUT_MS, ...deps })
    const sure = Math.round((Date.now() - basladi) / 1000)
    if (sonuc.status === 'ok') {
      setMetaStmt.run(META_LAST_SUCCESS, String(now))
      setMetaStmt.run(META_LAST_ERROR, '')
      console.log(`[flixpatrol-titles] tamamlandı (${sure} sn): ${sonuc.summary}`)
    } else {
      setMetaStmt.run(META_LAST_ERROR, `${new Date(now).toISOString()} ${sonuc.reason}`)
      console.error(`[flixpatrol-titles] başarısız (${sure} sn): ${sonuc.reason}`)
    }
    return sonuc
  } finally {
    running = false
  }
}
