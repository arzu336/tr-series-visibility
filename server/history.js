import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HISTORY_PATH = path.join(__dirname, 'data', 'visibility-history.json')

const SNAPSHOT_INTERVAL_MS = 12 * 60 * 60 * 1000 // en az 12 saatte bir yeni anlık görüntü al
const TARGET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 gün öncesiyle kıyaslamayı hedefle
const MIN_WINDOW_MS = 24 * 60 * 60 * 1000 // en az 1 günlük geçmiş yoksa "yetersiz veri"
const MAX_SNAPSHOTS_PER_COUNTRY = 60
const RISING_THRESHOLD_PCT = 5
const FALLING_THRESHOLD_PCT = -5

export function loadHistoryStore() {
  if (!fs.existsSync(HISTORY_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveHistoryStore(history) {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true })
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history), 'utf8')
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
    if (!history[c.iso2]) history[c.iso2] = []
    history[c.iso2].push({ score: c.score, capturedAt: now })
    if (history[c.iso2].length > MAX_SNAPSHOTS_PER_COUNTRY) {
      history[c.iso2] = history[c.iso2].slice(-MAX_SNAPSHOTS_PER_COUNTRY)
    }
  })
  history.__lastSnapshotAt = now
  saveHistoryStore(history)
}
