import db from '../db.js'
import { getCached } from '../cache.js'
import { foldTitle } from './localTitles.js'
import { stripWikiQualifier } from './tvGuide.js'

// İran'da çevrimiçi izlenme (2026-10-13; kullanıcı onayıyla, izin kapsamında). İran'da Türk dizileri büyük ölçüde
// Farsça dublajlı/altyazılı bölümlerin video sitesine (Aparat) yüklenmesiyle izleniyor; site her videonun izlenme
// sayısını veriyor. Dizi, Farsça adıyla (ansiklopedi maddesi ya da Wikidata adı — Wikidata bağlantısı; tahmin yok)
// aranır; yalnızca başlığında Farsça adın tam geçtiği videolar sayılır. Haftada bir anlık görüntü saklanır (izlenme
// birikimli olduğundan değişim haftalar arası farktan okunur). APARAT_ENABLED=0 kapatır.

const SEARCH = 'https://www.aparat.com/etc/api/videoBySearch/text'
const USER_AGENT = 'Mozilla/5.0 (gorunurluk-platformu; izinli tarama)'
const PAGES = 3
const GAP_MS = 1200
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

db.exec(`
  CREATE TABLE IF NOT EXISTS online_views (
    series_id INTEGER NOT NULL,
    iso2 TEXT NOT NULL,
    fetched_on TEXT NOT NULL,
    query TEXT NOT NULL,
    videos INTEGER NOT NULL,
    views INTEGER NOT NULL,
    top_views INTEGER,
    latest_upload TEXT,
    PRIMARY KEY (series_id, iso2, fetched_on)
  )
`)

export function aparatEnabled(env = process.env) {
  return env.APARAT_ENABLED !== '0'
}

/** Farsça adlar: ansiklopedi maddesi + Wikidata adı/diğer adları (ayırt edici ek atılmış), 3 harften uzun. */
export function persianNames() {
  const out = new Map()
  const add = (id, t) => {
    const name = stripWikiQualifier(t)
    if (foldTitle(name).length < 3) return
    if (!out.has(id)) out.set(id, new Set())
    out.get(id).add(name)
  }
  try {
    for (const r of db.prepare("SELECT tmdb_id, title FROM series_wiki_articles WHERE lang = 'fa'").all())
      add(r.tmdb_id, r.title)
    for (const r of db.prepare("SELECT tmdb_id, label FROM series_wikidata_labels WHERE lang = 'fa'").all())
      add(r.tmdb_id, r.label)
  } catch {
    // tablolar yoksa boş
  }
  return out
}

// Dizi bölümü/fragmanı olduğunu gösteren sözcükler ("dizi", "bölüm", "dublaj", "altyazı", "fragman"): genel adlı
// dizilerde ("Aile") ilgisiz videolar sayılmasın diye başlıkta biri de bulunmalı.
const SERIES_MARKER = /سریال|قسمت|دوبله|زیرنویس|تریلر/

// Tek kelimelik Farsça ad genel bir sözcük olabiliyor (حلقه "halka", قهرمان "şampiyon"): o zaman başlıkta "Türk"
// (ترک…) ya da dizinin Türkçe adı da geçmeli.
const TURKISH_MARKER = /ترک/

/**
 * Arama sonuçlarından adın tam geçtiği dizi videoları; aynı video bir kez. `original`: dizinin Türkçe adı (tek
 * kelimelik Farsça adlarda ek koşul için).
 */
export function summarizeVideos(videos, name, { original = '' } = {}) {
  const key = foldTitle(name)
  const single = String(name).trim().split(/\s+/).length < 2
  const orig = foldTitle(original)
  const seen = new Set()
  let views = 0
  let top = 0
  let latest = null
  for (const v of videos) {
    const title = String(v.title || '')
    const folded = foldTitle(title)
    if (seen.has(v.id) || !SERIES_MARKER.test(title) || !folded.includes(key)) continue
    if (single && !TURKISH_MARKER.test(title) && !(orig.length >= 4 && folded.includes(orig))) continue
    seen.add(v.id)
    const n = Number(v.visit_cnt) || 0
    views += n
    top = Math.max(top, n)
    const d = String(v.create_date || '').slice(0, 10)
    if (d && (!latest || d > latest)) latest = d
  }
  return { videos: seen.size, views, topViews: top, latestUpload: latest }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
const metaSet = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)

let running = false

export async function runOnlineViewsIfNeeded({
  fetchFn = fetch,
  now = new Date(),
  series = getCached('raw-series-providers')?.series || [],
  gapMs = GAP_MS,
  force = false,
} = {}) {
  if (!aparatEnabled() || running || !series.length) return null
  const last = Number(metaGet.get('onlineViewsAt')?.value || 0)
  if (!force && now.getTime() - last < WEEK_MS) return null
  running = true
  const catalog = new Map(series.map((s) => [s.id, s.name]))
  const day = now.toISOString().slice(0, 10)
  const put = db.prepare(
    `INSERT INTO online_views (series_id, iso2, fetched_on, query, videos, views, top_views, latest_upload)
     VALUES (?, 'IR', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(series_id, iso2, fetched_on) DO UPDATE SET query = excluded.query, videos = excluded.videos,
       views = excluded.views, top_views = excluded.top_views, latest_upload = excluded.latest_upload`
  )
  const result = { series: 0, withVideos: 0, errors: [] }
  try {
    for (const [id, names] of persianNames()) {
      if (!catalog.has(id)) continue
      let best = null
      for (const name of names) {
        const videos = []
        let url = `${SEARCH}/${encodeURIComponent(name)}/perpage/50`
        for (let p = 0; p < PAGES && url; p++) {
          await sleep(gapMs)
          try {
            const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT } })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const body = await res.json()
            videos.push(...(body.videobysearch || []))
            url = body.ui?.pagingForward || null
          } catch (err) {
            result.errors.push(`${id}: ${err.message}`)
            url = null
          }
        }
        const s = summarizeVideos(videos, name, { original: catalog.get(id) })
        if (!best || s.views > best.views) best = { ...s, query: name }
      }
      result.series++
      if (!best?.videos) continue
      put.run(id, day, best.query, best.videos, best.views, best.topViews, best.latestUpload)
      result.withVideos++
    }
    metaSet.run('onlineViewsAt', String(now.getTime()))
    console.log(`[onlineViews] ${result.series} dizi arandı, ${result.withVideos} dizide video var`)
  } finally {
    running = false
  }
  return result
}

/** Dizinin en son çevrimiçi izlenme kaydı (ülke başına) ve bir önceki haftaya göre artış. */
export function getSeriesOnlineViews(seriesId) {
  const rows = db.prepare('SELECT * FROM online_views WHERE series_id = ? ORDER BY fetched_on DESC').all(seriesId)
  const byIso = new Map()
  for (const r of rows) {
    const cur = byIso.get(r.iso2)
    if (!cur)
      byIso.set(r.iso2, { iso2: r.iso2, videos: r.videos, views: r.views, latestUpload: r.latest_upload, prev: null })
    else if (cur.prev == null) cur.prev = r.views
  }
  return [...byIso.values()].map(({ prev, ...r }) => ({ ...r, weeklyGain: prev != null ? r.views - prev : null }))
}

/** Ülkede en çok izlenen diziler (en son kayıt). */
export function getCountryOnlineViews(iso2, limit = 15) {
  return db
    .prepare(
      `SELECT o.series_id, o.videos, o.views FROM online_views o
       JOIN (SELECT series_id, MAX(fetched_on) d FROM online_views WHERE iso2 = ? GROUP BY series_id) m
         ON m.series_id = o.series_id AND m.d = o.fetched_on
       WHERE o.iso2 = ? ORDER BY o.views DESC LIMIT ?`
    )
    .all(iso2, iso2, limit)
    .map((r) => ({ seriesId: r.series_id, videos: r.videos, views: r.views }))
}
