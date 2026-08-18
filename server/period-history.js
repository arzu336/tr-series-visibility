import db from './db.js'

// server/history.js'teki visibility_history ham tablosu ülke başına en fazla 60 anlık görüntü
// tutar (bkz. MAX_SNAPSHOTS_PER_COUNTRY, ~30 gün) — kalıcı ay/yıl karşılaştırması için bu ham
// veri budanmadan önce buraya, budanmayan visibility_history_monthly'ye özetlenir.
const ROLLUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const META_KEY = 'lastMonthlyRollupAt'

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)
const selectRawStmt = db.prepare('SELECT iso2, score, captured_at FROM visibility_history')
const selectMonthlyKeysStmt = db.prepare('SELECT iso2, year, month FROM visibility_history_monthly')
const insertMonthlyStmt = db.prepare(`
  INSERT INTO visibility_history_monthly (iso2, year, month, avg_score, sample_count) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(iso2, year, month) DO UPDATE SET avg_score = excluded.avg_score, sample_count = excluded.sample_count
`)
const selectMonthlyForCountryStmt = db.prepare(
  'SELECT year, month, avg_score, sample_count FROM visibility_history_monthly WHERE iso2 = ? ORDER BY year, month'
)
const selectAllMonthlyStmt = db.prepare(
  'SELECT iso2, year, month, avg_score FROM visibility_history_monthly ORDER BY year, month'
)

function round1(n) {
  return Math.round(n * 10) / 10
}

function periodKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

// Günde bir kez (bkz. server/scheduler.js) tamamlanmış (bugünün ayı DEĞİL) ve henüz özetlenmemiş
// her (ülke, ay) için ham anlık görüntülerin ortalamasını alıp kalıcı tabloya yazar. Mevcut ayın
// verisi kasıtlı olarak burada işlenmez — henüz tamamlanmamış bir ayı "sabit" gibi kaydetmek
// yanıltıcı olurdu (bkz. getMonthlyPeriods'taki isCurrent ayrımı).
export function rollupMonthlyIfNeeded() {
  const now = Date.now()
  const row = getMetaStmt.get(META_KEY)
  const lastRunAt = row ? Number(row.value) : 0
  if (now - lastRunAt < ROLLUP_INTERVAL_MS) return

  const nowDate = new Date(now)
  const currentYear = nowDate.getUTCFullYear()
  const currentMonth = nowDate.getUTCMonth() + 1

  const alreadyRolled = new Set(selectMonthlyKeysStmt.all().map((r) => `${r.iso2}:${r.year}:${r.month}`))

  const buckets = new Map()
  for (const r of selectRawStmt.all()) {
    const d = new Date(r.captured_at)
    const year = d.getUTCFullYear()
    const month = d.getUTCMonth() + 1
    if (year === currentYear && month === currentMonth) continue
    const key = `${r.iso2}:${year}:${month}`
    if (alreadyRolled.has(key)) continue
    if (!buckets.has(key)) buckets.set(key, { iso2: r.iso2, year, month, sum: 0, count: 0 })
    const b = buckets.get(key)
    b.sum += r.score
    b.count += 1
  }

  for (const b of buckets.values()) {
    insertMonthlyStmt.run(b.iso2, b.year, b.month, b.sum / b.count, b.count)
  }

  setMetaStmt.run(META_KEY, String(now))
}

function currentMonthAverages(iso2Filter = null) {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  const rows = iso2Filter
    ? db.prepare('SELECT iso2, score, captured_at FROM visibility_history WHERE iso2 = ?').all(iso2Filter)
    : db.prepare('SELECT iso2, score, captured_at FROM visibility_history').all()

  const byCountry = new Map()
  for (const r of rows) {
    const d = new Date(r.captured_at)
    if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month) continue
    if (!byCountry.has(r.iso2)) byCountry.set(r.iso2, { sum: 0, count: 0 })
    const c = byCountry.get(r.iso2)
    c.sum += r.score
    c.count += 1
  }
  return { year, month, byCountry }
}

// Geçmiş (kalıcı, budanmayan) aylar + mevcut ayın ham veriden anlık ortalaması
// (isCurrent: true — henüz tamamlanmamış, "sabit" bir rakam değil) birleştirilerek dönülür.
export function getMonthlyPeriods(iso2) {
  const rolled = selectMonthlyForCountryStmt.all(iso2).map((r) => ({
    period: periodKey(r.year, r.month),
    avgScore: round1(r.avg_score),
    sampleCount: r.sample_count,
    isCurrent: false,
  }))

  const { year, month, byCountry } = currentMonthAverages(iso2)
  const current = byCountry.get(iso2)
  if (current) {
    rolled.push({
      period: periodKey(year, month),
      avgScore: round1(current.sum / current.count),
      sampleCount: current.count,
      isCurrent: true,
    })
  }

  return rolled
}

// Aylık satırları yıla göre gruplar. monthsCovered < 12 olan yıllar isPartial: true döner —
// veri Temmuz 2026'da başladığı için ilk yıl (ve muhtemelen birkaç yıl) kısmi kalacak; bunu
// gizlemek yerine dürüstçe etiketliyoruz (bkz. impact.js'teki hasEnoughHistoryForTrends deseni).
export function getYearlyPeriods(iso2) {
  const monthly = getMonthlyPeriods(iso2)
  const byYear = new Map()
  for (const m of monthly) {
    const year = Number(m.period.slice(0, 4))
    if (!byYear.has(year)) byYear.set(year, { year, scores: [], monthsCovered: 0 })
    const y = byYear.get(year)
    y.scores.push(m.avgScore)
    y.monthsCovered += 1
  }
  return Array.from(byYear.values())
    .sort((a, b) => a.year - b.year)
    .map((y) => ({
      period: String(y.year),
      avgScore: round1(y.scores.reduce((s, v) => s + v, 0) / y.scores.length),
      monthsCovered: y.monthsCovered,
      isPartial: y.monthsCovered < 12,
    }))
}

// Dashboard'daki küresel "zaman içinde görünürlük" grafiği için: her ülkenin o aya ait
// ortalama skorunun toplamı (ülke sayısı arttıkça toplam büyür — bu kasıtlı, gerçek TMDB
// popülerlik toplamını yansıtır; proxy/tahmini ülkeler visibility_history'ye hiç yazılmadığı
// için burada da hiç yer almaz, bkz. server/data-pipeline.js).
export function getGlobalMonthlyPeriods() {
  const byPeriod = new Map()
  for (const r of selectAllMonthlyStmt.all()) {
    const period = periodKey(r.year, r.month)
    if (!byPeriod.has(period)) byPeriod.set(period, { period, totalScore: 0, countryCount: 0, isCurrent: false })
    const p = byPeriod.get(period)
    p.totalScore += r.avg_score
    p.countryCount += 1
  }

  const { year, month, byCountry } = currentMonthAverages()
  if (byCountry.size > 0) {
    let totalScore = 0
    for (const c of byCountry.values()) totalScore += c.sum / c.count
    byPeriod.set(periodKey(year, month), {
      period: periodKey(year, month),
      totalScore,
      countryCount: byCountry.size,
      isCurrent: true,
    })
  }

  return Array.from(byPeriod.values())
    .sort((a, b) => (a.period < b.period ? -1 : 1))
    .map((p) => ({ ...p, totalScore: round1(p.totalScore) }))
}

export function getGlobalYearlyPeriods() {
  const monthly = getGlobalMonthlyPeriods()
  const byYear = new Map()
  for (const m of monthly) {
    const year = Number(m.period.slice(0, 4))
    if (!byYear.has(year)) byYear.set(year, { year, totalScore: 0, monthsCovered: 0 })
    const y = byYear.get(year)
    y.totalScore += m.totalScore
    y.monthsCovered += 1
  }
  return Array.from(byYear.values())
    .sort((a, b) => a.year - b.year)
    .map((y) => ({
      period: String(y.year),
      avgMonthlyScore: round1(y.totalScore / y.monthsCovered),
      monthsCovered: y.monthsCovered,
      isPartial: y.monthsCovered < 12,
    }))
}
