import db, { inTransaction } from './db.js'

const SNAPSHOT_INTERVAL_MS = 12 * 60 * 60 * 1000
const MAX_SNAPSHOTS_PER_SERIES = 60
const ROLLUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const SNAPSHOT_META_KEY = 'lastSeriesSnapshotAt'
const ROLLUP_META_KEY = 'lastSeriesMonthlyRollupAt'

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)
const insertSnapshotStmt = db.prepare(
  'INSERT INTO series_popularity_history (tmdb_id, popularity, captured_at) VALUES (?, ?, ?)'
)
const pruneStmt = db.prepare(`
  DELETE FROM series_popularity_history
  WHERE tmdb_id = ? AND rowid NOT IN (
    SELECT rowid FROM series_popularity_history WHERE tmdb_id = ? ORDER BY captured_at DESC LIMIT ?
  )
`)
const selectRawStmt = db.prepare('SELECT tmdb_id, popularity, captured_at FROM series_popularity_history')
const selectMonthlyKeysStmt = db.prepare(
  "SELECT tmdb_id, year, month FROM series_popularity_monthly WHERE source = 'tmdb_snapshot'"
)
const upsertMonthlyStmt = db.prepare(`
  INSERT INTO series_popularity_monthly (tmdb_id, year, month, avg_popularity, sample_count, source)
  VALUES (?, ?, ?, ?, ?, 'tmdb_snapshot')
  ON CONFLICT(tmdb_id, year, month, source) DO UPDATE SET
    avg_popularity = excluded.avg_popularity, sample_count = excluded.sample_count
`)
const selectMonthlyForYearsStmt = db.prepare(
  'SELECT tmdb_id, year, month, avg_popularity, source FROM series_popularity_monthly WHERE year >= ?'
)

function round1(n) {
  return Math.round(n * 10) / 10
}

export function maybeRecordSeriesSnapshot(series) {
  const now = Date.now()
  const row = getMetaStmt.get(SNAPSHOT_META_KEY)
  const lastRunAt = row ? Number(row.value) : 0
  if (now - lastRunAt < SNAPSHOT_INTERVAL_MS) return

  inTransaction(() => {
    for (const s of series) {
      insertSnapshotStmt.run(s.id, s.popularity, now)
      pruneStmt.run(s.id, s.id, MAX_SNAPSHOTS_PER_SERIES)
    }
    setMetaStmt.run(SNAPSHOT_META_KEY, String(now))
  })
}

export function rollupSeriesMonthlyIfNeeded() {
  const now = Date.now()
  const row = getMetaStmt.get(ROLLUP_META_KEY)
  const lastRunAt = row ? Number(row.value) : 0
  if (now - lastRunAt < ROLLUP_INTERVAL_MS) return

  const nowDate = new Date(now)
  const currentYear = nowDate.getUTCFullYear()
  const currentMonth = nowDate.getUTCMonth() + 1

  const alreadyRolled = new Set(selectMonthlyKeysStmt.all().map((r) => `${r.tmdb_id}:${r.year}:${r.month}`))

  const buckets = new Map()
  for (const r of selectRawStmt.all()) {
    const d = new Date(r.captured_at)
    const year = d.getUTCFullYear()
    const month = d.getUTCMonth() + 1
    if (year === currentYear && month === currentMonth) continue
    const key = `${r.tmdb_id}:${year}:${month}`
    if (alreadyRolled.has(key)) continue
    if (!buckets.has(key)) buckets.set(key, { tmdb_id: r.tmdb_id, year, month, sum: 0, count: 0 })
    const b = buckets.get(key)
    b.sum += r.popularity
    b.count += 1
  }

  inTransaction(() => {
    for (const b of buckets.values()) {
      upsertMonthlyStmt.run(b.tmdb_id, b.year, b.month, b.sum / b.count, b.count)
    }
    setMetaStmt.run(ROLLUP_META_KEY, String(now))
  })
}

function currentMonthAverages() {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  const byId = new Map()
  for (const r of selectRawStmt.all()) {
    const d = new Date(r.captured_at)
    if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month) continue
    if (!byId.has(r.tmdb_id)) byId.set(r.tmdb_id, { sum: 0, count: 0 })
    const c = byId.get(r.tmdb_id)
    c.sum += r.popularity
    c.count += 1
  }
  return byId
}

function yuzdelikAta(entries) {
  const kaynagaGore = new Map()
  for (const entry of entries) {
    if (!kaynagaGore.has(entry.source)) kaynagaGore.set(entry.source, [])
    kaynagaGore.get(entry.source).push(entry.value)
  }
  for (const dizi of kaynagaGore.values()) dizi.sort((a, b) => a - b)
  for (const entry of entries) {
    const dizi = kaynagaGore.get(entry.source)
    const altinda = dizi.filter((v) => v < entry.value).length
    const esit = dizi.filter((v) => v === entry.value).length
    entry.percentile = Math.round(((altinda + esit / 2) / dizi.length) * 1000) / 10
    entry.percentileReliable = dizi.length >= 5
  }
  return entries
}

export function getSeriesPopularityMap(range) {
  const now = new Date()
  const currentYear = now.getUTCFullYear()

  if (range === 'monthly') {
    const current = currentMonthAverages()
    const result = new Map()
    for (const [tmdbId, c] of current) {
      result.set(tmdbId, { value: round1(c.sum / c.count), sampleCount: c.count, isPartial: false, source: 'tmdb_snapshot' })
    }
    yuzdelikAta([...result.values()])
    return result
  }

  const yearsBack = range === '5yearly' ? 5 : 1
  const cutoffYear = currentYear - yearsBack + 1

  const bySeriesSource = new Map()
  for (const r of selectMonthlyForYearsStmt.all(cutoffYear)) {
    const src = r.source || 'tmdb_snapshot'
    if (!bySeriesSource.has(r.tmdb_id)) bySeriesSource.set(r.tmdb_id, new Map())
    const bySource = bySeriesSource.get(r.tmdb_id)
    if (!bySource.has(src)) bySource.set(src, { sum: 0, count: 0, months: new Set() })
    const acc = bySource.get(src)
    acc.sum += r.avg_popularity
    acc.count += 1
    acc.months.add(`${r.year}-${r.month}`)
  }

  const current = currentMonthAverages()
  for (const [tmdbId, c] of current) {
    if (!bySeriesSource.has(tmdbId)) bySeriesSource.set(tmdbId, new Map())
    const bySource = bySeriesSource.get(tmdbId)
    if (!bySource.has('tmdb_snapshot')) bySource.set('tmdb_snapshot', { sum: 0, count: 0, months: new Set() })
    const acc = bySource.get('tmdb_snapshot')
    acc.sum += c.sum / c.count
    acc.count += 1
    acc.months.add('current')
  }

  const expectedMonths = yearsBack * 12
  const result = new Map()
  for (const [tmdbId, bySource] of bySeriesSource) {
    const chosenSource = bySource.has('reytingtv_rank') ? 'reytingtv_rank' : 'tmdb_snapshot'
    const acc = bySource.get(chosenSource)
    if (!acc || acc.count === 0) continue
    result.set(tmdbId, {
      value: round1(acc.sum / acc.count),
      sampleCount: acc.count,
      isPartial: acc.months.size < expectedMonths,
      source: chosenSource,
    })
  }
  yuzdelikAta([...result.values()])
  return result
}
