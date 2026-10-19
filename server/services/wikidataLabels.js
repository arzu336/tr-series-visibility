import db from '../db.js'

// Dizilerin Wikidata'daki yerel adları (2026-10-13). Yayın akışlarında Türk dizileri yerel adlarıyla geçiyor
// (Gürcüce, Özbekçe, Kazakça, Farsça…); ansiklopedi maddesi olmayan dillerde de Wikidata'da ad (etiket) ve diğer adlar
// kayıtlı olabiliyor. Kimlikler series_wiki_articles'tan (TMDB → Wikidata bağlantısı); tahmin yok. Ayda bir yenilenir.

// Askıda kalan istek zincirdeki diğer işleri bloklamasın (2026-10-16): her istek için süre sınırı.
const FETCH_TIMEOUT_MS = 30000

const API = 'https://www.wikidata.org/w/api.php'
const USER_AGENT = 'gorunurluk-platformu/1.0 (T.C. Iletisim Baskanligi; dizi ad eslemesi)'
const LANGS = [
  'ru',
  'uk',
  'kk',
  'ky',
  'uz',
  'tk',
  'tg',
  'az',
  'ka',
  'hy',
  'fa',
  'ar',
  'ur',
  'ps',
  'sq',
  'bs',
  'sr',
  'mk',
  'bg',
  'ro',
  'el',
  'hu',
  'pl',
]
const BATCH = 50
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000

db.exec(`
  CREATE TABLE IF NOT EXISTS series_wikidata_labels (
    tmdb_id INTEGER NOT NULL,
    lang TEXT NOT NULL,
    label TEXT NOT NULL,
    kind TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (tmdb_id, lang, label)
  );
  CREATE TABLE IF NOT EXISTS series_wikidata_broadcasters (
    tmdb_id INTEGER NOT NULL,
    broadcaster TEXT NOT NULL,
    PRIMARY KEY (tmdb_id, broadcaster)
  )
`)

/** wbgetentities yanıtı → { Q-kimliği: [ilk yayıncı (P449) Q-kimlikleri] }. */
export function parseBroadcasterClaims(body) {
  const out = {}
  for (const [id, e] of Object.entries(body?.entities || {}))
    out[id] = (e.claims?.P449 || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean)
  return out
}

/** Wikidata'ya göre ilk yayıncısı TRT olan diziler (TMDB kimlikleri). */
export function wikidataTrtSeries() {
  try {
    return new Set(
      db
        .prepare(
          "SELECT DISTINCT tmdb_id FROM series_wikidata_broadcasters WHERE broadcaster LIKE 'TRT%' OR broadcaster LIKE 'Türkiye Radyo%' OR broadcaster = 'tabii'"
        )
        .all()
        .map((r) => r.tmdb_id)
    )
  } catch {
    return new Set()
  }
}

/** wbgetentities yanıtı → [{ wikidataId, lang, label, kind: 'label'|'alias' }]. */
export function parseEntities(body) {
  const out = []
  for (const [id, e] of Object.entries(body?.entities || {})) {
    for (const [lang, v] of Object.entries(e.labels || {}))
      out.push({ wikidataId: id, lang, label: v.value, kind: 'label' })
    for (const [lang, list] of Object.entries(e.aliases || {}))
      for (const v of list) out.push({ wikidataId: id, lang, label: v.value, kind: 'alias' })
  }
  return out
}

const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
const metaSet = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)

export async function refreshWikidataLabelsIfNeeded({ fetchFn = fetch, now = new Date(), force = false } = {}) {
  const last = Number(metaGet.get('wikidataLabelsAt')?.value || 0)
  if (!force && now.getTime() - last < REFRESH_MS) return null
  const rows = db
    .prepare('SELECT DISTINCT tmdb_id, wikidata_id FROM series_wiki_articles WHERE wikidata_id IS NOT NULL')
    .all()
  const tmdbByQ = new Map(rows.map((r) => [r.wikidata_id, r.tmdb_id]))
  const ids = [...tmdbByQ.keys()]
  const put = db.prepare(
    `INSERT INTO series_wikidata_labels (tmdb_id, lang, label, kind, fetched_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tmdb_id, lang, label) DO UPDATE SET kind = excluded.kind, fetched_at = excluded.fetched_at`
  )
  let saved = 0
  const broadcasters = {} // dizi Q → [yayıncı Q]
  for (let i = 0; i < ids.length; i += BATCH) {
    const q = new URLSearchParams({
      action: 'wbgetentities',
      ids: ids.slice(i, i + BATCH).join('|'),
      props: 'labels|aliases|claims',
      languages: LANGS.join('|'),
      format: 'json',
    })
    const res = await fetchFn(`${API}?${q}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`)
    const body = await res.json()
    Object.assign(broadcasters, parseBroadcasterClaims(body))
    for (const r of parseEntities(body)) {
      const tmdb = tmdbByQ.get(r.wikidataId)
      if (tmdb == null || !r.label?.trim()) continue
      put.run(tmdb, r.lang, r.label.trim(), r.kind, now.toISOString())
      saved++
    }
  }
  // Yayıncı adları (TRT 1, Star TV…)
  const bIds = [...new Set(Object.values(broadcasters).flat())]
  const bName = new Map()
  for (let i = 0; i < bIds.length; i += BATCH) {
    const q = new URLSearchParams({
      action: 'wbgetentities',
      ids: bIds.slice(i, i + BATCH).join('|'),
      props: 'labels',
      languages: 'tr|en',
      format: 'json',
    })
    const res = await fetchFn(`${API}?${q}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`)
    for (const [id, e] of Object.entries((await res.json()).entities || {}))
      bName.set(id, e.labels?.tr?.value || e.labels?.en?.value || id)
  }
  const putB = db.prepare('INSERT OR IGNORE INTO series_wikidata_broadcasters (tmdb_id, broadcaster) VALUES (?, ?)')
  db.prepare('DELETE FROM series_wikidata_broadcasters').run()
  for (const [q, list] of Object.entries(broadcasters))
    for (const b of list) if (tmdbByQ.has(q)) putB.run(tmdbByQ.get(q), bName.get(b) || b)
  metaSet.run('wikidataLabelsAt', String(now.getTime()))
  return { series: ids.length, labels: saved }
}
