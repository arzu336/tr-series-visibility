import db, { inTransaction } from '../db.js'

// Tarihe göre rapor için geçmiş kayıtları (2026-10-13). Bu verilerin canlı tabloları her güncellemede eskisinin
// üzerine yazılıyordu; artık her güncelleme ayrıca buraya düşer:
//   - press_history: basın taraması (dizi × ülke × tarama günü) — media_sentiment yalnızca son taramayı tutar.
//   - watch_signal_daily: ülkenin günlük izlenme düzeyi ve bileşenleri.
//   - availability_spans: dizi × ülke × platform için ilk ve son görüldüğü gün (aralık kaydı, az yer kaplar).
//   - trends_windows: Google arama ilgisinin her 12 aylık serisi kendi aralığıyla (değerler aralığın içinde
//     0–100'e ölçeklendiği için seriler birleştirilmez; rapor aralığı kapsayan en yeni seriyi kullanır).

db.exec(`
  CREATE TABLE IF NOT EXISTS press_history (
    series_id INTEGER NOT NULL,
    country_iso2 TEXT NOT NULL,
    scanned_on TEXT NOT NULL,
    source TEXT,
    total_news_count INTEGER,
    positive_score REAL,
    neutral_score REAL,
    negative_score REAL,
    dominant_sentiment TEXT,
    PRIMARY KEY (series_id, country_iso2, scanned_on)
  );
  CREATE TABLE IF NOT EXISTS watch_signal_daily (
    iso2 TEXT NOT NULL,
    date TEXT NOT NULL,
    idx REAL,
    level TEXT,
    provisional INTEGER,
    components TEXT,
    PRIMARY KEY (iso2, date)
  );
  CREATE TABLE IF NOT EXISTS availability_spans (
    series_id INTEGER NOT NULL,
    iso2 TEXT NOT NULL,
    platform TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (series_id, iso2, platform)
  );
  CREATE TABLE IF NOT EXISTS trends_windows (
    query TEXT NOT NULL,
    geo TEXT NOT NULL,
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    timeline TEXT NOT NULL,
    PRIMARY KEY (query, geo, window_start, window_end)
  );
`)

const day = (d = new Date()) => d.toISOString().slice(0, 10)

const putPress = db.prepare(`
  INSERT INTO press_history (series_id, country_iso2, scanned_on, source, total_news_count, positive_score,
    neutral_score, negative_score, dominant_sentiment)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(series_id, country_iso2, scanned_on) DO UPDATE SET source = excluded.source,
    total_news_count = excluded.total_news_count, positive_score = excluded.positive_score,
    neutral_score = excluded.neutral_score, negative_score = excluded.negative_score,
    dominant_sentiment = excluded.dominant_sentiment
`)

/** Basın taraması sonucu (media_sentiment satırı biçiminde). Aynı gün ikinci tarama ilkinin yerine geçer. */
export function recordPress(row, now = new Date()) {
  if (!row?.series_id || !row?.country_iso2) return
  putPress.run(
    row.series_id,
    row.country_iso2,
    day(now),
    row.source ?? null,
    row.total_news_count ?? null,
    row.positive_score ?? null,
    row.neutral_score ?? null,
    row.negative_score ?? null,
    row.dominant_sentiment ?? null
  )
}

const hasWatchDay = db.prepare('SELECT 1 FROM watch_signal_daily WHERE date = ? LIMIT 1')
const putWatch = db.prepare(
  'INSERT OR REPLACE INTO watch_signal_daily (iso2, date, idx, level, provisional, components) VALUES (?, ?, ?, ?, ?, ?)'
)

/** Günde bir kez: bütün ülkelerin izlenme düzeyi. `byIso2`: getWatchSignals().byIso2. */
export function recordWatchSignals(byIso2, now = new Date()) {
  const d = day(now)
  if (!byIso2 || hasWatchDay.get(d)) return false
  inTransaction(() => {
    for (const [iso2, s] of Object.entries(byIso2)) {
      const comps = Object.fromEntries(
        Object.entries(s.components || {}).map(([k, c]) => [k, c?.present ? (c.p ?? null) : null])
      )
      putWatch.run(iso2, d, s.index ?? null, s.level ?? null, s.provisional ? 1 : 0, JSON.stringify(comps))
    }
  })
  return true
}

const touchSpan = db.prepare(`
  INSERT INTO availability_spans (series_id, iso2, platform, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(series_id, iso2, platform) DO UPDATE SET last_seen = MAX(availability_spans.last_seen, excluded.last_seen)
`)
const hasSpanDay = db.prepare('SELECT 1 FROM availability_spans WHERE last_seen = ? LIMIT 1')
const STREAM_KEYS = ['flatrate', 'free', 'ads']

/** Günde bir kez: katalogdaki her dizinin her ülkedeki platformları; aralığın son gününü günceller. */
export function recordAvailability(providersById, now = new Date()) {
  const d = day(now)
  if (!providersById || hasSpanDay.get(d)) return false
  inTransaction(() => {
    for (const [sid, byCountry] of Object.entries(providersById)) {
      for (const [iso2, entry] of Object.entries(byCountry || {})) {
        const names = new Set()
        for (const k of STREAM_KEYS)
          for (const p of entry?.[k] || []) names.add(p.provider_name || String(p.provider_id))
        for (const name of names) touchSpan.run(Number(sid), iso2, name, d, d)
      }
    }
  })
  return true
}

const putTrends = db.prepare(`
  INSERT OR REPLACE INTO trends_windows (query, geo, window_start, window_end, fetched_at, timeline) VALUES (?, ?, ?, ?, ?, ?)
`)

/** Google arama ilgisi serisi (fetchTrendsTimeSeriesRaw sonucu) kendi aralığıyla. */
export function recordTrendsWindow(result) {
  const t = result?.timeline || []
  if (t.length < 2) return
  const iso = (s) => new Date(s * 1000).toISOString().slice(0, 10)
  putTrends.run(
    String(result.query).toLocaleLowerCase('tr'),
    result.iso2 || 'WW',
    iso(t[0].timestamp),
    iso(t[t.length - 1].timestamp),
    result.queriedAt || new Date().toISOString(),
    JSON.stringify(t)
  )
}
