import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import db from '../db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PIPELINE_DIR = path.join(__dirname, '..', '..', 'data-pipeline-python')
export const PIPELINE_SCRIPT = 'netflix_pipeline.py'

export const META_LAST_SUCCESS = 'lastNetflixSyncAt'
export const META_LAST_ATTEMPT = 'lastNetflixSyncAttemptAt'
export const META_LAST_ERROR = 'lastNetflixSyncError'

const SUNDAY = 0
export const CATCH_UP_MS = 8 * 24 * 60 * 60 * 1000
export const RETRY_BACKOFF_MS = 6 * 60 * 60 * 1000
export const RUN_TIMEOUT_MS = 30 * 60 * 1000
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024

export const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3')

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

function readMetaNumber(key) {
  const row = getMetaStmt.get(key)
  return row ? Number(row.value) || 0 : 0
}

/**
 * Saf karar fonksiyonu (test edilebilir): şu an senkronizasyon sırası geldi mi?
 *  - Son denemeden bu yana RETRY_BACKOFF_MS geçmediyse hayır (başarılı da başarısız da olsa).
 *  - Hiç başarılı koşu yoksa evet (ilk dolum).
 *  - Son başarı CATCH_UP_MS'den eskiyse evet (kaçırılan hafta telafisi).
 *  - Pazar günüyse ve son başarı bu Pazar gece yarısından ÖNCEyse evet.
 *  - Aksi halde hayır.
 */
export function isNetflixSyncDue({ now = Date.now(), lastSuccessAt = 0, lastAttemptAt = 0 } = {}) {
  if (lastAttemptAt && now - lastAttemptAt < RETRY_BACKOFF_MS) return false
  if (!lastSuccessAt) return true
  if (now - lastSuccessAt >= CATCH_UP_MS) return true
  const bugun = new Date(now)
  if (bugun.getDay() === SUNDAY) {
    const pazarBaslangici = new Date(now)
    pazarBaslangici.setHours(0, 0, 0, 0)
    if (lastSuccessAt < pazarBaslangici.getTime()) return true
  }
  return false
}

function sonOzetSatiri(stdout) {
  const satirlar = String(stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  const ozet = [...satirlar].reverse().find((s) => s.startsWith('[netflix_pipeline] {'))
  return ozet || satirlar[satirlar.length - 1] || ''
}

/**
 * Betiği çalıştırır; ASLA reddetmez. Sonuç: { status: 'ok' | 'failed', reason?, summary, stderr }.
 * `exec` enjekte edilebilir (testte sahte alt süreç).
 */
export function runNetflixPipeline({ exec = execFile, pythonBin = PYTHON_BIN, timeoutMs = RUN_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const opts = {
      cwd: PIPELINE_DIR,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
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
      exec(pythonBin, [PIPELINE_SCRIPT, '--all'], opts, (err, stdout, stderr) => {
        const summary = sonOzetSatiri(stdout)
        const stderrText = String(stderr || '').trim().slice(-2000)
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

/**
 * scheduler.js'in zenginleştirme zincirinden çağrılır. Sırası gelmediyse null döner (diğer
 * haftalık işlerle aynı sözleşme). Hiçbir durumda fırlatmaz.
 */
export async function runNetflixSyncIfNeeded(deps = {}) {
  const now = deps.now ?? Date.now()
  if (running) {
    console.log('[netflix-sync] önceki koşu hâlâ sürüyor — bu tetikleme atlandı')
    return { status: 'skipped', reason: 'running' }
  }

  const due = isNetflixSyncDue({
    now,
    lastSuccessAt: readMetaNumber(META_LAST_SUCCESS),
    lastAttemptAt: readMetaNumber(META_LAST_ATTEMPT),
  })
  if (!due) return null

  running = true
  const basladi = Date.now()
  try {
    setMetaStmt.run(META_LAST_ATTEMPT, String(now))
    console.log('[netflix-sync] haftalık Netflix Top 10 senkronizasyonu başladı (netflix_pipeline.py --all)')
    const sonuc = await runNetflixPipeline(deps)
    const sure = Math.round((Date.now() - basladi) / 1000)
    if (sonuc.status === 'ok') {
      setMetaStmt.run(META_LAST_SUCCESS, String(now))
      setMetaStmt.run(META_LAST_ERROR, '')
      console.log(`[netflix-sync] tamamlandı (${sure} sn): ${sonuc.summary}`)
    } else {
      setMetaStmt.run(META_LAST_ERROR, `${new Date(now).toISOString()} ${sonuc.reason}`)
      console.error(`[netflix-sync] başarısız (${sure} sn): ${sonuc.reason}`)
      if (sonuc.stderr) console.error(`[netflix-sync] stderr: ${sonuc.stderr}`)
      if (sonuc.summary) console.error(`[netflix-sync] son çıktı: ${sonuc.summary}`)
    }
    return sonuc
  } catch (err) {
    console.error('[netflix-sync] beklenmeyen hata:', err.message)
    try {
      setMetaStmt.run(META_LAST_ERROR, `${new Date(now).toISOString()} ${err.message}`)
    } catch {
      /* günlüğe yazıldı, başka yapılacak yok */
    }
    return { status: 'failed', reason: err.message, summary: '', stderr: '' }
  } finally {
    running = false
  }
}
