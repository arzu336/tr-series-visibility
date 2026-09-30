import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import ErrorBoundary from './ErrorBoundary.jsx'
import CountryLeaderboard from './CountryLeaderboard.jsx'
import { HybridScoreTag } from './MediaSentimentCard.jsx'
import SeriesPanel from './SeriesPanel.jsx'
import CountryPanel from './CountryPanel.jsx'
import CountryReportDocument from './report/CountryReportDocument.jsx'
import CountryReportView from './report/CountryReportView.jsx'
import ProfilePicker from './report/ProfilePicker.jsx'

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

  it('CountryPanel skor kartını ve kişi başına paydayı basar', () => {
    const country = {
      iso2: 'DE',
      name: 'Almanya',
      score: 500,
      seriesCount: 30,
      seriesList: [],
      dataSource: 'tmdb',
      scorePerCapita: 6.4,
      perCapitaBasis: 'internet-kullanicisi',
      perCapitaYear: 2024,
      perCapitaReliable: true,
    }
    const html = renderToString(<CountryPanel country={country} allCountries={[country]} />)
    expect(html).toContain('Kişi başına erişilebilirlik skoru')
    expect(html).toContain('6,40')
    expect(html).toContain('milyon internet kullanıcısı')
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

const scores = ok('scores', 'Görünürlük skoru', {
  score: 665.03,
  seriesCount: 50,
  scorePerCapita: 8.52,
  perCapitaBasis: 'internet-kullanicisi',
  perCapitaYear: 2024,
  perCapitaReliable: true,
  dominantTheme: 'aşk',
})

const executive = rapor('executive', {
  scores,
  ranking: ok('ranking', 'Ülkeler arası konum', {
    totalRank: 23,
    totalOf: 136,
    perCapitaRank: 92,
    perCapitaOf: 111,
    perCapitaExcludedReason: null,
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
    items: [{ text: 'Görünürlük skoru son 8 günde %32 arttı.', basis: 'trend' }],
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
    for (const t of ['Görünürlük skoru', 'Ülkeler arası konum', 'Trend', 'Öne çıkan bulgular'])
      expect(html).toContain(t)
    expect(html).toContain('Netflix')
    expect(html).toContain('2024')
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
      'Görünürlük skoru',
      'Yayın varlığı',
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
    expect(html.indexOf('Öne çıkan bulgular')).toBeLessThan(html.indexOf('Görünürlük skoru'))
    expect(html).not.toContain('Ülkeler arası konum')
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
