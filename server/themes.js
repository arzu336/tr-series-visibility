import db from './db.js'
import { classifyWithLLM } from './llm.js'

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
  INSERT OR IGNORE INTO theme_classifications (id, name, overview, theme, confidence, sentiment, classified_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)
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
    sentiment: row.sentiment,
    classifiedAt: row.classified_at,
    humanOverride: row.override_theme
      ? { theme: row.override_theme, reviewer: row.override_reviewer, at: row.override_at }
      : null,
  }
}

// Her dizi özetini dahili LLM sunucusuna gönderip tema/sentiment/güven skoru
// çıkarır — sadece henüz sınıflandırılmamış (yeni) diziler için, sırayla.
export async function ensureClassified(series) {
  const existingIds = new Set(selectAllStmt.all().map((r) => r.id))
  const pending = series.filter((s) => !existingIds.has(s.id))

  for (const s of pending) {
    try {
      const { theme, sentiment, confidence } = await classifyWithLLM(s.overview, THEMES)
      insertStmt.run(s.id, s.name, s.overview, theme, confidence, sentiment, new Date().toISOString())
    } catch (err) {
      console.error(`[themes] "${s.name}" (id:${s.id}) LLM ile sınıflandırılamadı:`, err.message)
    }
  }

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

export function effectiveTheme(entry) {
  return entry.humanOverride?.theme ?? entry.theme
}

export function effectiveConfidence(entry) {
  return entry.humanOverride ? 100 : entry.confidence
}
