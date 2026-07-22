import db from './db.js'

const SNAPSHOT_INTERVAL_MS = 12 * 60 * 60 * 1000 // en az 12 saatte bir yeni anlık görüntü al
const TARGET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 gün öncesiyle kıyaslamayı hedefle
const MIN_WINDOW_MS = 24 * 60 * 60 * 1000 // en az 1 günlük geçmiş yoksa "yetersiz veri"
const MAX_SNAPSHOTS_PER_COUNTRY = 60
const RISING_THRESHOLD_PCT = 5
const FALLING_THRESHOLD_PCT = -5

const selectAllStmt = db.prepare('SELECT iso2, score, captured_at FROM visibility_history ORDER BY captured_at ASC')
const selectMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const insertSnapshotStmt = db.prepare('INSERT INTO visibility_history (iso2, score, captured_at) VALUES (?, ?, ?)')
const pruneStmt = db.prepare(`
  DELETE FROM visibility_history
  WHERE iso2 = ? AND rowid NOT IN (
    SELECT rowid FROM visibility_history WHERE iso2 = ? ORDER BY captured_at DESC LIMIT ?
  )
`)
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES ('lastSnapshotAt', ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

export function loadHistoryStore() {
  const history = {}
  for (const row of selectAllStmt.all()) {
    if (!history[row.iso2]) history[row.iso2] = []
    history[row.iso2].push({ score: row.score, capturedAt: row.captured_at })
  }
  const metaRow = selectMetaStmt.get('lastSnapshotAt')
  history.__lastSnapshotAt = metaRow ? Number(metaRow.value) : 0
  return history
}

function pickReferenceSnapshot(snapshots, now) {
  if (!snapshots || snapshots.length === 0) return null
  const targetTime = now - TARGET_WINDOW_MS
  // 7 gün önceye eşit ya da ondan daha eski kayıtların en yenisi
  const candidates = snapshots.filter((s) => s.capturedAt <= targetTime)
  if (candidates.length > 0) return candidates[candidates.length - 1]
  // 7 günlük geçmiş henüz birikmediyse elimizdeki en eski kaydı kullan (kısmi pencere)
  return snapshots[0]
}

// Bir ülkenin skorunu geçmiş anlık görüntülerle kıyaslayıp gerçek bir trend yönü üretir.
// Takip yeni başladığında ("yetersiz-veri") dürüstçe belirtilir — uydurma bir yön göstermez.
export function getTrend(history, iso2, currentScore) {
  const now = Date.now()
  const snapshots = history[iso2] || []
  const reference = pickReferenceSnapshot(snapshots, now)
  if (!reference || now - reference.capturedAt < MIN_WINDOW_MS) {
    return { direction: 'yetersiz-veri', changePct: null, windowDays: null }
  }
  const changePct =
    reference.score === 0 ? 0 : Math.round(((currentScore - reference.score) / reference.score) * 1000) / 10
  const windowDays = Math.round((now - reference.capturedAt) / (24 * 60 * 60 * 1000))

  let direction = 'sabit'
  if (changePct >= RISING_THRESHOLD_PCT) direction = 'yükseliyor'
  else if (changePct <= FALLING_THRESHOLD_PCT) direction = 'düşüyor'

  return { direction, changePct, windowDays }
}

// En az SNAPSHOT_INTERVAL_MS aradan sonra çağrıldığında yeni bir anlık görüntü kaydeder.
export function maybeRecordSnapshot(history, countries) {
  const now = Date.now()
  const marker = history.__lastSnapshotAt || 0
  if (now - marker < SNAPSHOT_INTERVAL_MS) return

  countries.forEach((c) => {
    insertSnapshotStmt.run(c.iso2, c.score, now)
    pruneStmt.run(c.iso2, c.iso2, MAX_SNAPSHOTS_PER_COUNTRY)

    if (!history[c.iso2]) history[c.iso2] = []
    history[c.iso2].push({ score: c.score, capturedAt: now })
    if (history[c.iso2].length > MAX_SNAPSHOTS_PER_COUNTRY) {
      history[c.iso2] = history[c.iso2].slice(-MAX_SNAPSHOTS_PER_COUNTRY)
    }
  })
  setMetaStmt.run(String(now))
  history.__lastSnapshotAt = now
}
