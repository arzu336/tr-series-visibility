import db from './db.js'

// server/history.js ile birebir aynı yöntem (7 günlük pencere, "yetersiz-veri"
// dürüstlüğü) — ülke bazlı görünürlük skoru yerine burada Küresel Kıyaslama
// Modülü'ndeki (TR/US/KR/ES) toplam skor izleniyor.
const SNAPSHOT_INTERVAL_MS = 12 * 60 * 60 * 1000
const TARGET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const MIN_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_SNAPSHOTS_PER_COUNTRY = 60
const RISING_THRESHOLD_PCT = 5
const FALLING_THRESHOLD_PCT = -5
const META_KEY = 'benchmarkLastSnapshotAt'

const selectAllStmt = db.prepare('SELECT country_code, total_score, captured_at FROM benchmark_history ORDER BY captured_at ASC')
const selectMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const insertSnapshotStmt = db.prepare('INSERT INTO benchmark_history (country_code, total_score, captured_at) VALUES (?, ?, ?)')
const pruneStmt = db.prepare(`
  DELETE FROM benchmark_history
  WHERE country_code = ? AND rowid NOT IN (
    SELECT rowid FROM benchmark_history WHERE country_code = ? ORDER BY captured_at DESC LIMIT ?
  )
`)
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

export function loadBenchmarkHistoryStore() {
  const history = {}
  for (const row of selectAllStmt.all()) {
    if (!history[row.country_code]) history[row.country_code] = []
    history[row.country_code].push({ totalScore: row.total_score, capturedAt: row.captured_at })
  }
  const metaRow = selectMetaStmt.get(META_KEY)
  history.__lastSnapshotAt = metaRow ? Number(metaRow.value) : 0
  return history
}

function pickReferenceSnapshot(snapshots, now) {
  if (!snapshots || snapshots.length === 0) return null
  const targetTime = now - TARGET_WINDOW_MS
  const candidates = snapshots.filter((s) => s.capturedAt <= targetTime)
  if (candidates.length > 0) return candidates[candidates.length - 1]
  return snapshots[0]
}

export function getBenchmarkTrend(history, countryCode, currentTotalScore) {
  const now = Date.now()
  const snapshots = history[countryCode] || []
  const reference = pickReferenceSnapshot(snapshots, now)
  if (!reference || now - reference.capturedAt < MIN_WINDOW_MS) {
    return { direction: 'yetersiz-veri', changePct: null, windowDays: null }
  }
  const changePct =
    reference.totalScore === 0
      ? 0
      : Math.round(((currentTotalScore - reference.totalScore) / reference.totalScore) * 1000) / 10
  const windowDays = Math.round((now - reference.capturedAt) / (24 * 60 * 60 * 1000))

  let direction = 'sabit'
  if (changePct >= RISING_THRESHOLD_PCT) direction = 'yükseliyor'
  else if (changePct <= FALLING_THRESHOLD_PCT) direction = 'düşüyor'

  return { direction, changePct, windowDays }
}

export function maybeRecordBenchmarkSnapshot(history, countries) {
  const now = Date.now()
  const marker = history.__lastSnapshotAt || 0
  if (now - marker < SNAPSHOT_INTERVAL_MS) return

  countries.forEach((c) => {
    insertSnapshotStmt.run(c.code, c.totalScore, now)
    pruneStmt.run(c.code, c.code, MAX_SNAPSHOTS_PER_COUNTRY)

    if (!history[c.code]) history[c.code] = []
    history[c.code].push({ totalScore: c.totalScore, capturedAt: now })
    if (history[c.code].length > MAX_SNAPSHOTS_PER_COUNTRY) {
      history[c.code] = history[c.code].slice(-MAX_SNAPSHOTS_PER_COUNTRY)
    }
  })
  setMetaStmt.run(META_KEY, String(now))
  history.__lastSnapshotAt = now
}
