import db from './db.js'
import { runWithUserContext } from './services/liveCallQuota.js'
import { classifyWithLLM } from './llm.js'
import { mapWithConcurrency } from './utils/concurrency.js'

const CLASSIFY_CONCURRENCY = 5

export const THEMES = [
  'aile',
  'kadın hakları',
  'göç',
  'adalet',
  'aşk',
  'suç örgütü',
  'tarih',
  'diğer',
]

const selectAllStmt = db.prepare('SELECT * FROM theme_classifications')
const selectOneStmt = db.prepare('SELECT * FROM theme_classifications WHERE id = ?')
const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO theme_classifications (id, name, overview, theme, confidence, classified_at)
  VALUES (?, ?, ?, ?, ?, ?)
`)
const getFailureStmt = db.prepare('SELECT * FROM classification_failures WHERE id = ?')
const upsertFailureStmt = db.prepare(`
  INSERT INTO classification_failures (id, name, overview, failure_count, last_error, last_failed_at, next_retry_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    overview = excluded.overview,
    failure_count = excluded.failure_count,
    last_error = excluded.last_error,
    last_failed_at = excluded.last_failed_at,
    next_retry_at = excluded.next_retry_at
`)
const deleteFailureStmt = db.prepare('DELETE FROM classification_failures WHERE id = ?')
const updateOverrideStmt = db.prepare(`
  UPDATE theme_classifications SET override_theme = ?, override_reviewer = ?, override_at = ? WHERE id = ?
`)

function rowToEntry(row) {
  return {
    id: row.id,
    name: row.name,
    overview: row.overview,
    theme: row.theme,
    confidence: row.confidence,
    classifiedAt: row.classified_at,
    humanOverride: row.override_theme
      ? { theme: row.override_theme, reviewer: row.override_reviewer, at: row.override_at }
      : null,
  }
}

export function ensureClassified(series) {
  return runWithUserContext(null, () => ensureClassifiedInner(series))
}

async function ensureClassifiedInner(series) {
  const existingIds = new Set(selectAllStmt.all().map((r) => r.id))
  const now = Date.now()
  const pending = series.filter((s) => {
    if (existingIds.has(s.id)) return false
    const failure = getFailureStmt.get(s.id)
    return !failure || !failure.next_retry_at || failure.next_retry_at <= now
  })

  await mapWithConcurrency(pending, CLASSIFY_CONCURRENCY, async (s) => {
    try {
      const { theme, confidence } = await classifyWithLLM(s.overview, THEMES)
      insertStmt.run(s.id, s.name, s.overview, theme, confidence, new Date().toISOString())
      deleteFailureStmt.run(s.id)
    } catch (err) {
      const previous = getFailureStmt.get(s.id)
      const failureCount = (previous?.failure_count || 0) + 1
      const failedAt = Date.now()
      const retryDelayMs = Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * 2 ** (failureCount - 1))
      upsertFailureStmt.run(s.id, s.name, s.overview, failureCount, err.message.slice(0, 500), failedAt, failedAt + retryDelayMs)
      console.error(`[themes] "${s.name}" (id:${s.id}) LLM ile sınıflandırılamadı:`, err.message)
    }
  })

  return getThemeStore()
}

export function getThemeStore() {
  const store = {}
  for (const row of selectAllStmt.all()) {
    store[String(row.id)] = rowToEntry(row)
  }
  return store
}

export function setHumanOverride(seriesId, theme, reviewer) {
  if (!THEMES.includes(theme)) {
    throw new Error(`Geçersiz tema: ${theme}`)
  }
  const id = Number(seriesId)
  const row = selectOneStmt.get(id)
  if (!row) {
    throw new Error(`Dizi bulunamadı: ${seriesId}`)
  }
  updateOverrideStmt.run(theme, reviewer || 'anonim', new Date().toISOString(), id)
  return rowToEntry(selectOneStmt.get(id))
}

export function clearHumanOverride(seriesId) {
  const id = Number(seriesId)
  const row = selectOneStmt.get(id)
  if (!row) {
    throw new Error(`Dizi bulunamadı: ${seriesId}`)
  }
  updateOverrideStmt.run(null, null, null, id)
  return rowToEntry(selectOneStmt.get(id))
}

export function effectiveTheme(entry) {
  return entry.humanOverride?.theme ?? entry.theme
}

export function effectiveConfidence(entry) {
  return entry.humanOverride ? 100 : entry.confidence
}
