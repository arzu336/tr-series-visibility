import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import ErrorBoundary from './ErrorBoundary.jsx'
import CountryLeaderboard from './CountryLeaderboard.jsx'
import { HybridScoreTag } from './MediaSentimentCard.jsx'
import SeriesPanel from './SeriesPanel.jsx'
import CountryPanel, { WatchLists } from './CountryPanel.jsx'
import CountryReportDocument from './report/CountryReportDocument.jsx'
import CountryReportView from './report/CountryReportView.jsx'
import ProfilePicker from './report/ProfilePicker.jsx'
import { TourismCorrelation, LeadingSignalSection } from './TourismImpactTab.jsx'
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

  it('SeriesPanel dizi bulunamazsa mesaj basar', () => {
    expect(renderToString(<SeriesPanel seriesId={99} allCountries={[]} />)).toContain('veri bulunamadı')
  })

  it('SeriesPanel dizi varsa adını basar', () => {
    const allCountries = [{ iso2: 'DE', score: 10, seriesList: [{ id: 1, name: 'Terzi', cast: [] }] }]
    expect(renderToString(<SeriesPanel seriesId={1} allCountries={allCountries} />)).toContain('Terzi')
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

// --- Ülke raporu (FAZ B) — sunucu sözleşmesi ulke-raporu-v1; üç profil, SSR ile ------------------
const PROFILE_TITLES = {
  executive: 'Yönetici özeti',
  marketing: 'Pazarlama raporu',
  producer: 'Yapımcı / dağıtımcı raporu',
}
const ok = (key, title, data, extra = {}) => ({ key, title, status: 'hesaplandi', data, note: `${key} notu`, ...extra })
const yok = (key, title, reason) => ({ key, title, status: 'hesaplanamaz', reason, note: `${key} notu` })

function rapor(profile, sections) {
  const order = Object.keys(sections)
  return {
    iso2: 'DE',
    profile,
    profileTitle: PROFILE_TITLES[profile],
    generatedAt: '2026-09-30T08:00:00.000Z',
    isTracked: true,
    dataCutoffs: {
      visibilityUpdatedAt: '2026-09-30T07:00:00.000Z',
      netflixLastWeek: '2025-10-19',
      demographicsYear: 2024,
    },
    sections,
    sectionOrder: order,
    dataGaps: order
      .filter((k) => sections[k].status === 'hesaplanamaz')
      .map((k) => ({ section: k, title: sections[k].title, reason: sections[k].reason })),
    contract: 'ulke-raporu-v1',
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

describe('Ülke raporu — üç profil SSR', () => {
  it('yönetici özeti: başlık, profil adı, veri kesimleri ve dört bölüm başlığı', () => {
    const html = renderToString(<CountryReportDocument report={executive} countryName="Almanya" />)
    expect(html).toContain('Almanya')
    expect(html).toContain('Yönetici özeti')
    for (const t of ['İzlenme düzeyi ve yayın varlığı', 'Ülkeler arası izlenme sırası', 'Trend', 'Öne çıkan bulgular'])
      expect(html).toContain(t)
    expect(html).toContain('Netflix')
    expect(html).toContain('3 dizi · 21 hafta')
    expect(html).toContain('23. / 111')
    expect(html).toContain('yerel adla dağıtılmış') // linear-tv uyarısı raporda da görünür
    expect(html).toContain('yükseliyor')
    expect(html).toContain('Bu profildeki tüm bölümler hesaplandı')
    expect(html).toContain('report__doc--executive')
    expect(html).not.toContain('İletişim Başkanlığı')
  })

  it('pazarlama: hesaplanamayan bölüm "Veri yok" + nedenini basar ve eksik veri kutusuna düşer', () => {
    const html = renderToString(<CountryReportDocument report={marketing} countryName="Almanya" />)
    for (const t of [
      'Ülkede en çok ilgi gören diziler',
      'Tema dağılımı',
      'Arama ilgisi (son 12 ay)',
      'Basın tonu',
      'Veriye göre öne çıkan diziler',
    ]) {
      expect(html).toContain(t)
    }
    expect(html).toContain('Veri yok.')
    expect(html).toContain('analiz edilmiş basın taraması yok')
    expect(html).toContain('Eksik veri')
    expect(html).toContain('arama payı faktörü önbellekte olmadığı için dışlandı')
    expect(html).toMatch(/Metodoloji:.*topSeries notu/)
    expect(html).toMatch(/Sorgulanmamış:.*Eşref Rüya/)
  })

  it('yapımcı: bölümler sectionOrder sırasıyla; benzer ülkeler ad + gerekçe + deneysel, benzerlik sayısı yok', () => {
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

  it('istemci sıralamayı belirlemez: sectionOrder dışındaki bölüm basılmaz, bilinmeyen anahtar çökmez', () => {
    const r = {
      ...executive,
      sectionOrder: ['findings', 'scores', 'bilinmeyen'],
      sections: { ...executive.sections, bilinmeyen: ok('bilinmeyen', 'Yeni bölüm', {}) },
    }
    const html = renderToString(<CountryReportDocument report={r} countryName="Almanya" />)
    expect(html.indexOf('Öne çıkan bulgular')).toBeLessThan(html.indexOf('İzlenme düzeyi ve yayın varlığı'))
    expect(html).not.toContain('Ülkeler arası izlenme sırası')
    expect(html).toContain('Bu bölüm için görünüm tanımlı değil')
  })

  it('ProfilePicker: erişilemeyen profil pasif ve nedenini yazar; klavye için radio rolü', () => {
    const profiles = [
      { id: 'executive', title: 'Yönetici özeti', minAccess: 'viewer', allowed: true },
      { id: 'marketing', title: 'Pazarlama raporu', minAccess: 'analyst', allowed: false },
      { id: 'producer', title: 'Yapımcı / dağıtımcı raporu', minAccess: 'admin', allowed: false },
    ]
    const html = renderToString(<ProfilePicker profiles={profiles} value="executive" onChange={() => {}} />)
    expect(html).toContain('role="radiogroup"')
    expect(html.match(/role="radio"/g)).toHaveLength(3)
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('Erişim yok — Analist ve üstü')
    expect(html).toContain('Erişim yok — Yalnızca yönetici')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toContain('profile-card--locked')
  })

  it('CountryReportView ilk render: profiller yüklenirken çökmez, düğmeler etiketli', () => {
    const html = renderToString(<CountryReportView iso2="DE" countryName="Almanya" onBack={() => {}} />)
    expect(html).toContain('Profiller yükleniyor')
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

  it('rapor: Netflix "yayımlamıyor" ve "kısmi indirme" nedenleri Veri yok ile ayrı ayrı basılır', () => {
    const r = rapor('producer', {
      netflixHistory: yok('netflixHistory', 'Netflix Top 10 geçmişi', EMPTY.netflixNotPublished),
    })
    const html = renderToString(<CountryReportDocument report={r} countryName="Andorra" />)
    expect(html).toContain('Veri yok.')
    expect(html).toContain('Netflix bu ülke için Top 10 listesi yayımlamıyor; yayın varlığı bölümüne bakın')
    const r2 = rapor('producer', {
      netflixHistory: yok('netflixHistory', 'Netflix Top 10 geçmişi', EMPTY.netflixPartialDownload('PL', 'PH')),
    })
    expect(renderToString(<CountryReportDocument report={r2} countryName="Polonya" />)).toContain(
      'dosya PH ülkesinde kesildi'
    )
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

  it('etki analizi: bekleyen korelasyon rozeti ölçülebilir, "Gerçek Veri Bekleniyor" yok', () => {
    const html = renderToString(
      <TourismCorrelation
        pendingAnalysis={{
          status: 'gerçek-veri-bekleniyor',
          description: 'açıklama',
          requiredSources: ['YİGM'],
          monthsAvailable: 2,
          monthsRequired: 3,
          accumulatingLabel: EMPTY.correlationAccumulating(2, 3),
        }}
      />
    )
    expect(html).toContain('Aylık seri birikiyor: <!-- -->2<!-- -->/<!-- -->3<!-- --> ay')
    expect(html).not.toContain('Gerçek Veri Bekleniyor')
    expect(html).not.toContain('Model Hesaplamaya Hazır')
  })

  it('etki analizi: öncü sinyal boşken kapsamı yazar (N sunucudan), eski "henüz veri toplanmadı" yok', () => {
    const html = renderToString(
      <LeadingSignalSection leadingSignal={{ status: 'gerçek-veri-bekleniyor', scope: 15, signals: [] }} />
    )
    expect(html).toContain('görünürlükte ilk 15 ülke')
    expect(html).not.toContain('henüz veri toplanmadı')
    expect(renderToString(<LeadingSignalSection leadingSignal={null} />)).toContain('henüz sonuç üretmedi')
  })

  it('ülke paneli: proxy ülkede yayın geçmişi nedeni yazılır', () => {
    const country = { iso2: 'XX', name: 'Deneme', dataSource: 'proxy', searchInterestScore: 40, seriesList: [] }
    const html = renderToString(<CountryPanel country={country} allCountries={[country]} />)
    expect(html).toContain('görünürlük geçmişi yalnızca yayın verisi olan ülkeler için tutulur')
    expect(html).not.toContain('Görünürlük geçmişi tutulmuyor.')
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
      renderToString(<SeriesPanel seriesId={1} allCountries={[de]} />),
    ]
    for (const html of ciktilar) expect(html).not.toMatch(YASAKLI)
  })

  it('ülke raporu üç profilde de yasaklı ifade basmaz', () => {
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
