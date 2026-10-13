import db from '../db.js'
import { fetchTrendsTimeSeriesRaw, getSerpApiUsageThisMonth } from './serpApiCache.js'
import { fetchNewsArticlesGdelt, TURKISH_CONTEXT } from './gdeltNews.js'
import { getSeriesPressCountries } from './newsScanTargets.js'
import { getEnglishTitles, getLocalTitle, asciiVariant } from './localTitles.js'
import { recordPress } from './historyStore.js'

// Yıllık raporlar için geçmişi doldurma (2026-10-13, kullanıcı: "sınırlar içinde alabildiği kadarını al"). Ön doldurma
// işinin içinde, günde bir kez:
//   1) Google arama ilgisi 2010'dan (ya da dizinin yayın yılından) bugüne, dünya geneli — dizi başına TEK sorgu (çok yıllık seri haftalık gelir ve
//      yıllar aynı ölçekte karşılaştırılabilir). Ücretli; günde en fazla TRENDS_PER_DAY, kota %80'de durur.
//   2) Geçmiş basın — GDELT arşivi (2017+), yıl yıl: öne çıkan diziler × öne çıktıkları ülkeler. Ücretsiz ama GDELT
//      yavaş/kısıtlı; süre sınırı içinde ne kadar giderse. Haber sayısı kaydedilir (ton, dil modeline erişilince).

export const TRENDS_FROM = '2010-01-01'
export const TRENDS_PER_DAY = 40
export const ARCHIVE_YEARS = [2021, 2022, 2023, 2024, 2025]
const ARCHIVE_SERIES = 30
const ARCHIVE_COUNTRIES = 3
const ARCHIVE_SOURCE = 'gdelt-arsiv'
const USAGE_STOP_SHARE = 0.8

const hasLongWindow = db.prepare(
  "SELECT 1 FROM trends_windows WHERE query = ? AND geo = 'WW' AND window_start <= ? LIMIT 1"
)
const hasArchive = db.prepare(
  'SELECT 1 FROM press_history WHERE series_id = ? AND country_iso2 = ? AND scanned_on = ? AND source = ?'
)

function overBudget() {
  const u = getSerpApiUsageThisMonth()
  return u.used >= u.budget * USAGE_STOP_SHARE
}

/** Serinin başlaması gereken gün: 2010 ya da (daha yeniyse) dizinin yayın yılının başı. */
export function trendsStart(s) {
  const aired = String(s.firstAirDate || '').slice(0, 4)
  return aired && `${aired}-01-01` > TRENDS_FROM ? `${aired}-01-01` : TRENDS_FROM
}

const monthAfter = (d) => `${d.slice(0, 5)}${String(Number(d.slice(5, 7)) + 1).padStart(2, '0')}-01`

/** Başlangıcından itibaren arama serisi olmayan diziler (öncelik sırasıyla). */
export function trendsBackfillOrder(
  series,
  listedCount,
  hasWindow = (name, start) => Boolean(hasLongWindow.get(name, monthAfter(start)))
) {
  return series
    .filter((s) => !hasWindow(s.name.toLocaleLowerCase('tr'), trendsStart(s)))
    .sort(
      (a, b) => (listedCount.get(b.id) ?? 0) - (listedCount.get(a.id) ?? 0) || (b.popularity ?? 0) - (a.popularity ?? 0)
    )
}

export async function backfillTrends({
  series,
  listedCount,
  deadline,
  now = new Date(),
  fetchFn = fetchTrendsTimeSeriesRaw,
  max = TRENDS_PER_DAY,
}) {
  const today = now.toISOString().slice(0, 10)
  let queries = 0
  for (const s of trendsBackfillOrder(series, listedCount)) {
    if (queries >= max || Date.now() >= deadline || overBudget()) break
    try {
      await fetchFn(s.name, null, `${trendsStart(s)} ${today}`) // seri, fetchTrendsTimeSeriesRaw içinde trends_windows'a yazılır
    } catch (err) {
      console.error(`[historyBackfill] ${s.name} arama serisi alınamadı:`, err.message)
    }
    queries++
  }
  return { queries }
}

/** Geçmiş basın hedefleri: öne çıkan diziler × öne çıktıkları ülkeler × yıllar (kaydı olmayanlar). */
export async function archiveTargets(series, listedCount, countriesFor = getSeriesPressCountries) {
  const top = [...series]
    .sort(
      (a, b) => (listedCount.get(b.id) ?? 0) - (listedCount.get(a.id) ?? 0) || (b.popularity ?? 0) - (a.popularity ?? 0)
    )
    .slice(0, ARCHIVE_SERIES)
  const out = []
  for (const s of top) {
    const countries = (await countriesFor(s.id, { limit: ARCHIVE_COUNTRIES })) || []
    // Yayından önceki yıllar atlanır: genel adlı dizilerde (ör. "Seni Tanıyorum") eşleşen haberler diziyle ilgisiz.
    const firstYear = Number(String(s.firstAirDate || '').slice(0, 4)) || 0
    for (const year of [...ARCHIVE_YEARS].reverse().filter((y) => y >= firstYear))
      for (const iso2 of countries)
        if (!hasArchive.get(s.id, iso2, `${year}-12-31`, ARCHIVE_SOURCE)) out.push({ series: s, iso2, year })
  }
  return out
}

export async function backfillPressArchive({ series, listedCount, deadline, fetchFn = fetchNewsArticlesGdelt }) {
  let done = 0
  let failed = 0
  for (const t of await archiveTargets(series, listedCount)) {
    if (Date.now() >= deadline) break
    const english = getEnglishTitles(t.series.id, t.series.name)
    const local = getLocalTitle(t.series.id, t.iso2, t.series.name)
    const phrases = [...new Set([t.series.name, asciiVariant(t.series.name), ...english, local].filter(Boolean))]
    try {
      const r = await fetchFn(phrases, t.iso2, {
        context: english.length || local ? TURKISH_CONTEXT : null,
        range: { start: `${t.year}-01-01`, end: `${t.year}-12-31` },
      })
      if (r.unsupported) continue
      recordPress(
        {
          series_id: t.series.id,
          country_iso2: t.iso2,
          source: ARCHIVE_SOURCE,
          total_news_count: r.news.length,
          dominant_sentiment: r.news.length ? null : 'yetersiz-veri',
        },
        new Date(`${t.year}-12-31T12:00:00Z`)
      )
      done++
    } catch {
      failed++
      if (failed >= 5) break // GDELT geri çeviriyorsa bugünlük bırak
    }
  }
  return { done, failed }
}
