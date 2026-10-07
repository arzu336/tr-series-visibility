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
import { getWatchSignals } from './watchSignal.js'
import { getCountryCharts, getAllOwnRankings } from './charts.js'
import { getImdbDataForTmdbSeries } from '../imdb.js'
import { languagesOfCountry } from '../../src/lib/langCountries.js'
import { getForeignStudentSummary } from './foreignStudents.js'
import { generateFindings } from './reportFindings.js'
import * as notes from '../../src/lib/methodologyNotes.js'
import { EMPTY } from '../../src/lib/emptyStates.js'

// Ülke raporu — tek veri toplama noktası ve TEK ORTAK RAPOR (kullanıcı kararı 2026-10-05: profil yok,
// herkes aynı raporu görür). Rapor veri kaynaklarının ya da tek tek platformların adını taşımaz; listeler
// platformun kendi sıralamasıyla verilir (charts.js buildOwnRanking).
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
  'platformLists',
  'wikiInterest',
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
  'foreignStudents',
]

export const SECTION_TITLES = {
  scores: 'İzlenme düzeyi ve yayın varlığı',
  platformLists: 'Türk dizileri sıralaması',
  wikiInterest: 'Okunma ilgisi',
  ranking: 'Ülkeler arası izlenme sırası',
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
  foreignStudents: "Türkiye'de okuyan öğrenciler",
}

export const SECTION_NOTES = {
  scores: `${notes.WATCH_LEVEL_NOTE} ${notes.AVAILABILITY_NOTE}`,
  platformLists: notes.PLATFORM_LISTS_NOTE,
  wikiInterest:
    'Türk dizilerine ait ansiklopedi maddelerinin ülkenin dillerindeki aylık okunma sayısıdır. Birden çok ülkede ' +
    'konuşulan dillerde okunma tek bir ülkeye ayrılamaz.',
  ranking: notes.RANKING_NOTE,
  trend: notes.TREND_NOTE,
  findings: notes.FINDINGS_NOTE,
  topSeries: notes.COMPOSITE_SCORE_NOTE,
  themes: notes.THEME_SHARE_NOTE,
  searchTrend: notes.SEARCH_INTEREST_NOTE,
  pressTone: notes.MEDIA_TONE_NOTE,
  highlightedSeries: notes.HIGHLIGHTED_SERIES_NOTE,
  availability: notes.AVAILABILITY_NOTE,
  netflixHistory: notes.NETFLIX_RANK_NOTE,
  gapAnalysis: `${notes.GAP_ANALYSIS_NOTE} ${notes.SIMILAR_COUNTRY_NOTE}`,
  foreignStudents:
    'Bu ülkeden Türkiye’de yükseköğretim gören uluslararası öğrenci sayısı (yıllık, resmî istatistik). ' +
    'Dizilerin etkisini tek başına ölçmez; Türkiye’ye ilginin bir göstergesidir.',
  tourismSignal:
    'Korelasyon nedensellik değildir; DiD tek bir önce/sonra çiftine dayanır, paralel-trend kontrolü yoktur.',
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

/**
 * İzlenme düzeyi (watchSignal: Netflix Top 10 + Wikipedia + arama) ve yayın varlığının sayılabilir gerçekleri.
 * Skor/puan yok: düzey, yüzdelik konum, Netflix hafta sayıları ve "N dizi yayında, M platformda".
 */
function buildScores(countryRow, raw, iso2, signal) {
  if (!countryRow) {
    return yetersiz('ülke yayın verisi takip listesinde değil (bu ülke için TMDB/JustWatch sağlayıcı kaydı yok)')
  }
  if (countryRow.dataSource === 'proxy' && !signal?.level) {
    return yetersiz('yalnızca arama hacmi tahmini var; yayın sağlayıcı verisi ve izlenme düzeyi yok')
  }
  const platforms = new Set()
  if (raw && countryRow.dataSource !== 'proxy') {
    for (const s of raw.series) {
      const e = raw.providersById[s.id]?.[iso2]
      if (!e) continue
      for (const k of PROVIDER_CATEGORIES)
        for (const p of e[k] || []) platforms.add(p.provider_name || String(p.provider_id))
    }
  }
  const nf = signal?.components?.lists
  return OK(
    {
      level: signal?.level ?? null,
      index: signal?.index ?? null,
      confidence: signal?.confidence ?? null,
      lists: nf?.present ? { series: nf.series, weeks: nf.weeks, bestRank: nf.bestRank } : null,
      listsReason: nf && !nf.present ? nf.reason : null,
      access:
        countryRow.dataSource === 'proxy'
          ? null
          : { seriesCount: countryRow.seriesCount, platformCount: platforms.size },
      dominantTheme: countryRow.dominantTheme ?? null,
      warnings: signal?.warnings ?? [],
    },
    { caveat: signal ? null : 'izlenme düzeyi hesaplanamadı (sinyal servisi yok)' }
  )
}

export function buildRanking(iso2, countries, signals) {
  if (iso2 === SOURCE_COUNTRY) return yetersiz('kaynak ülke sıralamaya dahil edilmez')
  const byIso2 = signals?.byIso2 || {}
  const indexed = Object.entries(byIso2).filter(([, s]) => s.index != null)
  const me = byIso2[iso2]
  if (!me || me.index == null) {
    return yetersiz(
      me?.componentCount === 1
        ? 'izlenme düzeyi için tek kaynak var (en az 2 gerekir)'
        : 'izlenme düzeyi hesaplanamadı (sinyal yok)'
    )
  }
  const rank = 1 + indexed.filter(([, s]) => s.index > me.index).length
  return OK({ rank, of: indexed.length, index: me.index, level: me.level, confidence: me.confidence })
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

/** IMDb puanı ve son 7 günlük oy artışı (küresel; skora girmez, bağlam olarak gösterilir). */
async function attachImdb(composite, imdbFn, conn) {
  if (!composite?.entries?.length) return composite
  const entries = await Promise.all(
    composite.entries.map(async (e) => {
      const r = await Promise.resolve()
        .then(() => imdbFn(e.tmdbId, conn !== undefined ? { conn } : undefined))
        .catch(() => null)
      if (r?.status !== 'ready') return { ...e, imdb: null }
      return { ...e, imdb: { rating: r.rating, votes: r.votes, growth7: r.votesGrowth?.d7 ?? null } }
    })
  )
  return { ...composite, entries }
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
  const criteria = 'bileşik skor sırası + en az kısmi doğrulama (arama payı veya platform Top 10 listeleri)'
  const items = topSeries.data.entries
    .filter((e) => e.compositeScore != null && ['verified', 'partial'].includes(e.dataConfidence?.level))
    .slice(0, HIGHLIGHTED_MAX)
    .map((e) => ({
      tmdbId: e.tmdbId,
      name: e.name,
      compositeScore: e.compositeScore,
      confidence: e.dataConfidence?.label ?? null,
      evidence: e.evidence,
      imdb: e.imdb ?? null,
    }))
  if (items.length === 0) {
    return yetersiz('hiçbir dizi en az kısmi doğrulama eşiğini geçmiyor (yalnızca medya/yayın sinyali var)')
  }
  return OK({ items, criteria })
}

/** Brifingin arama ilgisi bölümündeki diziler: ülkede yayında olan en popüler 3 dizi (doldurma işi de bunu kullanır). */
export function searchTrendCandidates(countryRow) {
  return [...(countryRow?.seriesList || [])].sort((a, b) => b.popularity - a.popularity).slice(0, SEARCH_TREND_SERIES)
}

function buildSearchTrend(iso2, countryRow, readCache) {
  if (!countryRow?.seriesList?.length) return yetersiz('yayın verisi yok')
  const adaylar = searchTrendCandidates(countryRow)
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
  return OK({ iso2, series, missing: eksik })
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

function parseIsoList(value) {
  if (!value) return null
  try {
    const list = JSON.parse(value)
    return Array.isArray(list) ? new Set(list.map((x) => String(x).toUpperCase())) : null
  } catch {
    return null
  }
}

/**
 * Kaynak dosyanın kendi kapsamı: pipeline_meta (Python yazar) → yoksa tablodaki en geç kayıt.
 * sourceCountries: bu koşuda bloğu TAM okunan ülkeler (kısmi dosyada alfabetik olarak kesime kadar).
 * marketCountries: Netflix'in Top 10 yayımladığı ülkeler — yalnızca TAM dosyadan türetilir, elle liste yok;
 * tam dosya hiç işlenmemişse null (bilinmiyor).
 */
function netflixSourceCoverage(conn) {
  let firstWeek = null
  let lastWeek = null
  let complete = null
  let source = 'tablo'
  let sourceCountries = null
  let marketCountries = null
  let truncated = null
  try {
    const rows = conn
      .prepare(
        "SELECT key, value FROM pipeline_meta WHERE key IN ('netflix_source_first_week','netflix_source_last_week','netflix_source_complete','netflix_source_countries','netflix_market_countries','netflix_truncated_country')"
      )
      .all()
    const meta = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    if (meta.netflix_source_last_week) {
      firstWeek = meta.netflix_source_first_week ?? null
      lastWeek = meta.netflix_source_last_week
      complete = meta.netflix_source_complete == null ? null : meta.netflix_source_complete === '1'
      source = 'pipeline_meta'
    }
    sourceCountries = parseIsoList(meta.netflix_source_countries)
    marketCountries = parseIsoList(meta.netflix_market_countries)
    truncated = meta.netflix_truncated_country || null
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
  return { firstWeek, lastWeek, complete, source, sourceCountries, marketCountries, truncated }
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

/**
 * Kayıt yokken üç durum ayrılır (hepsi kaynak dosyadan türetilir):
 *   a) ülke bloğu tam okunmuş, Türk dizisi hiç girmemiş → hesaplandi, 0 kayıt + kapsanan dönem
 *   b) tam dosyada Netflix'in yayımladığı ülkeler arasında değil → hesaplanamaz, "yayımlamıyor"
 *   c) dosya kısmi ve ülke indirilen kısımda yok → hesaplanamaz, "kısmi indirme" (yalnızca bu durumda)
 */
function netflixKayitYok(iso2, kapsam, readSyncError) {
  const { sourceCountries, marketCountries, complete, truncated, firstWeek, lastWeek } = kapsam
  if (sourceCountries?.has(iso2)) {
    return OK({
      rows: [],
      zeroRecords: true,
      message: EMPTY.netflixZeroRecords(firstWeek ?? '?', lastWeek ?? '?'),
      coverage: null,
      sourceCoverage: { firstWeek, lastWeek, complete, source: kapsam.source },
      weeksBehindSource: null,
      lastWeek: null,
    })
  }
  if (marketCountries && !marketCountries.has(iso2)) return yetersiz(EMPTY.netflixNotPublished)
  if (complete === true && sourceCountries && !sourceCountries.has(iso2)) return yetersiz(EMPTY.netflixNotPublished)
  let sebep =
    complete === false || sourceCountries
      ? EMPTY.netflixPartialDownload(iso2, truncated)
      : EMPTY.netflixNoRecordUnknown(iso2)
  if (!sourceCountries) {
    // Eski hat: ülke listesi yok; tabloda başka ülke varsa kısmi indirme en olası açıklama.
    sebep = EMPTY.netflixPartialDownload(iso2, truncated)
  }
  const sonHata = readSyncError()
  if (sonHata) sebep += `; son senkron hatası: ${sonHata}`
  return yetersiz(sebep)
}

function buildNetflixHistory(iso2, raw, pipelineConn, readSyncError) {
  if (!pipelineConn) return yetersiz(EMPTY.netflixDbMissing)
  let rows
  try {
    rows = netflixRowsFor(pipelineConn, iso2)
  } catch {
    return yetersiz(EMPTY.netflixTableMissing)
  }
  const kapsam = netflixSourceCoverage(pipelineConn)
  const sourceCoverage = {
    firstWeek: kapsam.firstWeek,
    lastWeek: kapsam.lastWeek,
    complete: kapsam.complete,
    source: kapsam.source,
  }
  if (rows.length === 0) return netflixKayitYok(iso2, kapsam, readSyncError)
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

async function buildGapAnalysis(iso2, raw, countries, rankings, similarFn, similarOpts) {
  const similar = await similarFn(iso2, countries, similarOpts)
  if (similar.candidates.length === 0) return yetersiz(EMPTY.gapNoSimilar(similar.note))

  // Benzer ülkelerin birleşik sıralamasında (bütün yayın listeleri, son 52 hafta) dizinin en iyi yeri.
  // Önceden yalnızca Netflix Top 10'dan geliyordu.
  const listBest = new Map()
  for (const c of similar.candidates) {
    for (const r of rankings?.get(c.iso2)?.all || []) {
      const cur = listBest.get(r.seriesId)
      if (!cur || r.bestPosition < cur.position) listBest.set(r.seriesId, { iso2: c.iso2, position: r.bestPosition })
    }
  }

  const items = []
  for (const s of raw.series) {
    if (isStreamable(raw.providersById[s.id]?.[iso2])) continue
    const availableIn = similar.candidates
      .filter((c) => isStreamable(raw.providersById[s.id]?.[c.iso2]))
      .map((c) => c.iso2)
    if (availableIn.length === 0) continue
    const lb = listBest.get(s.id) || null
    items.push({
      tmdbId: s.id,
      name: s.name,
      popularity: s.popularity,
      availableIn,
      listBest: lb,
      gapScore:
        Math.round(
          (availableIn.length * 10 + (lb ? Math.max(0, 11 - lb.position) : 0) + Math.min(10, s.popularity / 10)) * 10
        ) / 10,
    })
  }
  items.sort((a, b) => b.gapScore - a.gapScore)
  // Boşluk bulunmaması veri eksikliği değil, gerçek bir sonuçtur: hesaplandi + açık mesaj.
  return OK({
    similarCountries: similar.candidates,
    pool: similar.pool,
    items: items.slice(0, GAP_ITEMS),
    totalGaps: items.length,
    noGap: items.length === 0,
    message: items.length === 0 ? EMPTY.gapNone : null,
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
/**
 * Platformun kendi haftalık sıralaması (charts.js buildOwnRanking): bu haftanın listesi ve son 52 haftanın en
 * kalıcıları. Platform/kaynak adı taşınmaz. Hiç Türk dizisi girmemesi veri eksikliği değil, gerçek sonuçtur.
 */
export function buildPlatformLists(charts) {
  if (!charts) return yetersiz('liste verisi okunamadı')
  const own = charts.ownRanking
  if (!own) return yetersiz('bu ülke için liste kaydı yok')
  return OK({
    now: own.current.map((it) => ({
      seriesId: it.seriesId ?? null,
      name: it.name,
      position: it.position,
      weeks: it.weeks,
      trend: it.trend ?? null,
    })),
    top: own.top.map((it) => ({
      seriesId: it.seriesId ?? null,
      name: it.name,
      weeks: it.weeks,
      bestPosition: it.bestPosition,
    })),
    seriesCount: own.seriesCount,
    previousCount: own.previousCount ?? null,
    trendBasis: own.trendBasis ?? null,
    trendSince: own.trendSince ?? null,
    window: { from: own.from, to: own.to, weeks: 52 },
  })
}

const WIKI_MONTHS = 12
const WIKI_TOP = 5
const languageName = (lang) => {
  try {
    const n = new Intl.DisplayNames(['tr'], { type: 'language' }).of(lang)
    return n ? n.charAt(0).toLocaleUpperCase('tr') + n.slice(1) : lang
  } catch {
    return lang
  }
}

/**
 * Okunma ilgisi: katalogdaki Türk dizilerinin ülkenin dillerindeki aylık ansiklopedi okunması (son 12 ay),
 * dil başına en çok okunan 5 dizi. Ana gösterge yalnızca o ülkeye özgü (bölgesel olmayan) bir dilden: ortak
 * dillerde (İngilizce, İspanyolca, Arapça…) okunma tek ülkeye ayrılamaz.
 * `rows`: [{ lang, tmdb_id, year, month, views }].
 */
export function buildWikiInterest(langs, allRows, nameOf, { now = new Date() } = {}) {
  if (!langs.length) return yetersiz('ülkenin dilleri eşlenmedi')
  const periodOf = (r) => `${r.year}-${String(r.month).padStart(2, '0')}`
  // İçinde bulunulan ay yarımdır; seriye girmez (toplayıcı da artık yazmıyor — wikipediaBackfill.sonTamAyBitisi).
  const thisMonth = now.toISOString().slice(0, 7)
  let rows = allRows.filter((r) => periodOf(r) < thisMonth)
  if (!rows.length) return yetersiz('ülkenin dillerinde okunma kaydı yok')
  // Kaynak bir ayın verisini ay bittikten sonra da bir süre yarım verebiliyor (Eylül 2026: Ağustos'un ~%3'ü).
  // Son ayın toplamı önceki üç ayın ortalamasının %40'ının altındaysa "henüz tamamlanmamış" sayılır ve
  // seriye girmez — bütün dizilerde aynı anda %60'tan büyük düşüş doğal olarak beklenmez.
  const totals = new Map()
  for (const r of rows) totals.set(periodOf(r), (totals.get(periodOf(r)) || 0) + r.views)
  const sorted = [...totals.keys()].sort()
  let incompleteMonth = null
  if (sorted.length >= 4) {
    const last = sorted.at(-1)
    const prev3 = sorted.slice(-4, -1).map((p) => totals.get(p))
    const avg = prev3.reduce((a, b) => a + b, 0) / prev3.length
    if (avg > 0 && totals.get(last) < 0.4 * avg) {
      incompleteMonth = last
      rows = rows.filter((r) => periodOf(r) !== last)
    }
  }
  const periods = [...new Set(rows.map(periodOf))].sort().slice(-WIKI_MONTHS)
  const languages = []
  for (const { lang, regional } of langs) {
    const own = rows.filter((r) => r.lang === lang && periods.includes(periodOf(r)))
    if (!own.length) continue
    const byMonth = new Map(periods.map((p) => [p, 0]))
    const bySeries = new Map()
    for (const r of own) {
      byMonth.set(periodOf(r), byMonth.get(periodOf(r)) + r.views)
      bySeries.set(r.tmdb_id, (bySeries.get(r.tmdb_id) || 0) + r.views)
    }
    languages.push({
      lang,
      languageName: languageName(lang),
      regional: Boolean(regional),
      months: [...byMonth.entries()].map(([period, views]) => ({ period, views })),
      top: [...bySeries.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, WIKI_TOP)
        .map(([id, views]) => ({ seriesId: id, name: nameOf(id), views })),
    })
  }
  if (!languages.length) return yetersiz('ülkenin dillerinde okunma kaydı yok')
  const main = languages.find((l) => !l.regional) ?? null
  let primary = null
  if (main) {
    const last = main.months.at(-1)
    const prev = main.months.at(-2)
    primary = {
      lang: main.lang,
      languageName: main.languageName,
      period: last.period,
      last: last.views,
      prev: prev?.views ?? null,
      changePct: prev?.views ? Math.round(((last.views - prev.views) / prev.views) * 1000) / 10 : null,
      topName: main.top[0]?.name ?? null,
    }
  }
  return OK({ languages, primary, incompleteMonth })
}

function readWikiRows(langs, seriesIds) {
  if (!langs.length || !seriesIds.size) return []
  const marks = langs.map(() => '?').join(',')
  try {
    return db
      .prepare(
        `SELECT lang, tmdb_id, year, month, views FROM series_language_interest
         WHERE lang IN (${marks}) AND (year * 100 + month) >= (
           SELECT MAX(year * 100 + month) - 100 FROM series_language_interest WHERE lang IN (${marks}))`
      )
      .all(...langs.map((l) => l.lang), ...langs.map((l) => l.lang))
      .filter((r) => seriesIds.has(r.tmdb_id))
  } catch {
    return []
  }
}

export async function buildCountryReport(iso2Raw, { useCache = true, deps = {} } = {}) {
  const iso2 = String(iso2Raw).toUpperCase()
  const cacheKey = `report:country:v3:${iso2}`
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

  const signals = await (deps.getWatchSignals || getWatchSignals)().catch(() => null)
  const [convergence, composite] = await Promise.all([
    Promise.resolve()
      .then(() => convergenceFn(iso2, countries))
      .catch((err) => ({ error: err.message })),
    tracked
      ? Promise.resolve()
          .then(() => compositeFn(iso2, { cachedOnly: true, pipelineConn }))
          .then((c) => attachImdb(c, deps.getImdbData || getImdbDataForTmdbSeries, pipelineConn))
          .catch((err) => ({ error: err.message }))
      : Promise.resolve({ error: 'ülke yayın verisi yok' }),
  ])

  const scores = section('scores', buildScores(countryRow, raw, iso2, signals?.byIso2?.[iso2] ?? null))
  const platformLists = await guarded('platformLists', async () =>
    buildPlatformLists(await (deps.getCountryCharts || getCountryCharts)(iso2))
  )
  const ranking = section('ranking', buildRanking(iso2, countries, signals))
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
  const ownRankings = await (deps.getAllOwnRankings || getAllOwnRankings)().catch(() => null)
  const gapAnalysis = await guarded('gapAnalysis', () =>
    buildGapAnalysis(iso2, raw, countries, ownRankings, similarFn, deps.similarOpts)
  )
  const tourismSignal = section('tourismSignal', buildTourismSignal(convergence))
  const wikiInterest = await guarded('wikiInterest', () => {
    const langs = languagesOfCountry(iso2)
    const names = new Map((raw?.series || []).map((sr) => [sr.id, sr.name]))
    const rows = (deps.readWikiRows || readWikiRows)(langs, new Set(names.keys()))
    return buildWikiInterest(langs, rows, (id) => names.get(id) ?? `#${id}`, { now })
  })

  const findingsResult = generateFindings({ ranking, trend, lists: platformLists, imdb: topSeries, themes, pressTone })
  const findings = section(
    'findings',
    findingsResult.items.length > 0
      ? OK({ items: findingsResult.items, dropped: findingsResult.dropped })
      : yetersiz('bulgu üretilecek yeterli veri yok')
  )

  const foreignStudents = await guarded('foreignStudents', () => {
    const s = (deps.getForeignStudentSummary || getForeignStudentSummary)(iso2)
    return s ? OK(s) : yetersiz('bu ülkeden öğrenci kaydı yok')
  })

  const sections = {
    scores,
    platformLists,
    wikiInterest,
    foreignStudents,
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
      listsLastDate: platformLists.status === 'hesaplandi' ? (platformLists.data.window?.to ?? null) : null,
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
