import db from './db.js'

// server/benchmark-history.js / server/history.js ile birebir aynı yöntem (7 günlük
// pencere, "yetersiz-veri" dürüstlüğü) — burada tek bir küresel sayı (Duolingo'daki toplam
// Türkçe öğrenci sayısı) izleniyor, ülke bazlı değil.
const SNAPSHOT_INTERVAL_MS = 12 * 60 * 60 * 1000
const TARGET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const MIN_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_SNAPSHOTS = 60
const RISING_THRESHOLD_PCT = 1
const FALLING_THRESHOLD_PCT = -1
const META_KEY = 'duolingoLastSnapshotAt'

const selectAllStmt = db.prepare('SELECT total_learners, captured_at FROM duolingo_history ORDER BY captured_at ASC')
const selectMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const insertSnapshotStmt = db.prepare('INSERT INTO duolingo_history (total_learners, captured_at) VALUES (?, ?)')
const pruneStmt = db.prepare(`
  DELETE FROM duolingo_history
  WHERE rowid NOT IN (SELECT rowid FROM duolingo_history ORDER BY captured_at DESC LIMIT ?)
`)
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

function loadHistory() {
  const snapshots = selectAllStmt.all().map((row) => ({ totalLearners: row.total_learners, capturedAt: row.captured_at }))
  const metaRow = selectMetaStmt.get(META_KEY)
  return { snapshots, lastSnapshotAt: metaRow ? Number(metaRow.value) : 0 }
}

function pickReferenceSnapshot(snapshots, now) {
  if (!snapshots || snapshots.length === 0) return null
  const targetTime = now - TARGET_WINDOW_MS
  const candidates = snapshots.filter((s) => s.capturedAt <= targetTime)
  if (candidates.length > 0) return candidates[candidates.length - 1]
  return snapshots[0]
}

export function getDuolingoTrend(currentTotalLearners) {
  const { snapshots, lastSnapshotAt } = loadHistory()
  const now = Date.now()
  const reference = pickReferenceSnapshot(snapshots, now)

  if (!reference || now - reference.capturedAt < MIN_WINDOW_MS) {
    return { direction: 'yetersiz-veri', changePct: null, windowDays: null }
  }
  const changePct =
    reference.totalLearners === 0
      ? 0
      : Math.round(((currentTotalLearners - reference.totalLearners) / reference.totalLearners) * 1000) / 10
  const windowDays = Math.round((now - reference.capturedAt) / (24 * 60 * 60 * 1000))

  let direction = 'sabit'
  if (changePct >= RISING_THRESHOLD_PCT) direction = 'yükseliyor'
  else if (changePct <= FALLING_THRESHOLD_PCT) direction = 'düşüyor'

  return { direction, changePct, windowDays, lastSnapshotAt }
}

export function maybeRecordDuolingoSnapshot(totalLearners) {
  const { lastSnapshotAt } = loadHistory()
  const now = Date.now()
  if (now - lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return

  insertSnapshotStmt.run(totalLearners, now)
  pruneStmt.run(MAX_SNAPSHOTS)
  setMetaStmt.run(META_KEY, String(now))
}
