import db, { inTransaction } from './db.js'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// history.js / benchmark-history.js / duolingo-history.js aynı algoritmanın üç kopyasıydı
// (yalnızca tablo, sütun ve eşik farklı): 12 saatte bir anlık görüntü, 7 gün geriye referans
// nokta, en az 24 saatlik pencere, ülke başına 60 kayıt budaması, ±eşik ile yön. Fabrika bu
// mantığı tek yerde tutar; üç modül ince sarmalayıcı olarak dışa açık imzalarını korur.
export function createTrendStore({
  table,
  valueColumn,
  keyColumn = null,
  valueField = 'value',
  metaKey,
  snapshotIntervalMs = 12 * HOUR_MS,
  targetWindowMs = 7 * DAY_MS,
  minWindowMs = DAY_MS,
  maxSnapshots = 60,
  risingPct = 5,
  fallingPct = -5,
}) {
  if (!table || !valueColumn || !metaKey) throw new Error('createTrendStore: table, valueColumn ve metaKey zorunlu')
  const SINGLE_KEY = '__all'

  const selectAllStmt = keyColumn
    ? db.prepare(`SELECT ${keyColumn} AS k, ${valueColumn} AS v, captured_at FROM ${table} ORDER BY captured_at ASC`)
    : db.prepare(`SELECT ${valueColumn} AS v, captured_at FROM ${table} ORDER BY captured_at ASC`)
  const insertStmt = keyColumn
    ? db.prepare(`INSERT INTO ${table} (${keyColumn}, ${valueColumn}, captured_at) VALUES (?, ?, ?)`)
    : db.prepare(`INSERT INTO ${table} (${valueColumn}, captured_at) VALUES (?, ?)`)
  const pruneStmt = keyColumn
    ? db.prepare(
        `DELETE FROM ${table} WHERE ${keyColumn} = ? AND rowid NOT IN (SELECT rowid FROM ${table} WHERE ${keyColumn} = ? ORDER BY captured_at DESC LIMIT ?)`
      )
    : db.prepare(`DELETE FROM ${table} WHERE rowid NOT IN (SELECT rowid FROM ${table} ORDER BY captured_at DESC LIMIT ?)`)
  const selectMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
  const setMetaStmt = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')

  const entry = (v, capturedAt) => ({ [valueField]: v, capturedAt })

  function loadStore() {
    const history = {}
    for (const row of selectAllStmt.all()) {
      const k = keyColumn ? row.k : SINGLE_KEY
      if (!history[k]) history[k] = []
      history[k].push(entry(row.v, row.captured_at))
    }
    const metaRow = selectMetaStmt.get(metaKey)
    history.__lastSnapshotAt = metaRow ? Number(metaRow.value) : 0
    return history
  }

  function pickReferenceSnapshot(snapshots, now) {
    if (!snapshots || snapshots.length === 0) return null
    const targetTime = now - targetWindowMs
    const candidates = snapshots.filter((s) => s.capturedAt <= targetTime)
    if (candidates.length > 0) return candidates[candidates.length - 1]
    return snapshots[0]
  }

  function getTrend(history, key, currentValue, now = Date.now()) {
    const snapshots = history[keyColumn ? key : SINGLE_KEY] || []
    const reference = pickReferenceSnapshot(snapshots, now)
    if (!reference || now - reference.capturedAt < minWindowMs) {
      return { direction: 'yetersiz-veri', changePct: null, windowDays: null }
    }
    const ref = reference[valueField]
    const changePct = ref === 0 ? 0 : Math.round(((currentValue - ref) / ref) * 1000) / 10
    const windowDays = Math.round((now - reference.capturedAt) / DAY_MS)

    let direction = 'sabit'
    if (changePct >= risingPct) direction = 'yükseliyor'
    else if (changePct <= fallingPct) direction = 'düşüyor'

    return { direction, changePct, windowDays }
  }

  /** items: [{ key, value }] (anahtarsız tabloda key yok sayılır). Kapı kapalıysa false döner. */
  function maybeRecordSnapshot(history, items, now = Date.now()) {
    const marker = history.__lastSnapshotAt || 0
    if (now - marker < snapshotIntervalMs) return false

    inTransaction(() => {
      for (const it of items) {
        if (keyColumn) {
          insertStmt.run(it.key, it.value, now)
          pruneStmt.run(it.key, it.key, maxSnapshots)
        } else {
          insertStmt.run(it.value, now)
          pruneStmt.run(maxSnapshots)
        }
      }
      setMetaStmt.run(metaKey, String(now))
    })

    for (const it of items) {
      const k = keyColumn ? it.key : SINGLE_KEY
      if (!history[k]) history[k] = []
      history[k].push(entry(it.value, now))
      if (history[k].length > maxSnapshots) history[k] = history[k].slice(-maxSnapshots)
    }
    history.__lastSnapshotAt = now
    return true
  }

  return { loadStore, getTrend, maybeRecordSnapshot, SINGLE_KEY }
}
