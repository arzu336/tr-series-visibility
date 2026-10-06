import { describe, it, expect } from 'vitest'
import {
  buildSeriesMarkets,
  buildSeriesAvailability,
  buildSeriesOpportunity,
  buildSeriesPress,
  buildSeriesContent,
  buildSeriesSummary,
  buildSeriesReport,
  SERIES_CHAPTERS,
  SERIES_SECTION_TITLES,
} from './seriesReport.js'

const own = (current, all) => ({ to: '2026-10-05', current, all })

describe('buildSeriesMarkets — ülke ülke kendi sıralamamız', () => {
  it('bu hafta listede olanlar önce (sıraya göre), sonra en çok hafta kalınanlar', () => {
    const rankings = new Map([
      ['SA', own([{ seriesId: 7, position: 3, trend: '↑1' }], [{ seriesId: 7, weeks: 2, bestPosition: 1 }])],
      ['BH', own([{ seriesId: 7, position: 1, trend: null }], [{ seriesId: 7, weeks: 1, bestPosition: 1 }])],
      ['DE', own([], [{ seriesId: 7, weeks: 9, bestPosition: 4 }])],
      ['FR', own([], [{ seriesId: 8, weeks: 3, bestPosition: 2 }])],
    ])
    const s = buildSeriesMarkets(7, rankings)
    expect(s.data.rows.map((r) => r.iso2)).toEqual(['BH', 'SA', 'DE'])
    expect(s.data).toMatchObject({ countriesNow: 2, countries52: 3 })
    expect(s.data.rows[2]).toEqual({ iso2: 'DE', position: null, trend: null, weeks: 9, bestPosition: 4 })
    expect(buildSeriesMarkets(99, rankings).status).toBe('hesaplanamaz')
  })
})

describe('buildSeriesAvailability — platformlara göre', () => {
  it('yalnızca abonelik/ücretsiz; platform başına ülkeler; kiralık sayılmaz', () => {
    const s = buildSeriesAvailability({
      DE: { flatrate: [{ provider_name: 'Netflix' }] },
      FR: { flatrate: [{ provider_name: 'Netflix' }], free: [{ provider_name: 'Pluto TV' }] },
      US: { rent: [{ provider_name: 'Apple TV' }] },
    })
    expect(s.data.countryCount).toBe(2)
    expect(s.data.platforms[0]).toEqual({ name: 'Netflix', countries: ['DE', 'FR'] }) // Türkçe ada göre sıralı
    expect(s.data.platforms.map((p) => p.name)).toEqual(['Netflix', 'Pluto TV'])
    expect(s.data.available.sort()).toEqual(['DE', 'FR'])
    expect(buildSeriesAvailability({}).status).toBe('hesaplanamaz')
    // sıralamaya girdiği ama platform kaydı olmayan ülke yayında sayılır
    const l = buildSeriesAvailability({ DE: { flatrate: [{ provider_name: 'Netflix' }] } }, ['SA', 'DE'])
    expect(l.data).toMatchObject({ countryCount: 2, listedOnly: ['SA'] })
    expect(l.data.available.sort()).toEqual(['DE', 'SA'])
  })
})

describe('buildSeriesOpportunity — ilgi var, yayında değil', () => {
  const diller = (lang) =>
    ({
      bg: { regional: false, iso: ['BG'] },
      ar: { regional: true, iso: ['SA', 'EG', 'TR'] },
      hu: { regional: false, iso: ['HU'] },
    })[lang]

  it('yayında olmayan ülkeler; ülkeye özgü diller önce; Türkiye ve yayında olanlar çıkar', () => {
    const s = buildSeriesOpportunity(
      [
        { lang: 'ar', languageName: 'Arapça', views: 9000 },
        { lang: 'bg', languageName: 'Bulgarca', views: 500 },
        { lang: 'hu', languageName: 'Macarca', views: 800 },
      ],
      ['HU', 'EG'],
      diller
    )
    expect(s.data.rows.map((r) => r.iso2)).toEqual(['BG'])
    expect(s.data.shared).toEqual([{ lang: 'ar', languageName: 'Arapça', views: 9000, countries: ['SA'] }])
    expect(s.data.total).toBe(2)
  })
})

describe('buildSeriesPress / buildSeriesContent', () => {
  it('yetersiz veri satırları ayıklanır; inceleme düzeltmesi önce gelir', () => {
    const s = buildSeriesPress([
      { country_iso2: 'DE', dominant_sentiment: 'olumlu', total_news_count: 4 },
      { country_iso2: 'FR', dominant_sentiment: 'yetersiz-veri', total_news_count: 0 },
      { country_iso2: 'IT', dominant_sentiment: 'olumsuz', override_sentiment: 'olumlu', total_news_count: 9 },
    ])
    expect(s.data.items.map((i) => [i.iso2, i.tone])).toEqual([
      ['IT', 'olumlu'],
      ['DE', 'olumlu'],
    ])
    expect(s.data.positiveCount).toBe(2)
  })

  it('içerik: Türkçe ad ve harfsiz hâli uluslararası adlarda yok; hiçbir şey yoksa hesaplanamaz', () => {
    const c = buildSeriesContent({
      theme: 'tarih',
      destinations: ['bursa'],
      crew: { directors: [{ name: 'Ahmet Yılmaz' }], writers: [] },
      localized: [
        { region: 'DE', title: 'Kurulus: Osman' },
        { region: 'US', title: 'Establishment: Osman' },
        { region: 'GB', title: 'Establishment: Osman' },
      ],
      name: 'Kuruluş: Osman',
    })
    expect(c.data.akas).toEqual([{ title: 'Establishment: Osman', regions: ['US', 'GB'] }])
    expect(c.data.directors).toEqual(['Ahmet Yılmaz'])
    expect(buildSeriesContent({ name: 'X' }).status).toBe('hesaplanamaz')
  })
})

describe('buildSeriesSummary', () => {
  it('dört gösterge ve kural tabanlı cümleler (öneri yok)', () => {
    const s = buildSeriesSummary({
      seriesMarkets: {
        status: 'hesaplandi',
        data: { rows: [{ iso2: 'BH', position: 1, weeks: 1, bestPosition: 1 }], countriesNow: 1, countries52: 4 },
      },
      seriesAvailability: { status: 'hesaplandi', data: { countryCount: 22, platforms: [{}, {}], available: [] } },
      seriesOpportunity: {
        status: 'hesaplandi',
        data: { rows: [{ iso2: 'BG', languageName: 'Bulgarca', views: 1 }], total: 27 },
      },
      seriesImdb: { status: 'hesaplandi', data: { rating: 6.4, votes: 3489, growth7: { votes: 120, days: 7 } } },
    })
    expect(s.kpis.map((k) => [k.key, k.value])).toEqual([
      ['available', '22 ülke'],
      ['rankedNow', '1 ülke'],
      ['opportunity', '27 ülke'],
      ['rating', '6,4'],
    ])
    expect(s.kpis[3].trend).toBe('up')
    expect(s.sentences.map((x) => x.text)).toEqual([
      'Bu hafta 1 ülkede sıralamada; en iyi yeri Bahreyn (1.).',
      'İlgi olup yayında olmadığı 27 ülke var; ülkeye özgü dillerde en yüksek okunma Bulgaristan (Bulgarca).',
      'İzleyici puanı 6,4 (3.489 oy); son 7 günde 120 yeni oy.',
    ])
  })
})

describe('buildSeriesReport — bütünlük', () => {
  const deps = {
    getEnrichedVisibility: async () => ({
      raw: {
        series: [{ id: 7, name: 'Uzak Şehir', posterPath: '/p.jpg' }],
        providersById: { 7: { DE: { flatrate: [{ provider_name: 'Netflix' }] } } },
      },
    }),
    getAllOwnRankings: async () =>
      new Map([['SA', own([{ seriesId: 7, position: 2, trend: null }], [{ seriesId: 7, weeks: 1, bestPosition: 2 }])]]),
    readLanguageRows: () => [],
    getImdb: async () => ({ status: 'unavailable' }),
    getSeriesEnrichment: () => null,
    readPressRows: () => [],
    readClassification: () => ({ theme: null, destinations: [] }),
    now: () => new Date('2026-10-06T10:00:00Z'),
  }

  it('başlıklar sabit sırada; boş bölüm gösterilmez, ek yok; katalogda olmayan dizi null', async () => {
    const r = await buildSeriesReport(7, { useCache: false, deps })
    expect(r.contract).toBe('dizi-raporu-v1')
    expect(r.seriesName).toBe('Uzak Şehir')
    expect(r.chapters.map((c) => c.key)).toEqual(['izleniyor', 'erisim'])
    expect(r.appendix).toBeUndefined()
    const brand = /GDELT|Google|TMDB|JustWatch|Wikipedia|Vikipedi|YİGM|IMDb|FlixPatrol|Netflix Top|SerpA/
    expect(JSON.stringify({ ...r, chapters: [] })).not.toMatch(brand)
    expect(await buildSeriesReport(999, { useCache: false, deps })).toBeNull()
  })

  it('her bölümün başlığı var', () => {
    for (const k of SERIES_CHAPTERS.flatMap((c) => c.sections)) expect(SERIES_SECTION_TITLES[k], k).toBeTruthy()
  })
})
