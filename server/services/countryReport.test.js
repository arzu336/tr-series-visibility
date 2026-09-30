import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import {
  buildCountryReport,
  buildRanking,
  selectProfile,
  SECTION_KEYS,
  SECTION_NOTES,
  SECTION_TITLES,
  PROFILES,
  PROFILE_MIN_ACCESS,
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
    expect(s.scores.data).toMatchObject({ score: 500, scorePerCapita: 6.4, perCapitaReliable: true })
    // TR ve proxy hariç: DE, FR, SM → toplamda DE 1.; kişi başına yalnızca güvenilirler (DE, FR) → DE 2.
    expect(s.ranking.data).toMatchObject({ totalRank: 1, totalOf: 3, perCapitaRank: 2, perCapitaOf: 2 })
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
    expect(s.findings.data.items.map((f) => f.basis)).toEqual(['ranking', 'trend', 'netflix'])
  })

  it('ücretli sorgu yapılmaz: bileşik skor cachedOnly ile çağrılır', async () => {
    const d = deps()
    await buildCountryReport('DE', { deps: d })
    expect(d.calculateCountryCompositeScore).toHaveBeenCalledWith('DE', { cachedOnly: true })
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
  it('güvenilmez paydalı ülke kişi başına sıralamaya girmez ama toplamda sıralanır', () => {
    const r = buildRanking('SM', COUNTRIES)
    expect(r.data.totalRank).toBe(3)
    expect(r.data.perCapitaRank).toBeNull()
    expect(r.data.perCapitaExcludedReason).toMatch(/1 milyon/)
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

describe('selectProfile', () => {
  it('yalnızca profil bölümlerini döner, sayılar aynı kalır, sıra korunur', async () => {
    const r = await buildCountryReport('DE', { deps: deps() })
    const p = selectProfile(r, 'producer')
    expect(Object.keys(p.sections)).toEqual(PROFILES.producer)
    expect(p.sectionOrder).toEqual(PROFILES.producer)
    expect(p.sections.scores).toBe(r.sections.scores)
    expect(p.sections.findings).toBeUndefined()
    expect(p.profileTitle).toBe('Yapımcı / dağıtımcı raporu')
    for (const g of p.dataGaps) expect(PROFILES.producer).toContain(g.section)
  })

  it('bilinmeyen profil fırlatır', async () => {
    const r = await buildCountryReport('DE', { deps: deps() })
    expect(() => selectProfile(r, 'ceo')).toThrow(/Bilinmeyen rapor profili/)
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

  it('profiller yalnızca bilinen bölümleri kullanır ve her bölüm en az bir profilde yer alır', () => {
    const kullanilan = new Set()
    for (const [profil, keys] of Object.entries(PROFILES)) {
      expect(PROFILE_MIN_ACCESS[profil]).toBeTruthy()
      for (const k of keys) {
        expect(SECTION_KEYS, `${profil}:${k}`).toContain(k)
        kullanilan.add(k)
      }
    }
    expect([...kullanilan].sort()).toEqual([...SECTION_KEYS].sort())
  })

  it('yetki matrisi: executive viewer+, marketing analyst+, producer admin', () => {
    expect(PROFILE_MIN_ACCESS).toEqual({ executive: 'viewer', marketing: 'analyst', producer: 'admin' })
  })
})
