import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import db from '../db.js'
import { getCached } from '../cache.js'

// Görsel önbelleği (2026-10-16, kullanıcı isteği: "bazı dizilerin ve oyuncuların görselleri gelmiyor"). Afiş ve oyuncu
// fotoğrafları tarayıcıdan doğrudan dış sunucudan çekiliyordu; kurum ağında ya da dış sunucuya erişimin kesildiği
// durumlarda görsel gelmiyordu. Artık /api/img/{boyut}/{dosya} yolu sunucudan sunulur: dosya diskte varsa oradan,
// yoksa bir kez indirilip saklanır. Haftalık iş bütün afişleri ve kayıtlı kadro fotoğraflarını önceden indirir.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const IMG_DIR = path.join(__dirname, '..', 'data', 'img')
const UPSTREAM = 'https://image.tmdb.org/t/p'
const SIZES = new Set(['w92', 'w185', 'w342', 'w500', 'h632', 'original'])
const FILE_RE = /^[A-Za-z0-9_-]{6,80}\.(?:jpg|png|webp)$/
const FETCH_TIMEOUT_MS = 20000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const CONCURRENCY = 4
const RUN_BUDGET = 2500
const POSTER_SIZES = ['w92', 'w185', 'w342']
const PROFILE_SIZE = 'w185'

const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
const metaSet = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)

export function isValidSize(size) {
  return SIZES.has(size)
}

export function isValidFile(file) {
  return FILE_RE.test(String(file || ''))
}

export function localPathFor(size, file) {
  return path.join(IMG_DIR, size, file)
}

const inFlight = new Map()

/**
 * Yerel dosya yolu: diskte varsa hemen; yoksa indirir ve saklar. Geçersiz ad, dış hata ya da 404'te null.
 * Aynı dosya için eş zamanlı istekler tek indirmeyi paylaşır.
 */
export async function getImage(size, file, { fetchFn = fetch } = {}) {
  if (!isValidSize(size) || !isValidFile(file)) return null
  const local = localPathFor(size, file)
  if (fs.existsSync(local)) return local
  const key = `${size}/${file}`
  if (inFlight.has(key)) return inFlight.get(key)
  const p = (async () => {
    try {
      const res = await fetchFn(`${UPSTREAM}/${size}/${file}`, {
        headers: { 'User-Agent': 'gorunurluk-platformu/1.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      if (!buf.length) return null
      fs.mkdirSync(path.dirname(local), { recursive: true })
      const tmp = `${local}.${process.pid}.tmp`
      fs.writeFileSync(tmp, buf)
      fs.renameSync(tmp, local)
      return local
    } catch {
      return null
    } finally {
      inFlight.delete(key)
    }
  })()
  inFlight.set(key, p)
  return p
}

/** Önceden indirilecek dosyalar: afişler (3 boyut) + kayıtlı kadro fotoğrafları. */
export function warmList({ series = [], castEntries = [] } = {}) {
  const out = []
  const seen = new Set()
  const add = (size, p) => {
    const file = String(p || '').replace(/^\//, '')
    if (!isValidFile(file)) return
    const k = `${size}/${file}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ size, file })
  }
  for (const s of series) for (const size of POSTER_SIZES) add(size, s.posterPath)
  for (const cast of castEntries) for (const c of cast) add(PROFILE_SIZE, c.profilePath)
  return out
}

function cachedCastEntries() {
  const rows = db.prepare("SELECT value FROM cache_entries WHERE key LIKE 'series-cast:v1:%'").all()
  const out = []
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value)
      const cast = v?.cast || v?.value?.cast || v?.data?.cast
      if (Array.isArray(cast)) out.push(cast)
    } catch {
      /* bozuk kayıt atlanır */
    }
  }
  return out
}

let running = false

/** Haftada bir: eksik afiş ve kadro fotoğraflarını indirir (çalıştırma başına RUN_BUDGET dosya). */
export async function warmImageCacheIfNeeded({
  fetchFn = fetch,
  now = new Date(),
  series = getCached('raw-series-providers')?.series || [],
  force = false,
  budget = RUN_BUDGET,
} = {}) {
  if (running || !series.length) return null
  const last = Number(metaGet.get('imageCacheAt')?.value || 0)
  if (!force && now.getTime() - last < WEEK_MS) return null
  running = true
  const result = { checked: 0, downloaded: 0, failed: 0 }
  try {
    const todo = warmList({ series, castEntries: cachedCastEntries() }).filter(
      (t) => !fs.existsSync(localPathFor(t.size, t.file))
    )
    const queue = todo.slice(0, budget)
    result.checked = todo.length
    const worker = async () => {
      while (queue.length) {
        const t = queue.shift()
        const ok = await getImage(t.size, t.file, { fetchFn })
        if (ok) result.downloaded++
        else result.failed++
        await new Promise((r) => setTimeout(r, 80))
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    if (todo.length <= budget) metaSet.run('imageCacheAt', String(now.getTime()))
    console.log(`[imageCache] ${result.downloaded} indirildi, ${result.failed} alınamadı, ${result.checked} eksikti`)
  } finally {
    running = false
  }
  return result
}
