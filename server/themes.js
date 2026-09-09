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

// Her dizi özetini dahili LLM sunucusuna gönderip tema/güven skoru çıkarır —
// sadece henüz sınıflandırılmamış (yeni) diziler için, en fazla
// CLASSIFY_CONCURRENCY kadar eşzamanlı istekle (TMDB'nin top-200 listesi
// rotasyon yaptığında onlarca yeni dizi birden sıraya girebiliyor).
// Denetim bulgusu O-4: index.js her `/api` isteğini `runWithUserContext(userId, …)` içinde
// çalıştırıyor. TMDB'nin 24 saatlik önbelleği dolduğunda, o an gelen İLK kullanıcı isteği bu
// katalog geneli sınıflandırmayı tetikliyor ve BEKLEYEN TÜM dizilerin LLM çağrıları o kullanıcının
// 150'lik günlük kotasına yazılıyordu. Soğuk bir veritabanında bu yüzlerce çağrı demek: kullanıcı
// hiçbir şey yapmadan kotasını tüketiyor, kota dolunca da themes.js kalan dizileri üstel geri
// çekilmeli "hata" olarak kaydediyor — yani BİR kullanıcının kotası KURUM kataloğunun verisini
// bozuyordu. Bu iş kimin tetiklediğinden bağımsız, kurumsal bir arka plan işidir: kullanıcı
// bağlamı dışında (userId=null) çalıştırılır, böylece kotaya hiç yazılmaz.
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

// İnsan override'ını siler, kaydı LLM'in orijinal sınıflandırmasına döndürür — Analist
// Paneli'ndeki "AI önerisine geri dön" butonu için (bkz. AnalystDashboard.jsx). Orijinal
// LLM sonucu (theme/confidence) hiç silinmiyor, sadece override_* kolonları NULL'a çekiliyor.
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
