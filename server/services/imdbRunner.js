import { execFile } from 'node:child_process'
import db from '../db.js'
import { buildSubprocessEnv, PIPELINE_DIR, PYTHON_BIN, sonOzetSatiri } from './netflixPipelineRunner.js'

// IMDb puan/oy senkronu (data-pipeline-python/imdb_sync.py) — günlük. IMDb'nin title.ratings dosyası
// her gün güncellenir; günlük anlık görüntüler "son 7/30 günde kaç oy aldı" ölçüsünü besler, o yüzden
// gün atlanmaması önemli. Günlük iş küçük (~9 MB, ~1 dk); haftada bir Python tarafı bölüm/ekip/yerel ad
// dosyalarını da indirip işler (~950 MB, 10-20 dk) — süre sınırı buna göre.

export const SCRIPT = 'imdb_sync.py'
export const META_LAST_SUCCESS = 'lastImdbSyncAt'
export const META_LAST_ATTEMPT = 'lastImdbSyncAttemptAt'
export const META_LAST_ERROR = 'lastImdbSyncError'
export const INTERVAL_MS = 24 * 60 * 60 * 1000
export const RETRY_BACKOFF_MS = 3 * 60 * 60 * 1000
export const RUN_TIMEOUT_MS = 60 * 60 * 1000
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

/** Günlük: son başarıdan 24 saat geçtiyse; başarısız denemeden sonra 3 saat beklenir. */
export function isImdbSyncDue({ now = Date.now(), lastSuccessAt = 0, lastAttemptAt = 0 } = {}) {
  if (lastAttemptAt && now - lastAttemptAt < RETRY_BACKOFF_MS) return false
  if (!lastSuccessAt) return true
  return now - lastSuccessAt >= INTERVAL_MS
}

export function runImdbSync({ exec = execFile, pythonBin = PYTHON_BIN, timeoutMs = RUN_TIMEOUT_MS } = {}) {
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
      exec(pythonBin, [SCRIPT], opts, (err, stdout, stderr) => {
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

export async function runImdbSyncIfNeeded(deps = {}) {
  const now = deps.now ?? Date.now()
  if (running) return { status: 'skipped', reason: 'running' }
  const due = isImdbSyncDue({
    now,
    lastSuccessAt: readMetaNumber(META_LAST_SUCCESS),
    lastAttemptAt: readMetaNumber(META_LAST_ATTEMPT),
  })
  if (!due) return null
  running = true
  const basladi = Date.now()
  try {
    setMetaStmt.run(META_LAST_ATTEMPT, String(now))
    console.log(`[imdb-sync] günlük IMDb puan/oy senkronu başladı (${SCRIPT})`)
    const sonuc = await runImdbSync(deps)
    const sure = Math.round((Date.now() - basladi) / 1000)
    if (sonuc.status === 'ok') {
      setMetaStmt.run(META_LAST_SUCCESS, String(now))
      setMetaStmt.run(META_LAST_ERROR, '')
      console.log(`[imdb-sync] tamamlandı (${sure} sn): ${sonuc.summary}`)
    } else {
      setMetaStmt.run(META_LAST_ERROR, `${new Date(now).toISOString()} ${sonuc.reason}`)
      console.error(`[imdb-sync] başarısız (${sure} sn): ${sonuc.reason}`)
      if (sonuc.stderr) console.error(`[imdb-sync] stderr: ${sonuc.stderr}`)
    }
    return sonuc
  } finally {
    running = false
  }
}
