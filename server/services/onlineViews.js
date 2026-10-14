import db from '../db.js'
import { getCached } from '../cache.js'
import { foldTitle } from './localTitles.js'
import { stripWikiQualifier } from './tvGuide.js'

// Çevrimiçi izlenme (2026-10-13; kullanıcı onayıyla, izin kapsamında). Bazı ülkelerde Türk dizileri büyük ölçüde
// dublajlı/altyazılı bölümlerin yerel video sitesine yüklenmesiyle izleniyor; site her videonun izlenme sayısını
// veriyor. Kaynaklar (SOURCES): İran — Aparat (Farsça), Özbekistan — mover.uz (Özbekçe; 2026-10-14). Dizi, o dildeki
// adıyla (ansiklopedi maddesi, Wikidata adı, kaynakla doğrulanmış elle eşleme — tahmin yok) aranır; yalnızca
// başlığında adın tam geçtiği ve dizi bölümü olduğu anlaşılan videolar sayılır. Haftada bir anlık görüntü saklanır
// (izlenme birikimli olduğundan değişim haftalar arası farktan okunur). Ülke yayıncılarının YouTube kanalları da aynı
// tabloya yazar (youtubePublic.writeCountryViews). APARAT_ENABLED=0 / MOVER_ENABLED=0 kapatır.

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

const decode = (s) =>
  String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

/** Aparat (İran): JSON arama. Sayfa → { videos: [{ id, title, views, date }], next }. */
function parseAparat(body) {
  const videos = (body.videobysearch || []).map((v) => ({
    id: v.id,
    title: String(v.title || ''),
    views: Number(v.visit_cnt) || 0,
    date: String(v.create_date || '').slice(0, 10) || null,
  }))
  return { videos, next: body.ui?.pagingForward || null }
}

/** mover.uz (Özbekistan): HTML arama sayfası. Her öğe: /watch/{id}, başlık, izlenme. */
export function parseMover(html, { query, page }) {
  const videos = []
  const re =
    /<h5 class="title"><a href="https:\/\/mover\.uz\/watch\/([A-Za-z0-9_-]+)"[^>]*title="([^"]*)"[\s\S]*?class="views">\s*([\d\s.,]*)</g
  for (const m of String(html).matchAll(re)) {
    videos.push({ id: m[1], title: decode(m[2]), views: Number(m[3].replace(/[^\d]/g, '')) || 0, date: null })
  }
  const hasNext = new RegExp(`page=${page + 1}\\b`).test(String(html))
  return {
    videos,
    next: hasNext ? `https://mover.uz/search?val=${encodeURIComponent(query)}&page=${page + 1}` : null,
  }
}

export const SOURCES = [
  {
    key: 'aparat',
    iso2: 'IR',
    lang: 'fa',
    enabled: (env) => env.APARAT_ENABLED !== '0',
    firstUrl: (q) => `https://www.aparat.com/etc/api/videoBySearch/text/${encodeURIComponent(q)}/perpage/50`,
    parse: async (res) => parseAparat(await res.json()),
    // Dizi bölümü/fragmanı olduğunu gösteren sözcükler ("dizi", "bölüm", "dublaj", "altyazı", "fragman").
    seriesMarker: /سریال|قسمت|دوبله|زیرنویس|تریلر/,
    // Tek kelimelik ad genel bir sözcük olabilir (حلقه "halka"): başlıkta "Türk" ya da Türkçe ad da geçmeli.
    turkishMarker: /ترک/,
  },
  {
    key: 'mover',
    iso2: 'UZ',
    lang: 'uz',
    enabled: (env) => env.MOVER_ENABLED !== '0',
    firstUrl: (q) => `https://mover.uz/search?val=${encodeURIComponent(q)}&page=1`,
    parse: async (res, ctx) => parseMover(await res.text(), ctx),
    seriesMarker: /qism|qisim|bo['ʻ’`]?lim|serial|сериал|қисм|бўлим|бӯлим/i,
    turkishMarker: /turk|türk|турк/i,
  },
]

/**
 * Bir dildeki dizi adları: ansiklopedi maddesi, Wikidata adı/diğer adları (ayırt edici ek atılmış) ve yayın akışı
 * için elle doğrulanmış adlar; 3 harften uzun. Dönen: Map<diziId, Set<ad>>.
 */
export function namesFor(lang) {
  const out = new Map()
  const add = (id, t) => {
    const name = stripWikiQualifier(t)
    if (foldTitle(name).length < 3) return
    if (!out.has(id)) out.set(id, new Set())
    out.get(id).add(name)
  }
  try {
    for (const r of db.prepare('SELECT tmdb_id, title FROM series_wiki_articles WHERE lang = ?').all(lang))
      add(r.tmdb_id, r.title)
    for (const r of db.prepare('SELECT tmdb_id, label FROM series_wikidata_labels WHERE lang = ?').all(lang))
      add(r.tmdb_id, r.label)
    // Yayın akışı için kaynakla doğrulanmış elle eşlemeler (Özbekçe: itvuz; Farsça kaynak yok).
    const provider = { uz: 'itvuz' }[lang]
    if (provider)
      for (const r of db
        .prepare('SELECT title, series_id FROM tv_titles WHERE provider = ? AND manual = 1 AND series_id IS NOT NULL')
        .all(provider))
        add(r.series_id, r.title)
  } catch {
    // tablolar yoksa boş
  }
  return out
}

/** Geriye uyumluluk (testler): Farsça adlar. */
export const persianNames = () => namesFor('fa')

/**
 * Arama sonuçlarından adın tam geçtiği dizi videoları; aynı video bir kez. `original`: dizinin Türkçe adı (tek
 * kelimelik yerel adlarda ek koşul için). `markers`: { seriesMarker, turkishMarker }.
 */
export function summarizeVideos(videos, name, { original = '', markers = SOURCES[0] } = {}) {
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
    if (seen.has(v.id) || !markers.seriesMarker.test(title) || !folded.includes(key)) continue
    if (single && !markers.turkishMarker.test(title) && !(orig.length >= 4 && folded.includes(orig))) continue
    seen.add(v.id)
    const n = Number(v.views ?? v.visit_cnt) || 0
    views += n
    top = Math.max(top, n)
    const d = v.date ?? (String(v.create_date || '').slice(0, 10) || null)
    if (d && (!latest || d > latest)) latest = d
  }
  return { videos: seen.size, views, topViews: top, latestUpload: latest }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
const metaSet = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)

export function aparatEnabled(env = process.env) {
  return SOURCES[0].enabled(env)
}

let running = false

export async function runOnlineViewsIfNeeded({
  fetchFn = fetch,
  now = new Date(),
  series = getCached('raw-series-providers')?.series || [],
  gapMs = GAP_MS,
  force = false,
  sources = SOURCES,
  env = process.env,
} = {}) {
  if (running || !series.length) return null
  const active = sources.filter((s) => s.enabled(env))
  if (!active.length) return null
  running = true
  const catalog = new Map(series.map((s) => [s.id, s.name]))
  const day = now.toISOString().slice(0, 10)
  const put = db.prepare(
    `INSERT INTO online_views (series_id, iso2, fetched_on, query, videos, views, top_views, latest_upload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(series_id, iso2, fetched_on) DO UPDATE SET query = excluded.query, videos = excluded.videos,
       views = excluded.views, top_views = excluded.top_views, latest_upload = excluded.latest_upload`
  )
  const result = { sources: {}, errors: [] }
  try {
    for (const src of active) {
      const last = Number(metaGet.get(`onlineViewsAt:${src.key}`)?.value || 0)
      if (!force && now.getTime() - last < WEEK_MS) continue
      const r = { series: 0, withVideos: 0 }
      for (const [id, names] of namesFor(src.lang)) {
        if (!catalog.has(id)) continue
        let best = null
        for (const name of names) {
          const videos = []
          let url = src.firstUrl(name)
          for (let p = 1; p <= PAGES && url; p++) {
            await sleep(gapMs)
            try {
              const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT } })
              if (!res.ok) throw new Error(`HTTP ${res.status}`)
              const page = await src.parse(res, { query: name, page: p })
              videos.push(...page.videos)
              url = page.next
            } catch (err) {
              result.errors.push(`${src.key} ${id}: ${err.message}`)
              url = null
            }
          }
          const s = summarizeVideos(videos, name, { original: catalog.get(id), markers: src })
          if (!best || s.views > best.views) best = { ...s, query: name }
        }
        r.series++
        if (!best?.videos) continue
        put.run(id, src.iso2, day, best.query, best.videos, best.views, best.topViews, best.latestUpload)
        r.withVideos++
      }
      metaSet.run(`onlineViewsAt:${src.key}`, String(now.getTime()))
      result.sources[src.key] = r
      console.log(`[onlineViews] ${src.key}: ${r.series} dizi arandı, ${r.withVideos} dizide video var`)
    }
  } finally {
    running = false
  }
  return result
}

/** Dizinin en son çevrimiçi izlenme kaydı (ülke başına) ve bir önceki kayda göre artış. */
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
