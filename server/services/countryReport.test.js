import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import {
  buildCountryReport,
  buildRanking,
  buildPlatformLists,
  buildWikiInterest,
  SECTION_KEYS,
  SECTION_NOTES,
  SECTION_TITLES,
  netflixStaleness,
  STALE_AFTER_WEEKS,
} from './countryReport.js'

// Tüm dış bağımlılıklar enjekte; ağ yok, canlı DB yok. pipeline.db için gerçek bir bellek-içi
// SQLite kullanılır (sorgular gerçek şemaya karşı çalışsın).

const prov = (...names) => names.map((n, i) => ({ provider_id: i + 1, provider_name: n }))
const ulke = (iso2, extra = {}) => ({
  iso2,
  dataSource: 'tmdb',
  score: 100,
  seriesCount: 25,
  scorePerCapita: 5,
  perCapitaBasis: 'internet-kullanicisi',
  perCapitaYear: 2024,
  perCapitaReliable: true,
  dominantTheme: 'aile',
  themeScores: { aile: 60, aşk: 40 },
  trend: { direction: 'yükseliyor', changePct: 8, windowDays: 7 },
  seriesList: [
    { id: 1, name: 'Terzi', popularity: 50 },
    { id: 2, name: 'Atiye', popularity: 30 },
  ],
  ...extra,
})

const COUNTRIES = [
  ulke('TR', { score: 1690, scorePerCapita: 30 }),
  ulke('DE', { score: 500, scorePerCapita: 6.4 }),
  ulke('FR', { score: 400, scorePerCapita: 7.1, themeScores: { aile: 55, aşk: 45 } }),
  ulke('SM', { score: 261, scorePerCapita: 9842, perCapitaReliable: false, seriesCount: 5 }),
  { iso2: 'XX', dataSource: 'proxy', searchInterestScore: 40 },
]

const RAW = {
  series: [
    { id: 1, name: 'Terzi', popularity: 50 },
    { id: 2, name: 'Atiye', popularity: 30 },
    { id: 3, name: 'Kulüp', popularity: 20 },
  ],
  providersById: {
    1: { DE: { flatrate: prov('Netflix') }, FR: { flatrate: prov('Netflix') } },
    2: { DE: { rent: prov('Apple TV') }, FR: { flatrate: prov('Netflix'), ads: prov('Pluto') } },
    3: { FR: { free: prov('Arte') } },
  },
}

// withFirstWeek=false: eski pipeline.db şeması (first_week_date sütunu yok) — geriye uyum yolu.
// meta: Python hattının yazdığı pipeline_meta satırları; verilmezse tablo hiç oluşturulmaz.
function pipelineDb({ withTable = true, rows = [], withFirstWeek = false, meta = null } = {}) {
  const db = new DatabaseSync(':memory:')
  if (withTable) {
    const firstCol = withFirstWeek ? ', first_week_date TEXT' : ''
    db.exec(
      `CREATE TABLE netflix_country_rankings (country_iso2 TEXT, tmdb_id INTEGER, show_title TEXT, matched_title TEXT, weeks_in_top10 INTEGER, peak_rank INTEGER, rank_score REAL, last_week_date TEXT, updated_at TEXT${firstCol})`
    )
    const ins = db.prepare(
      `INSERT INTO netflix_country_rankings VALUES (?,?,?,?,?,?,?,?,?${withFirstWeek ? ',?' : ''})`
    )
    for (const r of rows) {
      const vals = [r.iso2, r.tmdbId, r.title, r.title, r.weeks, r.peak, r.score, r.week, '2026-09-23']
      if (withFirstWeek) vals.push(r.firstWeek ?? null)
      ins.run(...vals)
    }
  }
  if (meta) {
    db.exec('CREATE TABLE pipeline_meta (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)')
    const ins = db.prepare('INSERT INTO pipeline_meta VALUES (?,?,?)')
    for (const [k, v] of Object.entries(meta)) ins.run(k, v, '2026-09-30')
  }
  return db
}

const convergenceOk = {
  dimensions: {
    cultural: {
      mediaTone: { status: 'hesaplandi', value: 61.5, sampleSize: 4 },
      scannedSeries: [{ tmdbId: 1, positivePct: 70 }],
      scanCount: 6,
    },
    tourism: {
      arrivals: { status: 'hesaplandi', value: 1200 },
      correlation: { status: 'hesaplanamaz', reason: 'seri kısa' },
      didEstimate: { status: 'hesaplandi', value: 150 },
      leadingSignal: { status: 'hesaplanamaz', reason: 'tarama yok' },
    },
  },
}

const compositeOk = {
  entries: [
    {
      tmdbId: 1,
      name: 'Terzi',
      compositeScore: 82.1,
      dataConfidence: { level: 'verified', label: 'Çift Kaynakla Doğrulandı' },
      evidence: ['x'],
    },
    {
      tmdbId: 2,
      name: 'Atiye',
      compositeScore: 40.5,
      dataConfidence: { level: 'weak', label: 'Sadece Medya/Yayın Sinyali' },
      evidence: [],
    },
  ],
  generatedAt: '2026-09-30T10:00:00.000Z',
  shareOfSearchMeta: { skipped: 'cache-miss' },
}

// İzlenme sinyali (watchSignal) — rapor bunu sadece okur: düzey, yüzdelik, Netflix bileşeni.
const sinyal = (index, level, netflix, extra = {}) => ({
  index,
  level,
  confidence: 'orta',
  componentCount: 2,
  components: { netflix },
  warnings: [],
  ...extra,
})
const SIGNALS = {
  byIso2: {
    DE: sinyal(80, 'yüksek', { present: true, series: 3, weeks: 21, bestRank: 1 }),
    FR: sinyal(90, 'çok yüksek', { present: true, series: 4, weeks: 30, bestRank: 1 }),
    SM: sinyal(
      null,
      null,
      { present: false, reason: 'Netflix bu ülke için Top 10 yayımlamıyor' },
      { componentCount: 1 }
    ),
    RU: sinyal(40, 'orta', { present: false, reason: 'Netflix bu ülke için Top 10 yayımlamıyor' }),
  },
}

const CHARTS = {
  ownRanking: {
    to: '2026-10-04',
    from: '2025-10-06',
    current: [{ position: 1, seriesId: 1, name: 'Eşref Rüya', weeks: 2, trend: '↑1' }],
    top: [{ seriesId: 1, name: 'Eşref Rüya', weeks: 2, bestPosition: 1 }],
    seriesCount: 3,
  },
}

function deps(over = {}) {
  const cacheStore = new Map()
  return {
    getEnrichedVisibility: async () => ({
      data: { countries: COUNTRIES, updatedAt: '2026-09-30T09:00:00.000Z' },
      raw: RAW,
    }),
    buildCountryConvergence: async () => convergenceOk,
    calculateCountryCompositeScore: vi.fn(async () => compositeOk),
    pipelineDb: pipelineDb({
      rows: [{ iso2: 'DE', tmdbId: 1, title: 'The Tailor', weeks: 21, peak: 1, score: 100, week: '2023-12-03' }],
    }),
    getMonthlyPeriods: () => [
      { period: '2026-08', avgScore: 480 },
      { period: '2026-09', avgScore: 500 },
    ],
    readCachedSerpApi: () => null,
    findSimilarCountries: async () => ({
      candidates: [{ iso2: 'FR', similarity: 0.9, reasons: ['aynı bölge'] }],
      pool: 'bolge-veya-gelir',
      note: '',
    }),
    readNetflixSyncError: () => null,
    getWatchSignals: async () => SIGNALS,
    getCountryCharts: async () => CHARTS,
    readWikiRows: () => [],
    cache: { get: (k) => cacheStore.get(k) ?? null, set: (k, v) => cacheStore.set(k, v), store: cacheStore },
    now: () => new Date('2026-09-30T12:00:00.000Z'),
    ...over,
  }
}

function hicNaNYok(obj) {
  const json = JSON.stringify(obj, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? 'NAN_BULUNDU' : v))
  expect(json).not.toContain('NAN_BULUNDU')
}

describe('buildCountryReport — sözleşme', () => {
  it('her zaman 13 bölümün hepsini içerir; her bölümde başlık ve metodoloji notu var', async () => {
    const r = await buildCountryReport('DE', { deps: deps() })
    expect(Object.keys(r.sections).sort()).toEqual([...SECTION_KEYS].sort())
    for (const s of Object.values(r.sections)) {
      expect(s.title).toBeTruthy()
      expect(s.note).toBeTruthy()
      expect(['hesaplandi', 'hesaplanamaz']).toContain(s.status)
      if (s.status === 'hesaplanamaz') expect(s.reason).toBeTruthy()
    }
    expect(r.contract).toBe('ulke-raporu-v1')
    hicNaNYok(r)
  })

  it('DE için hesaplanan bölümler doğru içerik taşır', async () => {
    const r = await buildCountryReport('DE', { deps: deps() })
    const s = r.sections
    // Skor yok: düzey + Netflix gerçekleri + "N dizi, M platformda"
    expect(s.scores.data).toMatchObject({
      level: 'yüksek',
      index: 80,
      netflix: { series: 3, weeks: 21, bestRank: 1 },
      access: { seriesCount: 25, platformCount: 2 }, // DE: Netflix (Terzi) + Apple TV (Atiye)
    })
    expect(JSON.stringify(s.scores)).not.toMatch(/scorePerCapita|"score"/)
    // İzlenme sırası: endeksi olanlar DE (80), FR (90), RU (40) → DE 2./3; SM tek bileşenli, sıralanmaz
    expect(s.ranking.data).toMatchObject({ rank: 2, of: 3, level: 'yüksek' })
    expect(s.trend.data.shortTerm.direction).toBe('yükseliyor')
    expect(s.trend.data.monthly).toHaveLength(2)
    expect(s.themes.data.items[0]).toMatchObject({ theme: 'aile', sharePct: 60 })
    expect(s.topSeries.status).toBe('hesaplandi')
    expect(s.topSeries.caveat).toMatch(/ücretli sorgu yapmaz/)
    expect(s.highlightedSeries.data.items.map((i) => i.name)).toEqual(['Terzi']) // weak olan Atiye elendi
    expect(s.highlightedSeries.data.criteria).toBeTruthy()
    expect(s.pressTone.data.mediaTone.value).toBe(61.5)
    expect(s.availability.data.rows.map((r) => r.name)).toEqual(['Terzi', 'Atiye'])
    expect(s.availability.data.rows[1]).toMatchObject({ streamable: false, platforms: { rent: ['Apple TV'] } })
    expect(s.availability.data.platformSummary[0]).toEqual({ name: 'Netflix', count: 1 })
    expect(s.netflixHistory.data.rows[0]).toMatchObject({
      name: 'Terzi',
      netflixTitle: 'The Tailor',
      peakRank: 1,
      weeksInTop10: 21,
    })
    expect(r.dataCutoffs.netflixLastWeek).toBe('2023-12-03')
    // Boşluk: FR'de flatrate/free olan ama DE'de streamable olmayan → Atiye (DE'de yalnızca rent) ve Kulüp
    expect(s.gapAnalysis.data.items.map((i) => i.name).sort()).toEqual(['Atiye', 'Kulüp'])
    expect(s.gapAnalysis.data.similarCountries[0].iso2).toBe('FR')
    expect(s.tourismSignal.data.arrivals.value).toBe(1200)
    expect(s.findings.data.items.length).toBeGreaterThan(0)
    // Platform listeleri (tüm platformlar) Netflix'e özgü bulgudan önce gelir
    // İzleyiciye dair sinyaller önce; katalog değişimini yansıtan yayın varlığı sonda
    expect(s.findings.data.items.map((f) => f.basis)).toEqual(['ranking', 'lists', 'pressTone'])
  })

  it('ücretli sorgu yapılmaz: bileşik skor cachedOnly ile çağrılır', async () => {
    const d = deps()
    await buildCountryReport('DE', { deps: d })
    expect(d.calculateCountryCompositeScore).toHaveBeenCalledWith('DE', expect.objectContaining({ cachedOnly: true }))
  })

  it('arama ilgisi yalnızca önbellekte varsa gelir; yoksa nedeniyle hesaplanamaz', async () => {
    const yok = await buildCountryReport('DE', { deps: deps() })
    expect(yok.sections.searchTrend.status).toBe('hesaplanamaz')
    expect(yok.sections.searchTrend.reason).toMatch(/henüz sorgulanmamış.*Terzi/)

    const var_ = await buildCountryReport('DE', {
      deps: deps({
        readCachedSerpApi: (key) =>
          key.includes('terzi') ? { timeline: [{ timestamp: 1, value: 40 }], queriedAt: 'x' } : null,
      }),
    })
    expect(var_.sections.searchTrend.data.series.map((s) => s.name)).toEqual(['Terzi'])
    expect(var_.sections.searchTrend.data.missing).toEqual(['Atiye'])
  })
})

describe('buildCountryReport — eksik veri gizlenmez', () => {
  it('TR: sıralama kaynak ülke gerekçesiyle hesaplanamaz, skor yine gelir', async () => {
    const r = await buildCountryReport('TR', { deps: deps() })
    expect(r.sections.scores.status).toBe('hesaplandi')
    expect(r.sections.ranking).toMatchObject({ status: 'hesaplanamaz', reason: 'kaynak ülke sıralamaya dahil edilmez' })
  })

  it('proxy ülke: skor/sıralama/trend/tema hesaplanamaz ve nedenleri farklı', async () => {
    const r = await buildCountryReport('XX', { deps: deps() })
    expect(r.isTracked).toBe(false)
    expect(r.sections.scores.reason).toMatch(/arama hacmi tahmini/)
    expect(r.sections.trend.status).toBe('hesaplanamaz')
    expect(r.sections.themes.status).toBe('hesaplanamaz')
    expect(r.sections.topSeries.reason).toMatch(/yayın verisi yok/)
    hicNaNYok(r)
  })

  it('takip dışı ülke (listede yok) çökmez', async () => {
    const r = await buildCountryReport('ZZ', { deps: deps() })
    expect(r.sections.scores.reason).toMatch(/takip listesinde değil/)
    expect(r.sections.availability.reason).toMatch(/sağlayıcı kaydı yok/)
    expect(r.dataGaps.length).toBeGreaterThan(5)
  })

  it('Netflix: pipeline.db yok / tablo yok / kayıt yok — üç farklı neden', async () => {
    const dbYok = await buildCountryReport('DE', { deps: deps({ pipelineDb: null }) })
    expect(dbYok.sections.netflixHistory.reason).toMatch(/pipeline\.db açılamadı/)

    const tabloYok = await buildCountryReport('DE', { deps: deps({ pipelineDb: pipelineDb({ withTable: false }) }) })
    expect(tabloYok.sections.netflixHistory.reason).toMatch(/tablosu yok/)

    const kayitYok = await buildCountryReport('FR', {
      deps: deps({
        pipelineDb: pipelineDb({
          rows: [{ iso2: 'DE', tmdbId: 1, title: 'x', weeks: 1, peak: 5, score: 50, week: '2026-01-04' }],
        }),
        readNetflixSyncError: () => '2026-09-28 deneme 8/12 başarısız',
      }),
    })
    expect(kayitYok.sections.netflixHistory.reason).toMatch(/FR için Netflix Top 10 kaydı yok/)
    expect(kayitYok.sections.netflixHistory.reason).toMatch(/kısmen indirildiği/)
    expect(kayitYok.sections.netflixHistory.reason).toMatch(/son senkron hatası/)
  })

  describe('Netflix: kayıt yokken üç durum (kaynak dosyadan türetilir)', () => {
    const digerUlke = [{ iso2: 'DE', tmdbId: 1, title: 'x', weeks: 1, peak: 5, score: 50, week: '2026-01-04' }]
    const donem = { netflix_source_first_week: '2021-07-04', netflix_source_last_week: '2026-08-16' }

    it('a) bloğu tam, Türk dizisi girmemiş → hesaplandi, 0 kayıt + kapsanan dönem', async () => {
      const r = await buildCountryReport('FR', {
        deps: deps({
          pipelineDb: pipelineDb({
            rows: digerUlke,
            meta: {
              ...donem,
              netflix_source_complete: '0',
              netflix_source_countries: '["DE","FR"]',
              netflix_truncated_country: 'PH',
            },
          }),
        }),
      })
      const s = r.sections.netflixHistory
      expect(s.status).toBe('hesaplandi')
      expect(s.data.rows).toEqual([])
      expect(s.data.zeroRecords).toBe(true)
      expect(s.data.message).toMatch(/^0 kayıt: kapsanan dönemde \(2021-07-04 – 2026-08-16\)/)
      expect(s.data.sourceCoverage).toMatchObject({ firstWeek: '2021-07-04', lastWeek: '2026-08-16', complete: false })
      expect(r.dataGaps.map((g) => g.section)).not.toContain('netflixHistory')
    })

    it('b) tam dosyada Netflix pazarı değil → hesaplanamaz, "yayımlamıyor"', async () => {
      const r = await buildCountryReport('FR', {
        deps: deps({
          pipelineDb: pipelineDb({
            rows: digerUlke,
            meta: {
              ...donem,
              netflix_source_complete: '1',
              netflix_source_countries: '["DE"]',
              netflix_market_countries: '["DE"]',
            },
          }),
        }),
      })
      expect(r.sections.netflixHistory.status).toBe('hesaplanamaz')
      expect(r.sections.netflixHistory.reason).toBe(
        'Netflix bu ülke için Top 10 listesi yayımlamıyor; yayın varlığı bölümüne bakın'
      )
    })

    it('b2) pazar listesi eski tam koşudan kalmış, bu koşu kısmi → yine "yayımlamıyor"', async () => {
      const r = await buildCountryReport('FR', {
        deps: deps({
          pipelineDb: pipelineDb({
            rows: digerUlke,
            meta: {
              ...donem,
              netflix_source_complete: '0',
              netflix_source_countries: '["DE"]',
              netflix_market_countries: '["DE","PL"]',
              netflix_truncated_country: 'PH',
            },
          }),
        }),
      })
      expect(r.sections.netflixHistory.reason).toMatch(/yayımlamıyor/)
    })

    it('c) dosya kısmi, ülke indirilen kısımda yok, pazar listesi bilinmiyor → kısmi indirme + kesilen ülke', async () => {
      const r = await buildCountryReport('PL', {
        deps: deps({
          pipelineDb: pipelineDb({
            rows: digerUlke,
            meta: {
              ...donem,
              netflix_source_complete: '0',
              netflix_source_countries: '["DE","FR"]',
              netflix_truncated_country: 'PH',
            },
          }),
          readNetflixSyncError: () => null,
        }),
      })
      const s = r.sections.netflixHistory
      expect(s.status).toBe('hesaplanamaz')
      expect(s.reason).toMatch(/PL için Netflix Top 10 kaydı yok — kaynak dosya kısmen indirildiği/)
      expect(s.reason).toMatch(/dosya PH ülkesinde kesildi/)
      expect(s.reason).not.toMatch(/yayımlamıyor/)
    })

    it('c2) pazar listesi var ve ülke pazar ama bu koşuda okunmamış (kısmi) → kısmi indirme', async () => {
      const r = await buildCountryReport('PL', {
        deps: deps({
          pipelineDb: pipelineDb({
            rows: digerUlke,
            meta: {
              ...donem,
              netflix_source_complete: '0',
              netflix_source_countries: '["DE"]',
              netflix_market_countries: '["DE","PL"]',
              netflix_truncated_country: 'PH',
            },
          }),
        }),
      })
      expect(r.sections.netflixHistory.reason).toMatch(/kısmen indirildiği/)
    })
  })

  it('boşluk analizi: benzer ülkelerde olan her dizi burada da varsa hesaplandi + "Boşluk yok"', async () => {
    // FR: 1 (Netflix), 2 (Netflix), 3 (Arte) hepsi yayında; benzer ülke DE'de olup FR'de olmayan dizi yok.
    const r = await buildCountryReport('FR', {
      deps: deps({
        findSimilarCountries: async () => ({
          candidates: [{ iso2: 'DE', similarity: 0.9, reasons: ['aynı bölge'] }],
          pool: 'bolge',
          note: 'test',
        }),
      }),
    })
    const g = r.sections.gapAnalysis
    expect(g.status).toBe('hesaplandi')
    expect(g.data).toMatchObject({ items: [], totalGaps: 0, noGap: true })
    expect(g.data.message).toBe('Boşluk yok: benzer ülkelerde yayında olan diziler bu ülkede de yayında')
    expect(g.data.similarCountries[0].iso2).toBe('DE')
    expect(r.dataGaps.map((x) => x.section)).not.toContain('gapAnalysis')
  })

  describe('Netflix: kapsam dönemi ve kaynak dosyanın son haftası', () => {
    const deRows = [
      {
        iso2: 'DE',
        tmdbId: 1,
        title: 'The Tailor',
        weeks: 21,
        peak: 1,
        score: 90,
        week: '2023-11-19',
        firstWeek: '2023-05-07',
      },
      {
        iso2: 'DE',
        tmdbId: 2,
        title: 'Old Money',
        weeks: 1,
        peak: 9,
        score: 10,
        week: '2025-10-19',
        firstWeek: '2025-10-19',
      },
      {
        iso2: 'BR',
        tmdbId: 3,
        title: 'My Name Is Farah',
        weeks: 4,
        peak: 3,
        score: 40,
        week: '2026-08-16',
        firstWeek: '2026-07-26',
      },
    ]
    const meta = {
      netflix_source_first_week: '2021-07-04',
      netflix_source_last_week: '2026-08-16',
      netflix_source_complete: '0',
    }

    it('DE benzeri durum: son kayıt kaynak dosyadan 8+ hafta eski → "son X ayda Top 10 kaydı yok" notu', async () => {
      const r = await buildCountryReport('DE', {
        deps: deps({ pipelineDb: pipelineDb({ rows: deRows, withFirstWeek: true, meta }) }),
      })
      const s = r.sections.netflixHistory
      expect(s.status).toBe('hesaplandi')
      expect(s.data.coverage).toEqual({ firstWeek: '2023-05-07', lastWeek: '2025-10-19' })
      expect(s.data.sourceCoverage).toEqual({
        firstWeek: '2021-07-04',
        lastWeek: '2026-08-16',
        complete: false,
        source: 'pipeline_meta',
      })
      expect(s.data.weeksBehindSource).toBe(43)
      expect(s.caveat).toMatch(/^Son 10 ayda Top 10 kaydı yok/)
      expect(s.caveat).toContain('2025-10-19')
      expect(s.caveat).toContain('2026-08-16')
      expect(s.data.rows[0]).toMatchObject({
        netflixTitle: 'The Tailor',
        firstWeek: '2023-05-07',
        lastWeek: '2023-11-19',
      })
    })

    it('son kayıt kaynak dosyayla aynı haftada → not yok, fark 0', async () => {
      const r = await buildCountryReport('BR', {
        deps: deps({ pipelineDb: pipelineDb({ rows: deRows, withFirstWeek: true, meta }) }),
      })
      const s = r.sections.netflixHistory
      expect(s.data.coverage).toEqual({ firstWeek: '2026-07-26', lastWeek: '2026-08-16' })
      expect(s.data.weeksBehindSource).toBe(0)
      expect(s.caveat).toBeNull()
    })

    it('eski şema (first_week_date ve pipeline_meta yok): tablodaki en geç haftaya düşer, çökmez', async () => {
      const r = await buildCountryReport('DE', {
        deps: deps({ pipelineDb: pipelineDb({ rows: deRows }) }), // withFirstWeek=false: firstWeek alanı yazılmaz
      })
      const s = r.sections.netflixHistory
      expect(s.status).toBe('hesaplandi')
      // first_week_date yokken kapsam başlangıcı son haftalardan türetilir (elde başka bilgi yok)
      expect(s.data.coverage).toEqual({ firstWeek: '2023-11-19', lastWeek: '2025-10-19' })
      expect(s.data.sourceCoverage).toMatchObject({ lastWeek: '2026-08-16', source: 'tablo', complete: null })
      expect(s.data.weeksBehindSource).toBe(43)
      expect(s.caveat).toMatch(/Son 10 ayda Top 10 kaydı yok/)
      expect(s.data.rows[0].firstWeek).toBeNull()
    })

    it('netflixStaleness: 8 hafta eşiği, geçersiz/ters tarih ve ay yuvarlama', () => {
      expect(netflixStaleness('2026-06-28', '2026-08-16')).toEqual({ weeksBehind: 7, note: null })
      expect(netflixStaleness('2026-06-21', '2026-08-16').weeksBehind).toBe(8)
      expect(netflixStaleness('2026-06-21', '2026-08-16').note).toMatch(/^Son 2 ayda/)
      expect(netflixStaleness('2025-10-19', '2026-08-16').note).toMatch(/^Son 10 ayda/)
      expect(netflixStaleness(null, '2026-08-16')).toEqual({ weeksBehind: null, note: null })
      expect(netflixStaleness('2026-09-01', '2026-08-16')).toEqual({ weeksBehind: null, note: null })
      expect(STALE_AFTER_WEEKS).toBe(8)
    })
  })

  it('benzer ülke yoksa boşluk analizi nedeniyle hesaplanamaz', async () => {
    const r = await buildCountryReport('DE', {
      deps: deps({ findSimilarCountries: async () => ({ candidates: [], pool: 'yok', note: 'meta yok' }) }),
    })
    expect(r.sections.gapAnalysis.reason).toMatch(/benzer ülke bulunamadı/)
  })

  it('bir kaynak fırlatırsa rapor çökmez, o bölüm hesaplanamaz olur', async () => {
    const r = await buildCountryReport('DE', {
      deps: deps({
        buildCountryConvergence: async () => {
          throw new Error('World Bank erişilemedi')
        },
        calculateCountryCompositeScore: async () => {
          throw new Error('önbellek yok')
        },
      }),
    })
    expect(r.sections.pressTone.reason).toMatch(/World Bank erişilemedi/)
    expect(r.sections.tourismSignal.reason).toMatch(/World Bank erişilemedi/)
    expect(r.sections.topSeries.reason).toBe('önbellek yok')
    expect(r.sections.highlightedSeries.status).toBe('hesaplanamaz')
    expect(r.sections.scores.status).toBe('hesaplandi')
  })

  it('dataGaps yalnızca hesaplanamayan bölümleri listeler', async () => {
    const r = await buildCountryReport('DE', { deps: deps() })
    const gaps = r.dataGaps.map((g) => g.section)
    expect(gaps).toContain('searchTrend')
    expect(gaps).not.toContain('scores')
    for (const g of r.dataGaps) expect(r.sections[g.section].status).toBe('hesaplanamaz')
  })
})

describe('buildRanking', () => {
  it('tek bileşenli ülke sıralanmaz ve nedeni "en az 2" der; Netflix\'siz ama endeksli ülke sıralanır', () => {
    const sm = buildRanking('SM', COUNTRIES, SIGNALS)
    expect(sm.status).toBe('hesaplanamaz')
    expect(sm.reason).toMatch(/en az 2/)
    const ru = buildRanking('RU', COUNTRIES, SIGNALS)
    expect(ru.data).toMatchObject({ rank: 3, of: 3, level: 'orta' })
  })

  it('sinyal servisi yoksa hesaplanamaz, kaynak ülke sıralamaya girmez', () => {
    expect(buildRanking('DE', COUNTRIES, null).status).toBe('hesaplanamaz')
    expect(buildRanking('TR', COUNTRIES, SIGNALS).reason).toMatch(/kaynak ülke/)
  })
})

describe('önbellek', () => {
  it('ikinci çağrı önbellekten döner; useCache=false hesaplar', async () => {
    const d = deps()
    const a = await buildCountryReport('DE', { deps: d })
    const b = await buildCountryReport('DE', { deps: d })
    expect(b).toBe(a)
    expect(d.calculateCountryCompositeScore).toHaveBeenCalledTimes(1)
    await buildCountryReport('DE', { deps: d, useCache: false })
    expect(d.calculateCountryCompositeScore).toHaveBeenCalledTimes(2)
  })
})

describe('bölüm ↔ not ↔ profil eşleşmesi', () => {
  it('her bölümün başlığı ve boş olmayan metodoloji notu var', () => {
    for (const k of SECTION_KEYS) {
      expect(SECTION_TITLES[k], k).toBeTruthy()
      expect(typeof SECTION_NOTES[k]).toBe('string')
      expect(SECTION_NOTES[k].length, k).toBeGreaterThan(40)
    }
  })
})

describe('platformLists — platformun kendi sıralaması', () => {
  it('sıra, dizi, listede kaldığı hafta ve değişim; platform/kaynak adı yok', () => {
    const s = buildPlatformLists(CHARTS)
    expect(s.status).toBe('hesaplandi')
    expect(s.data.now).toEqual([{ seriesId: 1, name: 'Eşref Rüya', position: 1, weeks: 2, trend: '↑1' }])
    expect(s.data.top).toEqual([{ seriesId: 1, name: 'Eşref Rüya', weeks: 2, bestPosition: 1 }])
    expect(s.data.seriesCount).toBe(3)
    expect(JSON.stringify(s.data)).not.toMatch(/Netflix|Shahid|Prime|Disney|platform/i)
  })

  it('bu hafta Türk dizisi yoksa gerçek sonuç (boş liste); hiç kayıt yoksa hesaplanamaz', () => {
    const bos = buildPlatformLists({
      ownRanking: { to: 'b', from: 'a', current: [], top: [{ name: 'X', weeks: 1, bestPosition: 3 }], seriesCount: 1 },
    })
    expect(bos).toMatchObject({ status: 'hesaplandi', data: { now: [] } })
    expect(buildPlatformLists({ ownRanking: null }).status).toBe('hesaplanamaz')
    expect(buildPlatformLists(null).status).toBe('hesaplanamaz')
  })

  it('liste okunamazsa rapor çökmez, eksik veriye düşer', async () => {
    const r = await buildCountryReport('DE', { useCache: false, deps: deps() })
    expect(r.sections.platformLists.status).toBe('hesaplandi')
    expect(r.dataCutoffs.listsLastDate).toBe('2026-10-04')
    const hatali = await buildCountryReport('DE', {
      useCache: false,
      deps: deps({
        getCountryCharts: async () => {
          throw new Error('pipeline.db kilitli')
        },
      }),
    })
    expect(hatali.sections.platformLists).toMatchObject({ status: 'hesaplanamaz' })
    expect(hatali.dataGaps.map((g) => g.section)).toContain('platformLists')
  })
})

describe('öne çıkan diziler — IMDb bağlamı', () => {
  it('her diziye IMDb puanı ve 7 günlük oy artışı eklenir; IMDb yoksa null, skor değişmez', async () => {
    const imdb = {
      1: { status: 'ready', rating: 7.4, votes: 13749, votesGrowth: { d7: { votes: 320, days: 7, since: 'x' } } },
    }
    const r = await buildCountryReport('DE', {
      useCache: false,
      deps: deps({ getImdbData: async (id) => imdb[id] ?? { status: 'unavailable' } }),
    })
    const entries = r.sections.topSeries.data.entries
    const bir = entries.find((e) => e.tmdbId === 1)
    expect(bir.imdb).toEqual({ rating: 7.4, votes: 13749, growth7: { votes: 320, days: 7, since: 'x' } })
    expect(entries.filter((e) => e.tmdbId !== 1).every((e) => e.imdb === null)).toBe(true)
  })
})

describe('buildWikiInterest — okunma ilgisi', () => {
  const satir = (lang, id, ym, views) => ({
    lang,
    tmdb_id: id,
    year: Number(ym.slice(0, 4)),
    month: Number(ym.slice(5)),
    views,
  })
  const names = (id) => ({ 1: 'Uzak Şehir', 2: 'Kızılcık Şerbeti' })[id]

  it('dil başına aylık seri ve en çok okunanlar; ana gösterge ülkeye özgü dilden, geçen aya göre değişim', () => {
    const rows = [
      satir('bg', 1, '2026-07', 300),
      satir('bg', 2, '2026-07', 100),
      satir('bg', 1, '2026-08', 500),
      satir('en', 2, '2026-08', 9000),
    ]
    const s = buildWikiInterest(
      [
        { lang: 'bg', regional: false },
        { lang: 'en', regional: true },
      ],
      rows,
      names
    )
    expect(s.status).toBe('hesaplandi')
    const bg = s.data.languages.find((l) => l.lang === 'bg')
    expect(bg.months).toEqual([
      { period: '2026-07', views: 400 },
      { period: '2026-08', views: 500 },
    ])
    expect(bg.top[0]).toEqual({ seriesId: 1, name: 'Uzak Şehir', views: 800 })
    expect(s.data.primary).toMatchObject({ lang: 'bg', last: 500, prev: 400, changePct: 25, topName: 'Uzak Şehir' })
    expect(s.data.languages.find((l) => l.lang === 'en').regional).toBe(true)
  })

  it('kaynakta henüz tamamlanmamış son ay (önceki üç ayın %40ının altı) seriye girmez', () => {
    const rows = ['2026-05', '2026-06', '2026-07', '2026-08'].map((m) => satir('bg', 1, m, 1000))
    const s = buildWikiInterest([{ lang: 'bg', regional: false }], [...rows, satir('bg', 1, '2026-09', 30)], names, {
      now: new Date('2026-10-05T12:00:00Z'),
    })
    expect(s.data.incompleteMonth).toBe('2026-09')
    expect(s.data.languages[0].months.at(-1).period).toBe('2026-08')
    expect(s.data.primary).toMatchObject({ period: '2026-08', last: 1000, prev: 1000, changePct: 0 })
    // doğal düşüş (%40 üstü) ayıklanmaz
    const d = buildWikiInterest([{ lang: 'bg', regional: false }], [...rows, satir('bg', 1, '2026-09', 600)], names, {
      now: new Date('2026-10-05T12:00:00Z'),
    })
    expect(d.data.incompleteMonth).toBeNull()
  })

  it('içinde bulunulan (yarım) ay seriye girmez', () => {
    const s = buildWikiInterest(
      [{ lang: 'bg', regional: false }],
      [satir('bg', 1, '2026-08', 500), satir('bg', 1, '2026-09', 900), satir('bg', 1, '2026-10', 10)],
      names,
      { now: new Date('2026-10-05T12:00:00Z') }
    )
    expect(s.data.languages[0].months.map((m) => m.period)).toEqual(['2026-08', '2026-09'])
    expect(s.data.primary).toMatchObject({ period: '2026-09', last: 900, prev: 500 })
  })

  it('yalnızca ortak dil varsa ana gösterge yok; dil ya da kayıt yoksa hesaplanamaz', () => {
    const s = buildWikiInterest([{ lang: 'en', regional: true }], [satir('en', 1, '2026-08', 10)], names)
    expect(s.data.primary).toBeNull()
    expect(buildWikiInterest([], [], names).status).toBe('hesaplanamaz')
    expect(buildWikiInterest([{ lang: 'bg', regional: false }], [], names).status).toBe('hesaplanamaz')
  })
})
