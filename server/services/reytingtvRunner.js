import { execFile } from 'node:child_process'
import db from '../db.js'
import { buildSubprocessEnv, PIPELINE_DIR, PYTHON_BIN, sonOzetSatiri } from './netflixPipelineRunner.js'

// Türkiye TV günlük Top 10 (reytingtv.com) — zamanlanmış çekim. Neden gerekti: tablo tek seferlik elle
// koşuyla (2026-08-25) dolmuştu, zamanlayıcıya bağlı değildi; site de 2026'da düzensiz yayımlıyor.
// Günde bir kez `backfill_reytingtv.py --days 14` koşar: son iki haftanın makaleleri (gecikmeli yayın ve
// yeniden yayınlanan günler için pay) çekilir, chart_entries'e TAM liste yazılır. Site kuralları:
// robots.txt Disallow boş, REQUEST_DELAY_S istekler arası bekleme; koşucu bunu değiştirmez.

export const SCRIPT = 'backfill_reytingtv.py'
export const CATCH_UP_DAYS = 14
export const META_LAST_SUCCESS = 'lastReytingtvSyncAt'
export const META_LAST_ATTEMPT = 'lastReytingtvSyncAttemptAt'
export const META_LAST_ERROR = 'lastReytingtvSyncError'
export const INTERVAL_MS = 24 * 60 * 60 * 1000
export const RETRY_BACKOFF_MS = 6 * 60 * 60 * 1000
export const RUN_TIMEOUT_MS = 20 * 60 * 1000
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

function readMetaNumber(key) {
  const row = getMetaStmt.get(key)
  return row ? Number(row.value) || 0 : 0
}

/** Günlük: son başarıdan 24 saat geçtiyse; başarısız denemeden sonra 6 saat beklenir. */
export function isReytingtvSyncDue({ now = Date.now(), lastSuccessAt = 0, lastAttemptAt = 0 } = {}) {
  if (lastAttemptAt && now - lastAttemptAt < RETRY_BACKOFF_MS) return false
  if (!lastSuccessAt) return true
  return now - lastSuccessAt >= INTERVAL_MS
}

export function runReytingtvBackfill({
  exec = execFile,
  pythonBin = PYTHON_BIN,
  timeoutMs = RUN_TIMEOUT_MS,
  days = CATCH_UP_DAYS,
} = {}) {
  return new Promise((resolve) => {
    const opts = {
      cwd: PIPELINE_DIR,
      env: buildSubprocessEnv(),
      timeout: timeoutMs,
      killSignal: 'SIGTERM',
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    }
    let bitti = false
    const done = (sonuc) => {
      if (bitti) return
      bitti = true
      resolve(sonuc)
    }
    try {
      exec(pythonBin, [SCRIPT, '--days', String(days)], opts, (err, stdout, stderr) => {
        const summary = sonOzetSatiri(stdout)
        const stderrText = String(stderr || '')
          .trim()
          .slice(-2000)
        if (err) {
          const reason = err.killed
            ? `zaman aşımı (${Math.round(timeoutMs / 60000)} dk) — süreç öldürüldü`
            : err.code === 'ENOENT'
              ? `Python bulunamadı (${pythonBin}); PYTHON_BIN ortam değişkenini ayarlayın`
              : `çıkış kodu ${err.code ?? '?'}: ${err.message}`
          done({ status: 'failed', reason, summary, stderr: stderrText })
          return
        }
        done({ status: 'ok', summary, stderr: stderrText })
      })
    } catch (err) {
      done({ status: 'failed', reason: `alt süreç başlatılamadı: ${err.message}`, summary: '', stderr: '' })
    }
  })
}

let running = false

export async function runReytingtvSyncIfNeeded(deps = {}) {
  const now = deps.now ?? Date.now()
  if (running) return { status: 'skipped', reason: 'running' }
  const due = isReytingtvSyncDue({
    now,
    lastSuccessAt: readMetaNumber(META_LAST_SUCCESS),
    lastAttemptAt: readMetaNumber(META_LAST_ATTEMPT),
  })
  if (!due) return null
  running = true
  const basladi = Date.now()
  try {
    setMetaStmt.run(META_LAST_ATTEMPT, String(now))
    console.log(
      `[reytingtv-sync] günlük Türkiye TV listesi çekimi başladı (${SCRIPT} --days ${deps.days ?? CATCH_UP_DAYS})`
    )
    const sonuc = await runReytingtvBackfill(deps)
    const sure = Math.round((Date.now() - basladi) / 1000)
    if (sonuc.status === 'ok') {
      setMetaStmt.run(META_LAST_SUCCESS, String(now))
      setMetaStmt.run(META_LAST_ERROR, '')
      console.log(`[reytingtv-sync] tamamlandı (${sure} sn): ${sonuc.summary}`)
    } else {
      setMetaStmt.run(META_LAST_ERROR, `${new Date(now).toISOString()} ${sonuc.reason}`)
      console.error(`[reytingtv-sync] başarısız (${sure} sn): ${sonuc.reason}`)
      if (sonuc.stderr) console.error(`[reytingtv-sync] stderr: ${sonuc.stderr}`)
    }
    return sonuc
  } finally {
    running = false
  }
}
