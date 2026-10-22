import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import db from '../db.js'
import { PIPELINE_DIR, PYTHON_BIN, buildSubprocessEnv, META_LAST_SUCCESS } from './netflixPipelineRunner.js'

// Netflix kaynak dosyası, yayımlanan sürümden (2026-10-22). Netflix'in 32 MB'lık all-weeks-countries.tsv dosyası
// kurum ağında tam inmiyor (bağlantı ~60 sn'de kopuyor, Range yok sayılıyor); bu yüzden Netflix listeleri haftalarca
// geride kalıyordu. GitHub'daki haftalık iş akışı dosyayı indirip `netflix-data` sürümüne ek olarak yayımlar (herkese
// açık, anahtar gerekmez, CDN'den hızlı iner). Bu iş günde bir kez sürümdeki özeti okur; yeni hafta varsa dosyayı
// indirir, Python tarafındaki doğrulamadan geçirip hattı çevrimdışı çalıştırır (netflix_import_artifact.py).

const REPO = process.env.NETFLIX_RELEASE_REPO || 'arzu336/tr-series-visibility'
const TAG = process.env.NETFLIX_RELEASE_TAG || 'netflix-data'
export const RELEASE_BASE = `https://github.com/${REPO}/releases/download/${TAG}`
const SUMMARY_NAME = 'netflix-source-summary.json'
const TSV_NAME = 'all-weeks-countries.tsv'
const DATA_DIR = path.join(PIPELINE_DIR, 'data')
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000
const IMPORT_TIMEOUT_MS = 30 * 60 * 1000
const META_CHECKED = 'netflixReleaseCheckedAt'
const META_WEEK = 'netflixReleaseWeek'

const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
const metaSet = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)

/** Sürümdeki özet yereldekinden yeni mi? Özet tam değilse ya da hafta yoksa hayır. */
export function isNewerRelease(remote, localWeek) {
  if (!remote || remote.complete !== true || !remote.last_week) return false
  return !localWeek || String(remote.last_week) > String(localWeek)
}

async function downloadTo(url, dest, fetchFn) {
  const res = await fetchFn(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const expected = Number(res.headers.get('content-length') || 0)
  if (expected && buf.length !== expected) throw new Error(`eksik indirme: ${buf.length}/${expected} bayt`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buf)
  return buf.length
}

function runImport(src, { exec = execFile, pythonBin = PYTHON_BIN } = {}) {
  return new Promise((resolve) => {
    exec(
      pythonBin,
      ['netflix_import_artifact.py', src],
      {
        cwd: PIPELINE_DIR,
        env: buildSubprocessEnv(),
        timeout: IMPORT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        const tail = String(stderr || stdout || '')
          .trim()
          .split(/\r?\n/)
          .slice(-3)
          .join(' | ')
        resolve(err ? { ok: false, reason: `çıkış ${err.code ?? '?'}: ${tail}` } : { ok: true, summary: tail })
      }
    )
  })
}

let running = false

/**
 * Günde dört kez bakar; sürümde yeni hafta varsa dosyayı alır, doğrulatıp hattı çevrimdışı koşar.
 * Sürüm henüz yoksa (404) sessizce geçer. Hiçbir durumda fırlatmaz.
 */
export async function fetchNetflixReleaseIfNeeded({ fetchFn = fetch, now = Date.now(), force = false, exec } = {}) {
  if (running) return null
  const last = Number(metaGet.get(META_CHECKED)?.value || 0)
  if (!force && now - last < CHECK_INTERVAL_MS) return null
  running = true
  try {
    metaSet.run(META_CHECKED, String(now))
    const res = await fetchFn(`${RELEASE_BASE}/${SUMMARY_NAME}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(60000),
    })
    if (res.status === 404) return { status: 'skipped', reason: 'sürüm yok' }
    if (!res.ok) return { status: 'failed', reason: `özet HTTP ${res.status}` }
    const remote = await res.json()
    const localWeek = metaGet.get(META_WEEK)?.value || null
    if (!isNewerRelease(remote, localWeek)) return { status: 'skipped', reason: `yeni hafta yok (${remote.last_week})` }

    const tmp = path.join(DATA_DIR, `${TSV_NAME}.release`)
    const bytes = await downloadTo(`${RELEASE_BASE}/${TSV_NAME}`, tmp, fetchFn)
    if (remote.content_length && bytes !== remote.content_length)
      throw new Error(`boyut uyuşmuyor: ${bytes} ≠ ${remote.content_length}`)
    // Doğrulayıcı content-length'i yanındaki .json'dan okur.
    fs.writeFileSync(`${tmp}.json`, JSON.stringify({ content_length: bytes, last_week: remote.last_week }))
    const imp = await runImport(tmp, { exec })
    fs.rmSync(tmp, { force: true })
    fs.rmSync(`${tmp}.json`, { force: true })
    if (!imp.ok) return { status: 'failed', reason: imp.reason }
    metaSet.run(META_WEEK, String(remote.last_week))
    metaSet.run(META_LAST_SUCCESS, String(now)) // haftalık senkron aynı dosyayı yeniden işlemesin
    console.log(`[netflix-release] ${remote.last_week} haftası alındı (${bytes} bayt); ${imp.summary}`)
    return { status: 'ok', week: remote.last_week, bytes }
  } catch (err) {
    console.error('[netflix-release] alınamadı:', err.message)
    return { status: 'failed', reason: err.message }
  } finally {
    running = false
  }
}
