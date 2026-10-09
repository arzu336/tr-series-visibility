import { execFile } from 'node:child_process'
import db from '../db.js'
import { buildSubprocessEnv, PIPELINE_DIR, PYTHON_BIN, sonOzetSatiri } from './netflixPipelineRunner.js'

// FlixPatrol çok platformlu güncel TV Top 10 (Disney+/Prime/HBO Max/Apple TV+/Shahid) —
// zamanlanmış çekim. reytingtv/netflix runner'larının aksine FlixPatrol sitesi Cloudflare
// korumalıdır; Python tarafı (providers/flixpatrol.py) korumayı site sahibinin CRAWL İZNİYLE
// StealthyFetcher ile geçer. Koruma bir gerçek tarayıcı (Camoufox) açtığından bu iş YALNIZCA
// yerelde/normal IP'de çalışmalı — GitHub Actions gibi datacenter IP'lerinde Cloudflare çok
// daha agresif engeller (bu yüzden netflix'in aksine ayrı bir workflow YOK, sadece runner).
//
// Haftalık koşar: FlixPatrol'un güncel listesi günlük değişse de bizim veri döngümüz haftalık
// (bkz. gereksinim). Yalnızca GÜNCEL liste alınır; geçmiş FlixPatrol paywall'ı (402) arkasında.
// İzin geri çekilirse FLIXPATROL_SCRAPE_ENABLED=0 ile Python tarafı sağlayıcıyı devre dışı bırakır.

export const SCRIPT = 'fetch_flixpatrol.py'
export const META_LAST_SUCCESS = 'lastFlixpatrolSyncAt'
export const META_LAST_ATTEMPT = 'lastFlixpatrolSyncAttemptAt'
export const META_LAST_ERROR = 'lastFlixpatrolSyncError'
export const INTERVAL_MS = 7 * 24 * 60 * 60 * 1000 // haftalık
export const RETRY_BACKOFF_MS = 12 * 60 * 60 * 1000 // başarısızlıkta 12 saat bekle
// Tüm platformların FlixPatrol'daki tüm ülkeleri (~400 sayfa, sayfa başına birkaç sn; tek tarayıcı
// oturumu) yaklaşık 45-60 dk. Python her sayfayı hemen kaydettiği için sınır aşılsa bile veri kalır.
export const RUN_TIMEOUT_MS = 150 * 60 * 1000
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

/** Haftalık: son başarıdan 7 gün geçtiyse; başarısız denemeden sonra 12 saat beklenir. */
export function isFlixpatrolSyncDue({ now = Date.now(), lastSuccessAt = 0, lastAttemptAt = 0 } = {}) {
  if (lastAttemptAt && now - lastAttemptAt < RETRY_BACKOFF_MS) return false
  if (!lastSuccessAt) return true
  return now - lastSuccessAt >= INTERVAL_MS
}

export function runFlixpatrolFetch({
  exec = execFile,
  pythonBin = PYTHON_BIN,
  timeoutMs = RUN_TIMEOUT_MS,
  script = SCRIPT,
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
      exec(pythonBin, [script], opts, (err, stdout, stderr) => {
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

export async function runFlixpatrolSyncIfNeeded(deps = {}) {
  const now = deps.now ?? Date.now()
  if (running) return { status: 'skipped', reason: 'running' }
  const due = isFlixpatrolSyncDue({
    now,
    lastSuccessAt: readMetaNumber(META_LAST_SUCCESS),
    lastAttemptAt: readMetaNumber(META_LAST_ATTEMPT),
  })
  if (!due) return null
  running = true
  const basladi = Date.now()
  try {
    setMetaStmt.run(META_LAST_ATTEMPT, String(now))
    console.log(`[flixpatrol-sync] haftalık FlixPatrol TV Top 10 çekimi başladı (${SCRIPT})`)
    const sonuc = await runFlixpatrolFetch(deps)
    const sure = Math.round((Date.now() - basladi) / 1000)
    if (sonuc.status === 'ok') {
      setMetaStmt.run(META_LAST_SUCCESS, String(now))
      setMetaStmt.run(META_LAST_ERROR, '')
      console.log(`[flixpatrol-sync] tamamlandı (${sure} sn): ${sonuc.summary}`)
    } else {
      setMetaStmt.run(META_LAST_ERROR, `${new Date(now).toISOString()} ${sonuc.reason}`)
      console.error(`[flixpatrol-sync] başarısız (${sure} sn): ${sonuc.reason}`)
      if (sonuc.stderr) console.error(`[flixpatrol-sync] stderr: ${sonuc.stderr}`)
    }
    return sonuc
  } finally {
    running = false
  }
}
