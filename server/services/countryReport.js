import db from '../db.js'
import { getCached, setCached } from '../cache.js'
import { getEnrichedVisibility } from '../data-pipeline.js'
import { getMonthlyPeriods } from '../period-history.js'
import { STREAMABLE_KEYS } from '../tmdb.js'
import { buildCountryConvergence, yetersiz } from './countrySummary.js'
import { calculateCountryCompositeScore } from './countryScoringEngine.js'
import { getPipelineDb } from './pipelineDb.js'
import { readCachedSerpApi, timeSeriesCacheKey } from './serpApiCache.js'
import { findSimilarCountries } from './similarCountries.js'
import { generateFindings } from './reportFindings.js'
import * as notes from '../../src/lib/methodologyNotes.js'

// Ülke raporu — tek veri toplama noktası. Her çağrı TÜM bölümleri hesaplar; profil yalnızca
// hangi bölümlerin döneceğini seçer (selectProfile). Böylece üç profil aynı sayıları gösterir.
// Kurallar: ücretli çağrı yok (cachedOnly), eksik veri gizlenmez (hesaplanamaz + neden), her
// bölümün metodoloji notu vardır, Türkiye hiçbir sıralamaya girmez.

export const SOURCE_COUNTRY = 'TR'
export const REPORT_CACHE_TTL_MS = 60 * 60 * 1000
const PROVIDER_CATEGORIES = ['flatrate', 'free', 'ads', 'rent', 'buy']
const MONTHLY_PERIODS_SHOWN = 12
const SEARCH_TREND_SERIES = 3
const GAP_ITEMS = 10
const HIGHLIGHTED_MAX = 3

export const SECTION_KEYS = [
  'scores',
  'ranking',
  'trend',
  'findings',
  'topSeries',
  'themes',
  'searchTrend',
  'pressTone',
  'highlightedSeries',
  'availability',
  'netflixHistory',
  'gapAnalysis',
  'tourismSignal',
]

export const SECTION_TITLES = {
  scores: 'Görünürlük skoru',
  ranking: 'Ülkeler arası konum',
  trend: 'Trend',
  findings: 'Öne çıkan bulgular',
  topSeries: 'Ülkede en çok ilgi gören diziler',
  themes: 'Tema dağılımı',
  searchTrend: 'Arama ilgisi (son 12 ay)',
  pressTone: 'Basın tonu',
  highlightedSeries: 'Veriye göre öne çıkan diziler',
  availability: 'Yayın varlığı (dizi × platform)',
  netflixHistory: 'Netflix Top 10 geçmişi',
  gapAnalysis: 'Boşluk analizi',
  tourismSignal: 'Turizm / etki sinyali',
}

export const SECTION_NOTES = {
  scores: `${notes.TOTAL_SCORE_NOTE} ${notes.PER_CAPITA_SCORE_NOTE}`,
  ranking: notes.RANKING_NOTE,
  trend: notes.TREND_NOTE,
  findings: notes.FINDINGS_NOTE,
  topSeries: notes.COMPOSITE_SCORE_NOTE,
  themes: notes.VISIBILITY_SCORE_NOTE,
  searchTrend: notes.SEARCH_INTEREST_NOTE,
  pressTone: notes.MEDIA_TONE_NOTE,
  highlightedSeries: notes.HIGHLIGHTED_SERIES_NOTE,
  availability: notes.AVAILABILITY_NOTE,
  netflixHistory: notes.NETFLIX_RANK_NOTE,
  gapAnalysis: `${notes.GAP_ANALYSIS_NOTE} ${notes.SIMILAR_COUNTRY_NOTE}`,
  tourismSignal:
    'Korelasyon nedensellik değildir; DiD tek bir önce/sonra çiftine dayanır, paralel-trend kontrolü yoktur.',
}

export const PROFILES = {
  executive: ['scores', 'ranking', 'trend', 'findings'],
  marketing: ['scores', 'topSeries', 'themes', 'searchTrend', 'pressTone', 'highlightedSeries'],
  producer: ['scores', 'availability', 'netflixHistory', 'gapAnalysis', 'tourismSignal'],
}

export const PROFILE_MIN_ACCESS = { executive: 'viewer', marketing: 'analyst', producer: 'admin' }

export const PROFILE_TITLES = {
  executive: 'Yönetici özeti',
  marketing: 'Pazarlama raporu',
  producer: 'Yapımcı / dağıtımcı raporu',
}

const OK = (data, extra = {}) => ({ status: 'hesaplandi', data, ...extra })

function section(key, body) {
  return { key, title: SECTION_TITLES[key], note: SECTION_NOTES[key], ...body }
}

async function guarded(key, fn) {
  try {
    return section(key, await fn())
  } catch (err) {
    return section(key, yetersiz(`hesaplama hatası: ${err.message}`))
  }
}

const isStreamable = (entry) => STREAMABLE_KEYS.some((k) => Array.isArray(entry?.[k]) && entry[k].length > 0)

// ---- bölümler ---------------------------------------------------------------------------

function buildScores(countryRow) {
  if (!countryRow) {
    return yetersiz('ülke yayın verisi takip listesinde değil (bu ülke için TMDB/JustWatch sağlayıcı kaydı yok)')
  }
  if (countryRow.dataSource === 'proxy') {
    return yetersiz('yalnızca arama hacmi tahmini var; görünürlük skoru hesaplanmıyor')
  }
  return OK({
    score: countryRow.score,
    seriesCount: countryRow.seriesCount,
    scorePerCapita: countryRow.scorePerCapita ?? null,
    perCapitaBasis: countryRow.perCapitaBasis ?? null,
    perCapitaYear: countryRow.perCapitaYear ?? null,
    perCapitaReliable: countryRow.perCapitaReliable === true,
    dominantTheme: countryRow.dominantTheme ?? null,
  })
}

export function buildRanking(iso2, countries) {
  if (iso2 === SOURCE_COUNTRY) return yetersiz('kaynak ülke sıralamaya dahil edilmez')
  const tracked = countries.filter((c) => c.dataSource !== 'proxy' && c.iso2 !== SOURCE_COUNTRY)
  const me = tracked.find((c) => c.iso2 === iso2)
  if (!me) return yetersiz('ülke yayın verisi takip listesinde değil')

  const byTotal = [...tracked].sort((a, b) => b.score - a.score)
  const totalRank = byTotal.findIndex((c) => c.iso2 === iso2) + 1

  const reliable = tracked.filter((c) => c.perCapitaReliable && c.scorePerCapita != null)
  const byPerCapita = [...reliable].sort((a, b) => b.scorePerCapita - a.scorePerCapita)
  const pcIndex = byPerCapita.findIndex((c) => c.iso2 === iso2)

  return OK({
    totalRank,
    totalOf: byTotal.length,
    perCapitaRank: pcIndex >= 0 ? pcIndex + 1 : null,
    perCapitaOf: byPerCapita.length,
    perCapitaExcludedReason:
      pcIndex >= 0 ? null : 'payda 1 milyon internet kullanıcısının altında ya da demografi verisi yok',
  })
}

function buildTrend(countryRow, monthly) {
  if (!countryRow || countryRow.dataSource === 'proxy')
    return yetersiz('görünürlük geçmişi tutulmuyor (yayın verisi yok)')
  const shortTerm = countryRow.trend || { direction: 'yetersiz-veri', changePct: null, windowDays: null }
  const aylik = (monthly || []).slice(-MONTHLY_PERIODS_SHOWN)
  if (shortTerm.direction === 'yetersiz-veri' && aylik.length === 0) {
    return yetersiz('henüz yeterli anlık görüntü yok (en az 24 saatlik geçmiş gerekir)')
  }
  return OK({ shortTerm, monthly: aylik })
}

function buildThemes(countryRow) {
  if (!countryRow || countryRow.dataSource === 'proxy') return yetersiz('yayın verisi yok')
  const entries = Object.entries(countryRow.themeScores || {}).filter(([, v]) => v > 0)
  const total = entries.reduce((s, [, v]) => s + v, 0)
  if (total <= 0) return yetersiz('tema puanı yok')
  const items = entries
    .map(([theme, score]) => ({
      theme,
      score: Math.round(score * 10) / 10,
      sharePct: Math.round((score / total) * 1000) / 10,
    }))
    .sort((a, b) => b.score - a.score)
  return OK({ items, seriesCount: countryRow.seriesCount })
}

function buildTopSeries(composite) {
  if (!composite) return yetersiz('bileşik skor hesaplanamadı')
  if (composite.error) return yetersiz(composite.error)
  if (!composite.entries?.length) return yetersiz('bu ülkede yayında aday dizi yok')
  const sos = composite.shareOfSearchMeta
  let caveat = null
  if (sos?.skipped) {
    caveat =
      'arama payı faktörü önbellekte olmadığı için dışlandı (rapor ücretli sorgu yapmaz); skor kalan faktörlerle hesaplandı'
  } else if (sos?.stale) {
    caveat = 'arama payı süresi dolmuş önbellekten alındı'
  }
  return OK({ entries: composite.entries, generatedAt: composite.generatedAt }, { caveat })
}

function buildHighlightedSeries(topSeries) {
  if (topSeries.status !== 'hesaplandi') return yetersiz(`öne çıkan dizi seçilemedi: ${topSeries.reason}`)
  const criteria = 'bileşik skor sırası + en az kısmi doğrulama (arama payı veya Netflix Top 10)'
  const items = topSeries.data.entries
    .filter((e) => e.compositeScore != null && ['verified', 'partial'].includes(e.dataConfidence?.level))
    .slice(0, HIGHLIGHTED_MAX)
    .map((e) => ({
      tmdbId: e.tmdbId,
      name: e.name,
      compositeScore: e.compositeScore,
      confidence: e.dataConfidence?.label ?? null,
      evidence: e.evidence,
    }))
  if (items.length === 0) {
    return yetersiz('hiçbir dizi en az kısmi doğrulama eşiğini geçmiyor (yalnızca medya/yayın sinyali var)')
  }
  return OK({ items, criteria })
}

function buildSearchTrend(iso2, countryRow, readCache) {
  if (!countryRow?.seriesList?.length) return yetersiz('yayın verisi yok')
  const adaylar = [...countryRow.seriesList].sort((a, b) => b.popularity - a.popularity).slice(0, SEARCH_TREND_SERIES)
  const series = []
  const eksik = []
  for (const s of adaylar) {
    const cached = readCache(timeSeriesCacheKey(s.name, iso2, 'today 12-m'))
    if (cached?.timeline?.length) {
      series.push({ tmdbId: s.id, name: s.name, timeline: cached.timeline, queriedAt: cached.queriedAt })
    } else {
      eksik.push(s.name)
    }
  }
  if (series.length === 0) {
    return yetersiz(
      `bu ülke için arama ilgisi zaman serisi henüz sorgulanmamış (${eksik.join(', ')}); rapor ücretli sorgu yapmaz — Arama İlgisi sekmesinden tetiklenebilir`
    )
  }
  return OK({ series, missing: eksik })
}

function buildPressTone(convergence, raw) {
  const cultural = convergence?.dimensions?.cultural
  if (!cultural)
    return yetersiz(
      convergence?.error ? `kültürel boyut hesaplanamadı: ${convergence.error}` : 'kültürel boyut hesaplanamadı'
    )
  if (cultural.mediaTone?.status !== 'hesaplandi') {
    return yetersiz(cultural.mediaTone?.reason || 'basın taraması yok')
  }
  // scannedSeries yalnızca tmdbId taşır; istemcinin katalog listesine bağımlı kalmaması için ad eklenir.
  const nameById = new Map((raw?.series ?? []).map((s) => [s.id, s.name]))
  const scannedSeries = (cultural.scannedSeries ?? []).map((t) => ({ ...t, name: nameById.get(t.tmdbId) ?? null }))
  return OK({ mediaTone: cultural.mediaTone, scannedSeries, scanCount: cultural.scanCount })
}

function buildAvailability(iso2, raw) {
  const rows = []
  const platformCounts = new Map()
  for (const s of raw.series) {
    const entry = raw.providersById[s.id]?.[iso2]
    if (!entry) continue
    const platforms = {}
    let any = false
    for (const cat of PROVIDER_CATEGORIES) {
      const list = Array.isArray(entry[cat]) ? entry[cat] : []
      if (list.length === 0) continue
      any = true
      platforms[cat] = list.map((p) => p.provider_name || String(p.provider_id))
      for (const p of list) {
        const ad = p.provider_name || String(p.provider_id)
        platformCounts.set(ad, (platformCounts.get(ad) || 0) + 1)
      }
    }
    if (any)
      rows.push({ tmdbId: s.id, name: s.name, popularity: s.popularity, streamable: isStreamable(entry), platforms })
  }
  if (rows.length === 0) return yetersiz('bu ülke için hiçbir dizide sağlayıcı kaydı yok')
  rows.sort((a, b) => b.popularity - a.popularity)
  const platformSummary = [...platformCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
  return OK({ rows, platformSummary, streamableCount: rows.filter((r) => r.streamable).length })
}

const netflixSyncErrorStmt = db.prepare("SELECT value FROM meta WHERE key = 'lastNetflixSyncError'")

function netflixRowsFor(conn, iso2) {
  // first_week_date sonradan eklenen sütun (pipeline db._migrate); eski pipeline.db'de olmayabilir.
  const cols = new Set(
    conn
      .prepare('PRAGMA table_info(netflix_country_rankings)')
      .all()
      .map((c) => c.name)
  )
  const firstWeekExpr = cols.has('first_week_date') ? 'first_week_date' : 'NULL AS first_week_date'
  return conn
    .prepare(
      `SELECT tmdb_id, show_title, matched_title, weeks_in_top10, peak_rank, rank_score, last_week_date, ${firstWeekExpr} FROM netflix_country_rankings WHERE country_iso2 = ? ORDER BY rank_score DESC`
    )
    .all(iso2)
}

/** Kaynak dosyanın kendi son haftası: pipeline_meta (Python yazar) → yoksa tablodaki en geç kayıt. */
function netflixSourceCoverage(conn) {
  let firstWeek = null
  let lastWeek = null
  let complete = null
  let source = 'tablo'
  try {
    const rows = conn
      .prepare(
        "SELECT key, value FROM pipeline_meta WHERE key IN ('netflix_source_first_week','netflix_source_last_week','netflix_source_complete')"
      )
      .all()
    const meta = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    if (meta.netflix_source_last_week) {
      firstWeek = meta.netflix_source_first_week ?? null
      lastWeek = meta.netflix_source_last_week
      complete = meta.netflix_source_complete == null ? null : meta.netflix_source_complete === '1'
      source = 'pipeline_meta'
    }
  } catch {
    /* pipeline_meta tablosu yok (eski hat) — tabloya düş */
  }
  if (!lastWeek) {
    try {
      const r = conn.prepare('SELECT MIN(last_week_date) f, MAX(last_week_date) l FROM netflix_country_rankings').get()
      firstWeek = r?.f ?? null
      lastWeek = r?.l ?? null
    } catch {
      /* tablo yok */
    }
  }
  return { firstWeek, lastWeek, complete, source }
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const STALE_AFTER_WEEKS = 8

/** Ülkenin son kaydı ile kaynak dosyanın son haftası arasındaki fark; 8+ hafta ise not üretir. */
export function netflixStaleness(countryLastWeek, sourceLastWeek) {
  if (!countryLastWeek || !sourceLastWeek) return { weeksBehind: null, note: null }
  const fark = Date.parse(sourceLastWeek) - Date.parse(countryLastWeek)
  if (!Number.isFinite(fark) || fark < 0) return { weeksBehind: null, note: null }
  const weeksBehind = Math.round(fark / WEEK_MS)
  if (weeksBehind < STALE_AFTER_WEEKS) return { weeksBehind, note: null }
  const ay = Math.max(1, Math.round(weeksBehind / 4.345))
  return {
    weeksBehind,
    note: `Son ${ay} ayda Top 10 kaydı yok: ülkenin son kaydı ${countryLastWeek}, kaynak dosya ${sourceLastWeek} haftasına kadar veri içeriyor.`,
  }
}

function buildNetflixHistory(iso2, raw, pipelineConn, readSyncError) {
  if (!pipelineConn) return yetersiz('pipeline.db açılamadı — Netflix hattı henüz çalışmamış olabilir')
  let rows
  try {
    rows = netflixRowsFor(pipelineConn, iso2)
  } catch {
    return yetersiz('netflix_country_rankings tablosu yok (netflix_pipeline.py --all çalıştırılmalı)')
  }
  if (rows.length === 0) {
    let sebep = `${iso2} için Netflix Top 10 kaydı yok`
    let toplam = 0
    try {
      toplam = pipelineConn.prepare('SELECT COUNT(*) n FROM netflix_country_rankings').get().n
    } catch {
      /* tablo yok — yukarıda yakalandı */
    }
    if (toplam > 0) {
      sebep +=
        ' — kaynak dosya kısmen indirildiği için bu ülke kapsam dışında kalmış olabilir (alfabetik olarak geç gelen ülkeler eksik)'
    }
    const sonHata = readSyncError()
    if (sonHata) sebep += `; son senkron hatası: ${sonHata}`
    return yetersiz(sebep)
  }
  const nameById = new Map(raw.series.map((s) => [s.id, s.name]))
  const haftalar = rows
    .map((r) => r.last_week_date)
    .filter(Boolean)
    .sort()
  const ilkHaftalar = rows
    .map((r) => r.first_week_date || r.last_week_date)
    .filter(Boolean)
    .sort()
  const lastWeek = haftalar.at(-1) ?? null
  const sourceCoverage = netflixSourceCoverage(pipelineConn)
  const staleness = netflixStaleness(lastWeek, sourceCoverage.lastWeek)
  return OK(
    {
      rows: rows.map((r) => ({
        tmdbId: r.tmdb_id,
        name: nameById.get(r.tmdb_id) || r.matched_title || r.show_title,
        netflixTitle: r.show_title,
        weeksInTop10: r.weeks_in_top10,
        peakRank: r.peak_rank,
        rankScore: r.rank_score,
        firstWeek: r.first_week_date ?? null,
        lastWeek: r.last_week_date,
      })),
      // Ülkenin Türk dizisi kayıtlarının kapsadığı dönem (ilk giriş – son görünme)
      coverage: { firstWeek: ilkHaftalar[0] ?? null, lastWeek },
      // Kaynak dosyanın kendi kapsamı — ülkeden bağımsız
      sourceCoverage,
      weeksBehindSource: staleness.weeksBehind,
      lastWeek,
    },
    { caveat: staleness.note }
  )
}

async function buildGapAnalysis(iso2, raw, countries, pipelineConn, similarFn, similarOpts) {
  const similar = await similarFn(iso2, countries, similarOpts)
  if (similar.candidates.length === 0) return yetersiz(`benzer ülke bulunamadı (${similar.note})`)

  const netflixBest = new Map()
  if (pipelineConn) {
    for (const c of similar.candidates) {
      try {
        for (const r of netflixRowsFor(pipelineConn, c.iso2)) {
          const cur = netflixBest.get(r.tmdb_id)
          if (!cur || r.rank_score > cur.rankScore) {
            netflixBest.set(r.tmdb_id, { iso2: c.iso2, rankScore: r.rank_score, peakRank: r.peak_rank })
          }
        }
      } catch {
        /* tablo yok — Netflix bonusu olmadan devam */
      }
    }
  }

  const items = []
  for (const s of raw.series) {
    if (isStreamable(raw.providersById[s.id]?.[iso2])) continue
    const availableIn = similar.candidates
      .filter((c) => isStreamable(raw.providersById[s.id]?.[c.iso2]))
      .map((c) => c.iso2)
    if (availableIn.length === 0) continue
    const nb = netflixBest.get(s.id) || null
    items.push({
      tmdbId: s.id,
      name: s.name,
      popularity: s.popularity,
      availableIn,
      netflixBest: nb,
      gapScore:
        Math.round((availableIn.length * 10 + (nb ? nb.rankScore / 10 : 0) + Math.min(10, s.popularity / 10)) * 10) /
        10,
    })
  }
  if (items.length === 0) return yetersiz('benzer ülkelerde yayında olup bu ülkede olmayan dizi yok')
  items.sort((a, b) => b.gapScore - a.gapScore)
  return OK({
    similarCountries: similar.candidates,
    pool: similar.pool,
    items: items.slice(0, GAP_ITEMS),
    totalGaps: items.length,
  })
}

function buildTourismSignal(convergence) {
  const t = convergence?.dimensions?.tourism
  if (!t)
    return yetersiz(
      convergence?.error ? `turizm boyutu hesaplanamadı: ${convergence.error}` : 'turizm boyutu hesaplanamadı'
    )
  const hepsiYok = ['arrivals', 'correlation', 'didEstimate', 'leadingSignal'].every(
    (k) => t[k]?.status !== 'hesaplandi'
  )
  if (hepsiYok) return yetersiz(t.arrivals?.reason || 'turizm verisi yok')
  return OK({
    arrivals: t.arrivals,
    correlation: t.correlation,
    didEstimate: t.didEstimate,
    leadingSignal: t.leadingSignal,
  })
}

// ---- ana giriş ---------------------------------------------------------------------------

/**
 * @param {string} iso2Raw
 * @param {object} [opts]
 * @param {boolean} [opts.useCache=true]  1 saatlik rapor önbelleği (aynı saatte iki indirme aynı PDF)
 * @param {object}  [opts.deps]           test enjeksiyonu: getEnrichedVisibility, buildCountryConvergence,
 *   calculateCountryCompositeScore, pipelineDb (null = yok), getMonthlyPeriods, readCachedSerpApi,
 *   findSimilarCountries, similarOpts, readNetflixSyncError, cache {get,set}, now
 */
export async function buildCountryReport(iso2Raw, { useCache = true, deps = {} } = {}) {
  const iso2 = String(iso2Raw).toUpperCase()
  const cacheKey = `report:country:${iso2}`
  const cache = deps.cache || { get: getCached, set: setCached }
  if (useCache) {
    const cached = cache.get(cacheKey)
    if (cached) return cached
  }

  const visibility = deps.getEnrichedVisibility || getEnrichedVisibility
  const convergenceFn = deps.buildCountryConvergence || buildCountryConvergence
  const compositeFn = deps.calculateCountryCompositeScore || calculateCountryCompositeScore
  const pipelineConn = deps.pipelineDb !== undefined ? deps.pipelineDb : getPipelineDb()
  const monthlyFn = deps.getMonthlyPeriods || getMonthlyPeriods
  const readCache = deps.readCachedSerpApi || readCachedSerpApi
  const similarFn = deps.findSimilarCountries || findSimilarCountries
  const readSyncError = deps.readNetflixSyncError || (() => netflixSyncErrorStmt.get()?.value || null)
  const now = deps.now ? deps.now() : new Date()

  const { data, raw } = await visibility()
  const countries = data.countries
  const countryRow = countries.find((c) => c.iso2 === iso2) || null
  const tracked = Boolean(countryRow) && countryRow.dataSource !== 'proxy'

  const [convergence, composite] = await Promise.all([
    Promise.resolve()
      .then(() => convergenceFn(iso2, countries))
      .catch((err) => ({ error: err.message })),
    tracked
      ? Promise.resolve()
          .then(() => compositeFn(iso2, { cachedOnly: true }))
          .catch((err) => ({ error: err.message }))
      : Promise.resolve({ error: 'ülke yayın verisi yok' }),
  ])

  const scores = section('scores', buildScores(countryRow))
  const ranking = section('ranking', buildRanking(iso2, countries))
  const trend = await guarded('trend', () => buildTrend(countryRow, tracked ? monthlyFn(iso2) : []))
  const themes = section('themes', buildThemes(countryRow))
  const topSeries = section('topSeries', buildTopSeries(composite))
  const highlightedSeries = section('highlightedSeries', buildHighlightedSeries(topSeries))
  const searchTrend = await guarded('searchTrend', () => buildSearchTrend(iso2, countryRow, readCache))
  const pressTone = section('pressTone', buildPressTone(convergence, raw))
  const availability = await guarded('availability', () => buildAvailability(iso2, raw))
  const netflixHistory = await guarded('netflixHistory', () =>
    buildNetflixHistory(iso2, raw, pipelineConn, readSyncError)
  )
  const gapAnalysis = await guarded('gapAnalysis', () =>
    buildGapAnalysis(iso2, raw, countries, pipelineConn, similarFn, deps.similarOpts)
  )
  const tourismSignal = section('tourismSignal', buildTourismSignal(convergence))

  const findingsResult = generateFindings({ ranking, trend, netflix: netflixHistory, themes, pressTone })
  const findings = section(
    'findings',
    findingsResult.items.length > 0
      ? OK({ items: findingsResult.items, dropped: findingsResult.dropped })
      : yetersiz('bulgu üretilecek yeterli veri yok')
  )

  const sections = {
    scores,
    ranking,
    trend,
    findings,
    topSeries,
    themes,
    searchTrend,
    pressTone,
    highlightedSeries,
    availability,
    netflixHistory,
    gapAnalysis,
    tourismSignal,
  }

  const report = {
    iso2,
    generatedAt: now.toISOString(),
    isTracked: tracked,
    dataCutoffs: {
      visibilityUpdatedAt: data.updatedAt ?? null,
      netflixLastWeek: netflixHistory.status === 'hesaplandi' ? netflixHistory.data.lastWeek : null,
      demographicsYear: countryRow?.perCapitaYear ?? null,
    },
    dataGaps: Object.values(sections)
      .filter((s) => s.status === 'hesaplanamaz')
      .map((s) => ({ section: s.key, title: s.title, reason: s.reason })),
    sections,
    contract: 'ulke-raporu-v1',
  }
  if (useCache) cache.set(cacheKey, report, REPORT_CACHE_TTL_MS)
  return report
}

/** Profil yalnızca bölüm seçer; sayılar değişmez. Bilinmeyen profil → hata. */
export function selectProfile(report, profile) {
  const keys = PROFILES[profile]
  if (!keys) throw new Error(`Bilinmeyen rapor profili: ${profile}`)
  const sections = Object.fromEntries(keys.map((k) => [k, report.sections[k]]))
  return {
    ...report,
    profile,
    profileTitle: PROFILE_TITLES[profile],
    sections,
    sectionOrder: keys,
    dataGaps: report.dataGaps.filter((g) => keys.includes(g.section)),
  }
}
