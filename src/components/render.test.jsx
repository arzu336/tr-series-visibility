import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import ErrorBoundary from './ErrorBoundary.jsx'
import CountryLeaderboard from './CountryLeaderboard.jsx'
import { HybridScoreTag } from './MediaSentimentCard.jsx'
import SeriesPage, { seriesFromCountries } from './SeriesPage.jsx'
import Flag from './Flag.jsx'
import TrendsExplorer from './TrendsExplorer.jsx'
import { SearchInterestSection } from './SeriesSearchInterest.jsx'
import CountryPanel, { WatchLists } from './CountryPanel.jsx'
import ChartList from './ChartList.jsx'
import { MagazineCarousel, visibleMagazineItems } from './MagazineNews.jsx'
import CountryReportDocument from './report/CountryReportDocument.jsx'
import CountryReportView from './report/CountryReportView.jsx'
import ReportsHub from './report/ReportsHub.jsx'
import { SeriesMarketsSection, SeriesOpportunitySection } from './report/SeriesSections.jsx'
import { ReadingTourismSection, GlobalMarketsSection, BenchmarkSection } from './report/GlobalSections.jsx'
import { EMPTY } from '../lib/emptyStates.js'
import * as NOTES from '../lib/methodologyNotes.js'
import Legend from './Legend.jsx'
import ChartsStrip from './ChartsStrip.jsx'
import ContinentSidebar from './ContinentSidebar.jsx'

// jsdom/testing-library kurulu değil; sunucu tarafı render, useAsync'e geçirilen bileşenlerin
// ilk render'da (status: loading/idle) patlamadığını ve doğru iskeleti bastığını doğrular.
// useEffect SSR'da çalışmaz, yani ağ çağrısı yapılmaz.

// Tüm api fonksiyonları hiç çözülmeyen söz döner (SSR'da effect zaten çalışmaz; bu, yanlışlıkla
// çalışsa bile ağa çıkılmamasını garanti eder). Proxy KULLANILMAZ: vitest fabrika sonucunu
// await eder ve `then` anahtarına fonksiyon dönen bir Proxy "thenable" sanılıp sonsuza kadar bekletir.
vi.mock('../lib/api.js', async (orig) => {
  const gercek = await orig()
  return Object.fromEntries(Object.keys(gercek).map((k) => [k, () => new Promise(() => {})]))
})

describe('useAsync tabanlı bileşenler ilk render', () => {
  it('CountryLeaderboard yükleniyor iskeleti basar', () => {
    const html = renderToString(<CountryLeaderboard iso2="DE" />)
    expect(html).toContain('leaderboard--skeleton')
  })

  it('CountryLeaderboard iso2 yokken de yükleniyor gösterir, çökmez', () => {
    expect(() => renderToString(<CountryLeaderboard iso2={null} />)).not.toThrow()
  })

  it('HybridScoreTag hesaplanıyor etiketi basar', () => {
    expect(renderToString(<HybridScoreTag seriesName="Terzi" iso2="DE" />)).toContain('Yerel skor hesaplanıyor')
  })

  it('SeriesPage dizi yayın listelerinde yoksa katalog kaydını bekler (yükleniyor) ve haritaya dönüş basar', () => {
    const html = renderToString(<SeriesPage seriesId={99} allCountries={[]} />)
    expect(html).toContain('Yükleniyor')
    expect(html).toContain('Haritaya dön')
  })

  it('SeriesPage Arama İlgisi’nden açıldıysa geri düğmesi aramaya döner', () => {
    const html = renderToString(<SeriesPage seriesId={99} allCountries={[]} backLabel="Arama İlgisi’ne dön" />)
    expect(html).toContain('Arama İlgisi’ne dön')
    expect(html).not.toContain('Haritaya dön')
  })

  it('SeriesPage dizi adını, bölümleri ve yayında olduğu ülkeleri bayrak ve platformla basar', () => {
    const allCountries = [
      { iso2: 'DE', score: 10, seriesList: [{ id: 1, name: 'Terzi', cast: [], platforms: ['Netflix'] }] },
      { iso2: 'SA', score: 5, seriesList: [{ id: 1, name: 'Terzi', cast: [], platforms: ['Shahid VIP', 'Netflix'] }] },
    ]
    const html = renderToString(<SeriesPage seriesId={1} allCountries={allCountries} />)
    expect(html).toContain('Terzi')
    for (const baslik of ['Listeler', 'Nerede yayında', 'Magazin', 'Basın &amp; medya algısı'])
      expect(html).toContain(baslik)
    expect(html).toContain('fi fi-de')
    expect(html).toContain('fi fi-sa')
    expect(html).toContain('Shahid VIP · Netflix')
    expect(html).toMatch(/2(<!-- -->)? ülkede yayında/)
  })

  it('seriesFromCountries ülkeleri Türkçe ada göre sıralar ve platformları taşır', () => {
    const s = seriesFromCountries(
      [
        { iso2: 'DE', seriesList: [{ id: 1, name: 'Terzi', platforms: ['Netflix'] }] },
        { iso2: 'AR', seriesList: [{ id: 1, name: 'Terzi' }] },
      ],
      1
    )
    // Almanya < Arjantin (Türkçe ada göre), ISO koduna göre değil
    expect(s.availability.map((c) => [c.iso2, c.platforms])).toEqual([
      ['DE', ['Netflix']],
      ['AR', []],
    ])
    expect(seriesFromCountries([], 1)).toBeNull()
  })

  it('Flag iki harfli ISO kodu için bayrak, geçersiz kodda hiçbir şey basmaz', () => {
    expect(renderToString(<Flag iso2="TR" />)).toContain('fi fi-tr')
    expect(renderToString(<Flag iso2="TR" title="Türkiye" />)).toContain('aria-label="Türkiye"')
    expect(renderToString(<Flag iso2="XWW" />)).toBe('')
    expect(renderToString(<Flag iso2={null} />)).toBe('')
  })

  it('CountryPanel yayındaki dizi satırı dizi sayfasını açar (açılır ayrıntı yok)', () => {
    const country = {
      iso2: 'DE',
      name: 'Almanya',
      seriesCount: 1,
      dataSource: 'tmdb',
      seriesList: [{ id: 1, name: 'Terzi', cast: [], platforms: ['Netflix'], overview: 'özet metni' }],
    }
    const html = renderToString(<CountryPanel country={country} allCountries={[country]} />)
    expect(html).toContain('Terzi — dizi sayfasını aç')
    expect(html).not.toContain('aria-expanded')
    expect(html).not.toContain('özet metni')
  })

  it('CountryPanel ülke seçilmemişken yönlendirme metni basar', () => {
    expect(renderToString(<CountryPanel country={null} allCountries={[]} />)).toContain('bir ülkeye tıklayın')
  })

  it('CountryPanel ilk render: yayın varlığı başlığı ve dizi altında platform; izlenme gerçekleri kartı ve skor etiketi yok', () => {
    const country = {
      iso2: 'DE',
      name: 'Almanya',
      score: 500,
      seriesCount: 30,
      seriesList: [{ id: 1, name: 'Terzi', cast: [], platforms: ['Netflix', 'HBO Max'] }],
      dataSource: 'tmdb',
    }
    const html = renderToString(<CountryPanel country={country} allCountries={[country]} />)
    expect(html).not.toContain('İzlenme gerçekleri')
    expect(html).not.toContain('İzlenme düzeyi')
    expect(html).toMatch(/Yayındaki diziler — (<!-- -->)?30(<!-- -->)? dizi/)
    expect(html).toContain('Netflix · HBO Max')
    expect(html).not.toMatch(/skor/i)
  })
})

describe('ErrorBoundary', () => {
  it('hata yokken çocuğu basar', () => {
    expect(
      renderToString(
        <ErrorBoundary>
          <p>içerik</p>
        </ErrorBoundary>
      )
    ).toContain('içerik')
  })

  it('getDerivedStateFromError hata durumunu üretir', () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error('x'))).toEqual({ error: expect.any(Error) })
  })
})

// --- Ülke brifingi (ulke-brifingi-v1), SSR ile. `rapor(ad, bölümler)`: hesaplanan bölümler tek başlık altında
// (sunucudaki başlık eşlemesi countryBriefing.test.js'te), hesaplanamayanlar ekte; bulgular özet cümleleri olur.
const ok = (key, title, data, extra = {}) => ({ key, title, status: 'hesaplandi', data, note: `${key} notu`, ...extra })
const yok = (key, title, reason) => ({ key, title, status: 'hesaplanamaz', reason, note: `${key} notu` })

function rapor(_ad, sections) {
  const order = Object.keys(sections)
  const hesaplanan = order.filter((k) => sections[k].status === 'hesaplandi' && k !== 'findings')
  return {
    iso2: 'DE',
    title: 'Ülke brifingi',
    generatedAt: '2026-09-30T08:00:00.000Z',
    week: '2026-10-04',
    isTracked: true,
    summary: {
      kpis: [
        { key: 'level', label: 'İzlenme düzeyi', value: 'yüksek', detail: '23. / 111 ülke', trend: null },
        { key: 'ranked', label: 'Bu hafta sıralamada', value: '8 dizi', detail: 'geçen hafta 6', trend: 'up' },
      ],
      sentences: sections.findings?.status === 'hesaplandi' ? sections.findings.data.items : [],
      caveat: null,
    },
    chapters: hesaplanan.length
      ? [
          {
            key: 'test',
            title: 'Test başlığı',
            sections: hesaplanan.map((k) => ({
              key: k,
              title: sections[k].title,
              data: sections[k].data,
              caveat: sections[k].caveat ?? null,
            })),
          },
        ]
      : [],
    contract: 'ulke-brifingi-v1',
  }
}

const scores = ok('scores', 'İzlenme düzeyi ve yayın varlığı', {
  level: 'yüksek',
  index: 78,
  confidence: 'orta',
  netflix: { series: 3, weeks: 21, bestRank: 1 },
  netflixReason: null,
  access: { seriesCount: 50, platformCount: 7 },
  dominantTheme: 'aşk',
  warnings: [
    { code: 'linear-tv', text: "Bu ülkede 41 Türk dizisi yerel adla dağıtılmış ama Netflix Top 10'da zayıf." },
  ],
})

const executive = rapor('executive', {
  scores,
  ranking: ok('ranking', 'Ülkeler arası izlenme sırası', {
    rank: 23,
    of: 111,
    index: 78,
    level: 'yüksek',
    confidence: 'orta',
  }),
  trend: ok('trend', 'Trend', {
    shortTerm: { direction: 'yükseliyor', changePct: 31.7, windowDays: 8 },
    monthly: [
      { period: '2026-07', avgScore: 243.5, sampleCount: 11, isCurrent: false },
      { period: '2026-08', avgScore: 475.4, sampleCount: 8, isCurrent: false },
      { period: '2026-09', avgScore: 620.1, sampleCount: 30, isCurrent: true },
    ],
  }),
  findings: ok('findings', 'Öne çıkan bulgular', {
    items: [{ text: 'Yayın varlığı (katalog ağırlığı) son 8 günde %32 arttı.', basis: 'trend' }],
    dropped: 1,
  }),
})

const marketing = rapor('marketing', {
  scores,
  topSeries: ok(
    'topSeries',
    'Ülkede en çok ilgi gören diziler',
    {
      entries: [
        {
          tmdbId: 1,
          name: 'Seni Tanıyorum',
          compositeScore: 50,
          breakdown: {},
          evidence: ['2 farklı platformda yayında'],
          dataConfidence: { label: 'Sadece Medya/Yayın Sinyali', level: 'weak' },
        },
      ],
      generatedAt: '2026-09-30T07:00:00.000Z',
    },
    { caveat: 'arama payı faktörü önbellekte olmadığı için dışlandı' }
  ),
  themes: ok('themes', 'Tema dağılımı', { items: [{ theme: 'aşk', score: 187.5, sharePct: 28.2 }], seriesCount: 50 }),
  searchTrend: ok('searchTrend', 'Arama ilgisi (son 12 ay)', {
    series: [
      {
        tmdbId: 1,
        name: 'Elimi Bırakma',
        timeline: [
          { timestamp: 1759017600, value: 12 },
          { timestamp: 1759622400, value: 40 },
        ],
        queriedAt: '2026-09-30T06:40:28.710Z',
      },
    ],
    missing: ['Eşref Rüya'],
  }),
  pressTone: yok('pressTone', 'Basın tonu', 'DE için analiz edilmiş basın taraması yok (0 tarama denendi)'),
  highlightedSeries: yok(
    'highlightedSeries',
    'Veriye göre öne çıkan diziler',
    'hiçbir dizi en az kısmi doğrulama eşiğini geçmiyor'
  ),
})

const producer = rapor('producer', {
  scores,
  availability: ok('availability', 'Yayın varlığı (dizi × platform)', {
    rows: [
      { tmdbId: 1, name: 'Elimi Bırakma', popularity: 71, streamable: true, platforms: { flatrate: ['Netflix'] } },
    ],
    platformSummary: [{ name: 'Netflix', count: 19 }],
    streamableCount: 1,
  }),
  netflixHistory: ok(
    'netflixHistory',
    'Netflix Top 10 geçmişi',
    {
      rows: [
        {
          tmdbId: 2,
          name: 'Terzi',
          netflixTitle: 'The Tailor',
          weeksInTop10: 5,
          peakRank: 3,
          rankScore: 74,
          firstWeek: '2023-05-07',
          lastWeek: '2023-11-19',
        },
      ],
      coverage: { firstWeek: '2022-08-07', lastWeek: '2025-10-19' },
      sourceCoverage: { firstWeek: '2021-07-04', lastWeek: '2026-08-16', complete: false, source: 'pipeline_meta' },
      weeksBehindSource: 43,
      lastWeek: '2025-10-19',
    },
    {
      caveat:
        'Son 10 ayda Top 10 kaydı yok: ülkenin son kaydı 2025-10-19, kaynak dosya 2026-08-16 haftasına kadar veri içeriyor.',
    }
  ),
  gapAnalysis: ok('gapAnalysis', 'Boşluk analizi', {
    similarCountries: [
      {
        iso2: 'AT',
        similarity: 0.997,
        themeSimilarity: 0.997,
        confidence: 1,
        gdpDistance: 0.039,
        seriesCount: 47,
        reasons: ['aynı bölge', 'aynı gelir grubu'],
      },
    ],
    pool: 'bolge',
    items: [
      { tmdbId: 3, name: 'Hercai', popularity: 21.2, availableIn: ['IT', 'LV'], netflixBest: null, gapScore: 22.1 },
    ],
    totalGaps: 9,
  }),
  tourismSignal: ok('tourismSignal', 'Turizm / etki sinyali', {
    arrivals: { status: 'hesaplandi', value: 982353, monthCount: 9, latest: '2026-08' },
    correlation: { status: 'hesaplanamaz', reason: 'turist serisiyle aynı aylara henüz ulaşmadı' },
    didEstimate: {
      status: 'hesaplandi',
      value: -66440,
      controlIso2: 'BE',
      controlReason: 'aynı bölge',
      treatmentChangePct: -11.3,
      controlChangePct: -15.98,
      unit: 'ziyaretci-fark',
      window: '2025-06 → 2026-06',
    },
    leadingSignal: {
      status: 'hesaplandi',
      value: 0,
      travelQuery: 'Travel to Turkey',
      lagWeeks: 16,
      sampleSize: 36,
      direction: 'nötr',
      significant: false,
    },
  }),
})

describe('Ülke raporu — Türk dizileri sıralaması', () => {
  const lists = ok('platformLists', 'Türk dizileri sıralaması', {
    now: [
      { seriesId: 1, name: 'Eşref Rüya', position: 1, weeks: 2, trend: '↑2' },
      { seriesId: 2, name: 'Uzak Şehir', position: 2, weeks: 1, trend: null },
    ],
    top: [{ seriesId: 3, name: 'Kuruluş Osman', weeks: 30, bestPosition: 1 }],
    seriesCount: 12,
    window: { from: '2025-10-06', to: '2026-10-04', weeks: 52 },
  })

  it('kendi sıralama: sıra, dizi, listede hafta, değişim; platform adı ve "yeni" etiketi yok', () => {
    const html = renderToString(
      <CountryReportDocument report={rapor('tek', { platformLists: lists })} countryName="Almanya" />
    ).replaceAll('<!-- -->', '')
    expect(html).toContain('Türk dizileri sıralaması')
    expect(html).toContain('2 hafta')
    expect(html).toContain('chart-list__trend--up')
    expect(html).toContain('Son 52 haftanın en kalıcıları')
    expect(html).toContain('Kuruluş Osman')
    expect(html).toContain('12 dizi')
    expect(html).not.toMatch(/chart-list__trend--new|YENİ|Netflix|Shahid|Prime Video|Platform/)
  })

  it('bu hafta Türk dizisi yoksa açık mesaj', () => {
    const bos = ok('platformLists', 'Türk dizileri sıralaması', {
      now: [],
      top: [],
      seriesCount: 0,
      window: { from: '2025-10-06', to: '2026-10-04', weeks: 52 },
    })
    const html = renderToString(
      <CountryReportDocument report={rapor('tek', { platformLists: bos })} countryName="Almanya" />
    )
    expect(html).toContain('Bu hafta sıralamada Türk dizisi yok.')
  })
})

describe('Ülke brifingi — SSR', () => {
  it('özet kartı önce: dört sayı, yön oku ve özet cümleleri; ardından başlıklar; ek yok', () => {
    const html = renderToString(<CountryReportDocument report={executive} countryName="Almanya" />).replaceAll(
      '<!-- -->',
      ''
    )
    expect(html).toContain('Almanya')
    expect(html).toContain('Ülke brifingi')
    expect(html).toContain('Hafta sonu:')
    expect(html.indexOf('brief__summary')).toBeLessThan(html.indexOf('brief__chapter'))
    expect(html).not.toContain('brief__appendix')
    expect(html).not.toContain('Yöntem')
    expect(html).toContain('Bu hafta sıralamada')
    expect(html).toContain('brief__trend--up')
    expect(html).toContain('geçen hafta 6')
    expect(html).toContain('brief__sentences')
    for (const t of ['İzlenme düzeyi ve yayın varlığı', 'Ülkeler arası izlenme sırası', 'Trend'])
      expect(html).toContain(t)
    expect(html).not.toContain('Netflix Top 10 (son 52 hafta)') // tek platform göstergesi raporda yok
    expect(html).toContain('23. / 111')
    expect(html).toContain('yerel adla dağıtılmış') // linear-tv uyarısı raporda da görünür
    expect(html).toContain('yükseliyor')
    expect(html).toContain('report__doc')
    expect(html).not.toContain('İletişim Başkanlığı')
  })

  it('hesaplanamayan bölüm hiç görünmez (ne gövdede ne ekte); bölüm uyarısı bölümün altında kalır', () => {
    const html = renderToString(<CountryReportDocument report={marketing} countryName="Almanya" />)
    for (const t of ['Ülkede en çok ilgi gören diziler', 'Tema dağılımı', 'Arama ilgisi (son 12 ay)']) {
      expect(html).toContain(t)
    }
    for (const t of [
      'Basın tonu',
      'Veriye göre öne çıkan diziler',
      'Eksik veri',
      'Veri yok.',
      'report__section--empty',
    ]) {
      expect(html).not.toContain(t)
    }
    expect(html).toContain('arama payı faktörü önbellekte olmadığı için dışlandı')
    expect(html).toMatch(/Sorgulanmamış:.*Eşref Rüya/)
  })

  it('bölümler sunucunun verdiği sırayla; benzer ülkeler ad + gerekçe + deneysel, benzerlik sayısı yok', () => {
    const html = renderToString(<CountryReportDocument report={producer} countryName="Almanya" />)
    const idx = [
      'İzlenme düzeyi ve yayın varlığı',
      'Yayın varlığı (dizi × platform)',
      'Netflix Top 10 geçmişi',
      'Boşluk analizi',
      'Turizm / etki sinyali',
    ].map((t) => html.indexOf(t))
    expect(idx.every((i) => i >= 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    expect(html).toContain('Avusturya')
    expect(html).toContain('aynı bölge, aynı gelir grubu')
    expect(html).toContain('deneysel')
    expect(html).not.toContain('0.997')
    expect(html).not.toContain('0,997')
    expect(html).toContain('Son 10 ayda Top 10 kaydı yok')
    expect(html).toContain('43 hafta')
    expect(html).toContain('turist serisiyle aynı aylara henüz ulaşmadı')
  })

  it('istemci sıralamayı belirlemez: yalnızca sunucunun başlıklarındaki bölümler basılır; bilinmeyen anahtar çökmez', () => {
    const r = {
      ...executive,
      chapters: [
        {
          key: 'a',
          title: 'Birinci başlık',
          sections: [
            { key: 'trend', title: 'Trend', data: executive.chapters[0].sections.find((s) => s.key === 'trend').data },
            { key: 'bilinmeyen', title: 'Yeni bölüm', data: {} },
          ],
        },
      ],
    }
    const html = renderToString(<CountryReportDocument report={r} countryName="Almanya" />)
    expect(html).toContain('Birinci başlık')
    expect(html).toContain('Yeni bölüm')
    expect(html).not.toContain('Ülkeler arası izlenme sırası')
  })

  it('CountryReportView ilk render: rapor yüklenirken çökmez, düğmeler etiketli, profil seçici yok', () => {
    const html = renderToString(<CountryReportView iso2="DE" countryName="Almanya" onBack={() => {}} />).replaceAll(
      '<!-- -->',
      ''
    )
    expect(html).toContain('Almanya raporu hazırlanıyor')
    expect(html).not.toContain('radiogroup')
    expect(html).toContain('aria-label="Haritaya geri dön"')
    expect(html).toContain('aria-label="Raporu PDF olarak indir')
    expect(html).toContain('report__loading')
  })
})

describe('Boş durum metinleri — neden söyleyen sabitler (emptyStates.js)', () => {
  it('rapor: boşluk analizi boşken hesaplandi ve "Boşluk yok" cümlesini basar, tablo yok', () => {
    const r = rapor('producer', {
      gapAnalysis: ok('gapAnalysis', 'Boşluk analizi', {
        similarCountries: [{ iso2: 'AT', reasons: ['aynı bölge'] }],
        pool: 'bolge',
        items: [],
        totalGaps: 0,
        noGap: true,
        message: EMPTY.gapNone,
      }),
    })
    const html = renderToString(<CountryReportDocument report={r} countryName="Almanya" />)
    expect(html).toContain('Boşluk yok: benzer ülkelerde yayında olan diziler bu ülkede de yayında')
    expect(html).toContain('Avusturya')
    expect(html).not.toContain('Boşluk puanı')
    expect(html).not.toContain('Veri yok.')
  })

  it('rapor: Netflix 0 kayıt durumu hesaplandi olarak kapsanan dönemi basar', () => {
    const r = rapor('producer', {
      netflixHistory: ok('netflixHistory', 'Netflix Top 10 geçmişi', {
        rows: [],
        zeroRecords: true,
        message: EMPTY.netflixZeroRecords('2021-07-04', '2026-08-16'),
        coverage: null,
        sourceCoverage: { firstWeek: '2021-07-04', lastWeek: '2026-08-16', complete: false, source: 'pipeline_meta' },
        weeksBehindSource: null,
        lastWeek: null,
      }),
    })
    const html = renderToString(<CountryReportDocument report={r} countryName="Japonya" />)
    expect(html).toContain('0 kayıt: kapsanan dönemde (2021-07-04 – 2026-08-16)')
    expect(html).toContain('Kaynak dosyanın kapsadığı dönem')
    expect(html).not.toContain('Veri yok.')
  })

  it('rapor: turizm korelasyonu "Aylık seri birikiyor: 2/3 ay" nedenini gösterir', () => {
    const r = rapor('producer', {
      tourismSignal: ok('tourismSignal', 'Turizm / etki sinyali', {
        arrivals: { status: 'hesaplandi', value: 1000, monthCount: 9, latest: '2026-08' },
        correlation: {
          status: 'hesaplanamaz',
          reason: EMPTY.correlationAccumulating(2, 3),
          monthsAvailable: 2,
          monthsRequired: 3,
        },
        didEstimate: { status: 'hesaplanamaz', reason: 'kontrol ülkesi eşleştirilemedi' },
        leadingSignal: { status: 'hesaplanamaz', reason: EMPTY.leadingSignalOutOfScope(15) },
      }),
    })
    const html = renderToString(<CountryReportDocument report={r} countryName="Almanya" />)
    expect(html).toContain('Aylık seri birikiyor: 2/3 ay')
    expect(html).toContain('Kapsam: görünürlükte ilk 15 ülke; bu ülke tarama kapsamında değil')
  })

  it('küresel görünüm: okunma–ziyaretçi tablosu sonucu ve rastlantı beklentisini yazar', () => {
    const html = renderToString(
      <ReadingTourismSection
        data={{
          tested: 32,
          significantCount: 2,
          expectedByChance: 1.6,
          sharedLanguage: 51,
          items: [{ iso2: 'IT', r: -0.6, lagMonths: 1, n: 74, significant: true }],
        }}
      />
    ).replaceAll('<!-- -->', '')
    expect(html).toContain('32 ülkede ölçüldü; 2 ülkede')
    expect(html).toContain('~1,6 beklenir')
    expect(html).toContain('Anlamlı, ters yönde')
    expect(html).toContain('İtalya')
  })

  it('küresel görünüm: pazarlar ve karşılaştırma tabloları', () => {
    const m = renderToString(
      <GlobalMarketsSection
        data={{ countryCount: 87, previousCountryCount: 62, rows: [{ iso2: 'IL', count: 10, top: 'Gupi' }] }}
      />
    ).replaceAll('<!-- -->', '')
    expect(m).toContain('87 ülkenin sıralamasında')
    expect(m).toContain('İsrail')
    const b = renderToString(
      <BenchmarkSection data={{ rows: [{ code: 'TR', name: 'Türkiye', sharePct: 14.8, countries: 133 }] }} />
    )
    expect(b).toContain('report__row--highlight')
    expect(b).not.toMatch(/ihracat/i)
  })

  it('ülke paneli: yayın kataloğu olmayan ülkede boş bölümler yok, eldeki veriler bölümü yüklenir', () => {
    const country = { iso2: 'XX', name: 'Deneme', dataSource: 'proxy', searchInterestScore: 40, seriesList: [] }
    const html = renderToString(<CountryPanel country={country} allCountries={[country]} />)
    expect(html).not.toContain('Yayındaki diziler')
    expect(html).not.toContain('Listeye giren diziler — zaman içinde')
    expect(html).not.toContain('Bu ülke için yayın verisi yok')
    expect(html).toContain('Yükleniyor')
  })

  it('ülke paneli: sınırlı veri ülkesi çelişkili "arama ölçülemedi" demez; tahmini düzey varsa yazar', () => {
    const country = {
      iso2: 'GL',
      name: 'Grönland',
      dataSource: 'proxy',
      limited: true,
      searchInterestScore: null,
      seriesList: [],
      watchSignal: { level: null, provisional: { level: 'Çok düşük', source: 'search' } },
    }
    const html = renderToString(<CountryPanel country={country} allCountries={[country]} />).replaceAll('<!-- -->', '')
    expect(html).toContain(
      'Sınırlı veri: bu ülkede yayın kataloğu tutulmuyor. Tahmini düzey: Çok düşük (yalnızca arama ilgisi).'
    )
    expect(html).not.toContain('ölçülemeyecek kadar düşük')
    expect(html).not.toContain('null/100')
  })
})

// ---------- Kilit: görünürlük skoru / kişi başına / popülerlik toplamı hiçbir çıktıda geçmez ----------
const YASAKLI = /görünürlük skoru|kişi başına|popülerlik toplamı/i

describe('Kilit test — kaldırılan gösterge adları', () => {
  const sabitler = { ...NOTES, ...EMPTY }

  it('metodoloji notları ve boş durum sabitleri yasaklı ifade içermez', () => {
    for (const [k, v] of Object.entries(sabitler)) {
      const metin = typeof v === 'function' ? v(15, 30, 3, 'DE') : String(v)
      expect(metin, k).not.toMatch(YASAKLI)
    }
    expect(NOTES.VISIBILITY_SCORE_NOTE).toBeUndefined()
    expect(NOTES.PER_CAPITA_SCORE_NOTE).toBeUndefined()
    expect(NOTES.TOTAL_SCORE_NOTE).toBeUndefined()
  })

  it('ana ekran bileşenleri (lejant, şerit, kıta paneli, ülke paneli, dizi paneli) yasaklı ifade basmaz', () => {
    const de = {
      iso2: 'DE',
      name: 'Almanya',
      score: 500,
      seriesCount: 30,
      dataSource: 'tmdb',
      seriesList: [{ id: 1, name: 'Terzi', cast: [] }],
    }
    const xx = { iso2: 'XX', name: 'Deneme', dataSource: 'proxy', searchInterestScore: 40, seriesList: [] }
    const ciktilar = [
      renderToString(<Legend />),
      renderToString(<ChartsStrip onSelectSeries={() => {}} />),
      renderToString(<ContinentSidebar countries={[de, xx]} onSelectCountry={() => {}} onSelectSeries={() => {}} />),
      renderToString(<CountryPanel country={de} allCountries={[de, xx]} />),
      renderToString(<CountryPanel country={xx} allCountries={[de, xx]} />),
      renderToString(<SeriesPage seriesId={1} allCountries={[de]} />),
    ]
    for (const html of ciktilar) expect(html).not.toMatch(YASAKLI)
  })

  it('ülke raporu yasaklı ifade basmaz', () => {
    for (const r of [executive, marketing, producer]) {
      expect(renderToString(<CountryReportDocument report={r} countryName="Almanya" />)).not.toMatch(YASAKLI)
    }
  })
})

describe('WatchLists — tüm platformlar, afişler, Türkiye TV', () => {
  const charts = {
    netflix: { status: 'hesaplandi', yearAgo: null },
    lists: {
      now: [
        {
          rank: 3,
          seriesId: 7,
          name: 'Uzak Şehir',
          kind: 'series',
          weeksInList: 1,
          trend: 'yeni',
          platform: 'Shahid',
          posterPath: '/uzak.jpg',
        },
      ],
      top: [
        {
          seriesId: 8,
          name: 'Çukur',
          kind: 'series',
          periods: 2,
          bestRank: 4,
          lastDate: '2026-09-30',
          platforms: ['Netflix', 'Shahid'],
          posterPath: null,
        },
      ],
      window: { from: '2025-10-02', to: '2026-09-30', weeks: 52 },
    },
    turkeyTv: {
      date: '2026-08-23',
      items: [
        {
          rank: 1,
          seriesId: 9,
          name: 'Kızılcık Şerbeti',
          kind: 'series',
          weeksInList: 40,
          trend: '=',
          posterPath: '/kizilcik.jpg',
        },
      ],
    },
  }

  it('satırlarda platform ve afiş; afişi olmayan satırda yer tutucu', () => {
    const html = renderToString(<WatchLists charts={charts} />)
    expect(html).toContain('Shahid')
    expect(html).toContain('Netflix, Shahid')
    expect(html).toContain('https://image.tmdb.org/t/p/w92/uzak.jpg')
    expect(html).toContain('chart-list__poster--empty')
  })

  it('Türkiye TV son günü tarihiyle ayrı liste olarak görünür', () => {
    const html = renderToString(<WatchLists charts={charts} />)
    expect(html).toMatch(/Türkiye TV — (<!-- -->)?23 Ağu 2026/)
    expect(html).toContain('Kızılcık Şerbeti')
    expect(html).toContain('https://image.tmdb.org/t/p/w92/kizilcik.jpg')
  })

  it('TV zaten "şu an" listesindeyse ayrı Türkiye TV bloğu tekrar edilmez', () => {
    const tvNow = { ...charts, lists: { ...charts.lists, now: [{ ...charts.lists.now[0], platform: 'TV' }] } }
    expect(renderToString(<WatchLists charts={tvNow} />)).not.toContain('Türkiye TV —')
  })
})

describe('ChartList trend işaretleri (Spotify tarzı)', () => {
  const satir = (rank, trend) => ({ rank, seriesId: rank, name: `Dizi ${rank}`, kind: 'series', weeksInList: 2, trend })
  const html = renderToString(
    <ChartList items={[satir(1, '↑3'), satir(2, '↓2'), satir(3, '='), satir(4, 'yeni'), satir(5, 'tekrar')]} />
  )

  it('yükselen yeşil ▲, düşen kırmızı ▼ — sayı görünmez, yalnızca ipucunda; aynı kalan gri çizgi', () => {
    expect(html).toMatch(/chart-list__trend--up[^>]*aria-label="3 sıra yükseldi"[^>]*>▲</)
    expect(html).toMatch(/chart-list__trend--down[^>]*aria-label="2 sıra düştü"[^>]*>▼</)
    expect(html).not.toMatch(/>▲3|>▼2/)
    expect(html).toMatch(/chart-list__trend--same[^>]*>–</)
  })

  it('listeye giren ya da geri giren dizide rozet yok (YENİ/TEKRAR yanlış izlenim veriyordu)', () => {
    expect(html).not.toMatch(/YENİ|TEKRAR|chart-list__trend--new|chart-list__trend--reentry/)
    expect(html.match(/class="chart-list__trend[ "]/g)).toHaveLength(3) // yalnızca ▲ ▼ –
  })
})

describe('MagazineCarousel (dizilah düzeni)', () => {
  const haberler = [
    {
      title: 'Yalı Çapkını final yaptı',
      source: 'Sabah',
      link: 'https://www.sabah.com.tr/a',
      date: '2026-09-28T10:00:00.000Z',
      thumbnail: 'https://img.sabah.com.tr/a.jpg',
      about: 'dizi',
    },
    {
      title: 'Afra Saraçoğlu tatilde',
      source: 'Milliyet',
      link: 'https://www.milliyet.com.tr/b',
      date: null,
      about: 'Afra Saraçoğlu',
    },
    { title: 'Zararlı', source: 'X', link: 'javascript:alert(1)', date: null, about: 'dizi' },
  ]

  it('dizilah düzeni: solda tek büyük haber (görsel, tarih, başlık, özet), sağda haber listesi; haber açılmaz', () => {
    const html = renderToString(<MagazineCarousel items={visibleMagazineItems(haberler)} />)
    expect(html).toContain('aria-roledescription="carousel"')
    expect(html).toMatch(/<h3 class="magazine-carousel__title">Yalı Çapkını final yaptı<\/h3>/)
    expect(html).toContain('28 Eyl 2026')
    expect(html).toContain('Özet yükleniyor')
    // sağ liste: iki haber, etkin olan vurgulu ve dolum çubuklu
    expect((html.match(/class="magazine-carousel__item( magazine-carousel__item--active)?"/g) || []).length).toBe(2)
    expect(html).toMatch(/magazine-carousel__item--active"[^>]*aria-current="true"/)
    expect(html).toContain('magazine-carousel__fill')
    expect(html).toContain('Afra Saraçoğlu tatilde')
    expect(html).not.toContain('Zararlı')
    expect(html).not.toContain('Sabah')
    expect(html).not.toContain('href=')
  })

  it('tek haberde liste yok; haber yoksa boş durum metni', () => {
    const tek = renderToString(<MagazineCarousel items={visibleMagazineItems(haberler).slice(0, 1)} />)
    expect(tek).not.toContain('magazine-carousel__list')
    expect(renderToString(<MagazineCarousel items={[]} />)).toContain('güncel haber bulunamadı')
  })
})

describe('Arama İlgisi ve dizi sayfası birleşik (2026-10-06)', () => {
  it('Arama İlgisi sekmesinde tekli analiz dizi sayfasını açar; eski analiz ekranı ve dönüş düğmesi yok', () => {
    const html = renderToString(<TrendsExplorer onOpenSeries={() => {}} />)
    expect(html).toContain('Dizi sayfasını aç')
    expect(html).toContain('Kıyaslama Modu')
    expect(html).not.toContain('series-page__back')
    expect(html).not.toContain('Sorgula<')
  })

  const si = (over) => ({
    status: 'ready',
    error: null,
    result: {
      byCountry: [
        { country: 'TR', value: 100 },
        { country: 'AZ', value: 30 },
        { country: 'DE', value: 0 },
      ],
    },
    social: null,
    geo: null,
    series: { status: 'loading', timeline: null, insight: null, error: null },
    query: () => {},
    setGeo: () => {},
    queryGeoSeries: () => {},
    ...over,
  })

  it('kayıt yoksa ücretli sorgu yapılmaz, sorgu düğmesi gösterilir', () => {
    const html = renderToString(<SearchInterestSection si={si({ status: 'notCached', result: null })} />)
    expect(html).toContain('Arama ilgisini sorgula')
    expect(html).toContain('henüz sorgulanmadı')
    expect(html).not.toContain('Ülkelere göre ilgi')
  })

  it('kayıt varsa ülkeler bayrakla, ölçülen ülke sayısı ve harita düğmesi; eski ölçüm "Güncelle" ister', () => {
    const html = renderToString(
      <SearchInterestSection si={si({ result: { ...si().result, stale: true, cachedAt: Date.UTC(2026, 8, 1) } })} />
    ).replaceAll('<!-- -->', '')
    expect(html).toContain('Ülkelere göre ilgi')
    expect(html).toContain('2 ülkede ölçüldü')
    expect(html).toContain('Türkiye')
    expect(html).toContain('İlgiyi haritada göster')
    expect(html).toContain('Güncelle')
    expect(html).toContain('id="arama-ilgisi"')
  })
})

describe('Raporlar menüsü ve dizi raporu bölümleri', () => {
  it('yönetici olmayan kullanıcıda küresel görünüm sekmesi yok; ülke seçilmeden yönlendirme metni', () => {
    const html = renderToString(<ReportsHub isAdmin={false} tab="kuresel" onChange={() => {}} />)
    expect(html).not.toContain('Küresel görünüm')
    expect(html).toContain('Ülke brifingi')
    expect(html).toContain('Dizi raporu')
    expect(html).toContain('Brifingini görmek istediğiniz ülkeyi seçin')
    expect(renderToString(<ReportsHub isAdmin tab="ulke" onChange={() => {}} />)).toContain('Küresel görünüm')
  })

  it('seçim yapılmadan hızlı seçim kartları: izlenmesi en yüksek ülkeler ve öne çıkan diziler', () => {
    const countries = [
      { iso2: 'TR', seriesCount: 90, watchSignal: { index: 99, level: 'Çok yüksek' }, seriesList: [] },
      {
        iso2: 'SA',
        name: 'Suudi Arabistan',
        seriesCount: 40,
        watchSignal: { index: 80, level: 'Yüksek' },
        topSeries: { id: 1, name: 'Uzak Şehir' },
        seriesList: [{ id: 1, name: 'Uzak Şehir', posterPath: '/a.jpg', popularity: 5 }],
      },
      {
        iso2: 'DE',
        name: 'Almanya',
        seriesCount: 30,
        watchSignal: null,
        seriesList: [
          { id: 1, name: 'Uzak Şehir', posterPath: '/a.jpg', popularity: 5 },
          { id: 2, name: 'Gupi', posterPath: null, popularity: 9 },
        ],
      },
    ]
    const ulke = renderToString(<ReportsHub tab="ulke" countries={countries} onChange={() => {}} />).replaceAll(
      '<!-- -->',
      ''
    )
    expect(ulke).toContain('İzlenmesi en yüksek ülkeler')
    expect(ulke.indexOf('Suudi Arabistan')).toBeLessThan(ulke.indexOf('Almanya')) // endeksli ülke önce
    expect(ulke).not.toMatch(/quick-pick__name"><[^>]*>Türkiye/) // kaynak ülke önerilmez
    expect(ulke).toContain('40 dizi yayında')
    const dizi = renderToString(<ReportsHub tab="dizi" countries={countries} onChange={() => {}} />).replaceAll(
      '<!-- -->',
      ''
    )
    expect(dizi).toContain('Öne çıkan diziler')
    expect(dizi.indexOf('Uzak Şehir')).toBeLessThan(dizi.indexOf('Gupi')) // en popüler olduğu ülke sayısı önce
    expect(dizi).toContain('1 ülkede en popüler')
    expect(dizi).toContain('1 ülkede yayında')
  })

  it('ülkelere göre sıralama ve fırsat pazarları tabloları', () => {
    const m = renderToString(
      <SeriesMarketsSection
        data={{
          rows: [{ iso2: 'BH', position: 1, trend: '↑2', weeks: 3, bestPosition: 1 }],
          countriesNow: 1,
          countries52: 1,
        }}
      />
    ).replaceAll('<!-- -->', '')
    expect(m).toContain('Bahreyn')
    expect(m).toContain('3 hafta')
    expect(m).toContain('chart-list__trend--up')
    const o = renderToString(
      <SeriesOpportunitySection
        data={{
          rows: [],
          shared: [{ lang: 'ar', languageName: 'Arapça', views: 211706, countries: ['SA'] }],
          total: 1,
        }}
      />
    )
    expect(o).toContain('Arapça')
    expect(o).toContain('Ortak dillerde')
  })
})
