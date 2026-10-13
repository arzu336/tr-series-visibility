import db from '../db.js'
import { getCached } from '../cache.js'
import { getPipelineDb } from './pipelineDb.js'
import { getSerpApiUsageThisMonth } from './serpApiCache.js'
import { TABII_CACHE_KEY } from './tabiiCatalog.js'

// Yönetim → Otomatik işler (2026-10-09). Zamanlanmış her işin son başarılı çalışması, son hatası ve topladığı veri
// tek tabloda. Durum: 'tamam' | 'gecikti' (beklenen sıklığın iki katı geçti) | 'hata' (son deneme hatayla bitti) |
// 'hiç çalışmadı'. Meta değerleri üç biçimde tutuluyor: zaman damgası (ms), gün (YYYY-MM-DD) ya da ay (YYYY-MM).

const H = 60 * 60 * 1000
const D = 24 * H

export const JOBS = [
  { key: 'refresh', name: 'Günlük veri tazeleme', every: 'günlük', intervalMs: D, success: 'lastScheduledRefreshAt' },
  {
    key: 'netflix',
    name: 'Netflix Top 10',
    every: 'haftalık',
    intervalMs: 8 * D,
    success: 'lastNetflixSyncAt',
    attempt: 'lastNetflixSyncAttemptAt',
    error: 'lastNetflixSyncError',
  },
  {
    key: 'reytingtv',
    name: 'Türkiye TV reytingleri',
    every: 'günlük',
    intervalMs: D,
    success: 'lastReytingtvSyncAt',
    attempt: 'lastReytingtvSyncAttemptAt',
    error: 'lastReytingtvSyncError',
  },
  {
    key: 'imdb',
    name: 'Dizi puan ve oyları',
    every: 'günlük',
    intervalMs: D,
    success: 'lastImdbSyncAt',
    attempt: 'lastImdbSyncAttemptAt',
    error: 'lastImdbSyncError',
  },
  {
    key: 'flixpatrol',
    name: 'Platform listeleri',
    every: 'haftalık',
    intervalMs: 7 * D,
    success: 'lastFlixpatrolSyncAt',
    attempt: 'lastFlixpatrolSyncAttemptAt',
    error: 'lastFlixpatrolSyncError',
  },
  {
    key: 'flixpatrolTitles',
    name: 'Platform dizi sayfaları',
    every: 'günlük',
    intervalMs: D,
    success: 'lastFlixpatrolTitlesAt',
    attempt: 'lastFlixpatrolTitlesAttemptAt',
    error: 'lastFlixpatrolTitlesError',
  },
  { key: 'tabii', name: 'tabii kataloğu ve ülkeleri', every: 'haftalık', intervalMs: 7 * D, success: 'tabiiCatalogAt' },
  {
    key: 'elcinema',
    name: 'Arap kanalları yayın akışı',
    every: 'günlük',
    intervalMs: D,
    success: 'elcinemaLastDate',
  },
  { key: 'mitv', name: 'Latin Amerika yayın akışı', every: 'günlük', intervalMs: D, success: 'mitvLastDate' },
  { key: 'dstv', name: 'Afrika yayın akışı', every: 'günlük', intervalMs: D, success: 'tvGuideLastDate' },
  { key: 'epgpw', name: 'Rusya ve Orta Asya yayın akışı', every: 'günlük', intervalMs: D, success: 'epgpwLastDate' },
  { key: 'news', name: 'Basın taraması', every: 'haftalık', intervalMs: 7 * D, success: 'lastAutoNewsScanAt' },
  {
    key: 'nightly',
    name: 'Gece ön doldurma (basın, bölgesel ilgi)',
    every: 'günlük',
    intervalMs: D,
    success: 'lastNightlyPrefillDay',
  },
  { key: 'searchFill', name: 'Aylık arama verisi', every: 'aylık', intervalMs: 31 * D, success: 'searchFillMonth' },
  {
    key: 'wiki',
    name: 'Okunma verisi',
    every: 'aylık',
    intervalMs: 31 * D,
    success: 'lastWikiMonthlyRefresh',
  },
  { key: 'tourism', name: 'Turist istatistikleri', every: 'haftalık', intervalMs: 7 * D, success: 'lastTourismSyncAt' },
  { key: 'social', name: 'Sosyal medya taraması', every: 'haftalık', intervalMs: 7 * D, success: 'lastSocialEnrichAt' },
  {
    key: 'students',
    name: 'Yabancı öğrenci sayıları',
    every: 'aylık',
    intervalMs: 30 * D,
    success: 'lastForeignStudentsSyncAt',
  },
]

const metaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const meta = (k) => (k ? (metaStmt.get(k)?.value ?? null) : null)

/** Meta değeri → ms (zaman damgası, gün ya da ay; ay ise ayın ilk günü). */
export function toMs(value) {
  if (value == null || value === '') return null
  const s = String(value)
  if (/^\d{11,}$/.test(s)) return Number(s)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T00:00:00Z`)
  if (/^\d{4}-\d{2}$/.test(s)) return Date.parse(`${s}-01T00:00:00Z`)
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

/** Saf: işin durumu. */
export function jobState({ lastSuccess, lastAttempt, lastError, intervalMs }, now = Date.now()) {
  if (lastError && (!lastSuccess || (lastAttempt && lastAttempt >= lastSuccess))) return 'hata'
  if (!lastSuccess) return 'hiç çalışmadı'
  return now - lastSuccess > 2 * intervalMs ? 'gecikti' : 'tamam'
}

function count(conn, sql, ...params) {
  try {
    return conn?.prepare(sql).get(...params) ?? null
  } catch {
    return null
  }
}

const fmt = (n) => new Intl.NumberFormat('tr-TR').format(n ?? 0)

/** İşin topladığı veriden kısa özet (yönetici "gerçekten veri geliyor mu" görsün). */
function dataSummary(key, now) {
  const p = getPipelineDb()
  const weekAgo = new Date(now - 7 * D).toISOString().slice(0, 10)
  switch (key) {
    case 'netflix': {
      const r = count(
        p,
        "SELECT MAX(period_date) d, COUNT(DISTINCT country_iso2) c FROM chart_entries WHERE provider = 'netflix_tudum'"
      )
      return r?.d ? `son hafta ${r.d}, ${r.c} ülke` : null
    }
    case 'reytingtv': {
      const r = count(p, "SELECT MAX(period_date) d FROM chart_entries WHERE provider = 'reytingtv'")
      return r?.d ? `son gün ${r.d}` : null
    }
    case 'flixpatrol': {
      const r = count(
        p,
        "SELECT COUNT(*) n, COUNT(DISTINCT platform) pl, COUNT(DISTINCT series_id) s FROM chart_entries WHERE provider = 'flixpatrol' AND period_date >= ?",
        weekAgo
      )
      return r ? `son 7 gün: ${fmt(r.n)} sıra, ${r.pl} platform, ${r.s} dizi` : null
    }
    case 'flixpatrolTitles': {
      const r = count(p, "SELECT SUM(status = 'ok') ok, SUM(status = 'yok') yok FROM flixpatrol_title_map")
      return r ? `${fmt(r.ok)} dizi sayfası bulundu, ${fmt(r.yok)} dizi bulunamadı` : null
    }
    case 'tabii': {
      const c = getCached(TABII_CACHE_KEY)
      return c
        ? `${fmt(c.contents)} içerik, ${c.countries.length} ülke, katalogdan ${Object.keys(c.matched).length} dizi`
        : null
    }
    case 'elcinema':
    case 'mitv':
    case 'epgpw':
    case 'dstv': {
      const r = count(
        db,
        'SELECT COUNT(*) n, COUNT(DISTINCT series_id) s, COUNT(DISTINCT channel) ch FROM tv_airings WHERE provider = ? AND date >= ?',
        key,
        weekAgo
      )
      const extra =
        key === 'elcinema'
          ? count(db, "SELECT COUNT(*) n FROM elcinema_works WHERE country = 'TR' AND series_id IS NULL")?.n
          : null
      return r
        ? `son 7 gün: ${fmt(r.n)} yayın günü, ${r.s} dizi, ${r.ch} kanal${extra ? ` · eşleşmeyen Türk eseri ${extra}` : ''}`
        : null
    }
    case 'news': {
      const r = count(
        db,
        'SELECT COUNT(*) n, SUM(total_news_count > 0) h, SUM(total_news_count > 0 AND positive_score IS NULL) t FROM media_sentiment WHERE expires_at > ?',
        now
      )
      return r ? `geçerli ${fmt(r.n)} tarama, ${fmt(r.h)} haberli${r.t ? `, tonu bekleyen ${r.t}` : ''}` : null
    }
    case 'nightly': {
      const r = count(
        db,
        "SELECT SUM(key LIKE 'prefillQueue:press:%') b, SUM(key LIKE 'prefillQueue:regional:%') g FROM meta WHERE key LIKE 'prefillQueue:%'"
      )
      return r ? `sırada ${r.b ?? 0} dizi (basın), ${r.g ?? 0} ülke (bölgesel)` : null
    }
    default:
      return null
  }
}

// Hata metinleri yönetici panelinde gösterilir: dış servis adları ve adresleri maskelenir (kullanıcı isteği,
// 2026-10-13: verinin nereden geldiği hiçbir ekranda görünmesin).
const SOURCE_NAMES_RE =
  /https?:\/\/\S+|\b(?:FlixPatrol|elcinema|mi\.tv|DStv|GDELT|SerpA[Pp][Ii]|Google(?: Trends| News)?|Wikipedia|Vikipedi|Wikimedia|IMDb|TMDB|JustWatch|reytingtv|tvprofil|yigm|ktb\.gov\.tr)\b/gi

export function maskSources(text) {
  return text == null ? text : String(text).replace(SOURCE_NAMES_RE, 'dış servis')
}

export function getJobsStatus({ now = Date.now() } = {}) {
  const jobs = JOBS.map((j) => {
    const lastSuccess = toMs(meta(j.success))
    const lastAttempt = toMs(meta(j.attempt))
    const lastError = maskSources(meta(j.error)) || null
    return {
      key: j.key,
      name: j.name,
      every: j.every,
      lastSuccess,
      lastAttempt,
      lastError,
      state: jobState({ lastSuccess, lastAttempt, lastError, intervalMs: j.intervalMs }, now),
      data: dataSummary(j.key, now),
    }
  })
  const u = getSerpApiUsageThisMonth()
  return {
    jobs,
    serpapi: { used: u.used, budget: u.budget, source: u.source },
    generatedAt: new Date(now).toISOString(),
  }
}
