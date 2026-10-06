import { describe, it, expect } from 'vitest'
import {
  buildMarketsAndSeries,
  buildThemesSection,
  buildTurkishLearningSection,
  buildTravelSignalSection,
  buildReachSection,
  buildGlobalSummary,
  GLOBAL_CHAPTERS,
  GLOBAL_SECTION_TITLES,
} from './globalReport.js'

const own = (current, previousCount = 0) => ({ to: '2026-10-05', current, previousCount, all: [] })

describe('buildMarketsAndSeries — bu haftanın sıralamalarından', () => {
  const rankings = new Map([
    [
      'SA',
      own(
        [
          { seriesId: 1, name: 'Uzak Şehir', position: 1 },
          { seriesId: 2, name: 'Gupi', position: 4 },
        ],
        2
      ),
    ],
    ['IL', own([{ seriesId: 2, name: 'Gupi', position: 2 }])],
    ['TR', own([{ seriesId: 3, name: 'Yerli', position: 1 }], 1)], // kaynak ülke sayılmaz
    ['DE', own([], 1)],
  ])
  const { globalMarkets, globalSeries } = buildMarketsAndSeries(rankings)

  it('ülke başına Türk dizisi sayısı; Türkiye dışarıda; geçen hafta sayısı', () => {
    expect(globalMarkets.data.rows).toEqual([
      { iso2: 'SA', count: 2, top: 'Uzak Şehir' },
      { iso2: 'IL', count: 1, top: 'Gupi' },
    ])
    expect(globalMarkets.data).toMatchObject({ countryCount: 2, previousCountryCount: 2 })
  })

  it('dizi başına ülke sayısı ve en iyi yeri', () => {
    expect(globalSeries.data.rows[0]).toEqual({
      seriesId: 2,
      name: 'Gupi',
      countryCount: 2,
      bestCountry: 'IL',
      best: 2,
    })
    expect(globalSeries.data.rows.map((r) => r.name)).not.toContain('Yerli')
  })
})

describe('bölümler', () => {
  it('tema: "diğer" çıkar, pay popülerliğe göre', () => {
    const s = buildThemesSection([
      { theme: 'aşk', seriesCount: 10, totalPopularity: 60 },
      { theme: 'diğer', seriesCount: 5, totalPopularity: 40 },
    ])
    expect(s.data.rows).toEqual([{ theme: 'aşk', seriesCount: 10, sharePct: 60 }])
  })

  it('Türkçe öğrenme: tek terimde ölçülen ülke ve Türkiye gösterilmez', () => {
    const s = buildTurkishLearningSection(
      {
        queried_at: '2026-09-08',
        by_country: JSON.stringify([
          { country: 'CY', value: 100, matchedTermCount: 1 },
          { country: 'PK', value: 67.5, matchedTermCount: 2 },
          { country: 'TR', value: 55, matchedTermCount: 3 },
        ]),
      },
      { total: 3986179, changePct: 0.4 }
    )
    expect(s.data.items).toEqual([{ iso2: 'PK', value: 68 }])
    expect(s.data.learners.total).toBe(3986179)
  })

  it('erken seyahat ilgisi: ülke başına en güçlü değer; anlamlılık alanı taşınmaz (keşif amaçlı)', () => {
    const s = buildTravelSignalSection({
      status: 'gerçek-veri-mevcut',
      signals: [
        { iso2: 'DE', correlation: 0.2, lagWeeks: 16, sampleSize: 36, topSeriesName: 'A', significant: true },
        { iso2: 'DE', correlation: -0.5, lagWeeks: 16, sampleSize: 36, topSeriesName: 'A', significant: true },
      ],
    })
    expect(s.data.rows).toEqual([{ iso2: 'DE', seriesName: 'A', r: -0.5, weeks: 36 }])
    expect(JSON.stringify(s.data)).not.toContain('significant')
  })

  it('yayın erişimi: yalnızca yayın verisi olan ülkeler; erişimi artanlar', () => {
    const s = buildReachSection([
      { iso2: 'DE', dataSource: 'tmdb', seriesCount: 60, score: 9, trend: { direction: 'yükseliyor', changePct: 12 } },
      { iso2: 'XX', dataSource: 'proxy', seriesCount: 0, score: 1 },
    ])
    expect(s.data).toMatchObject({ countryCount: 1, rising: [{ iso2: 'DE', changePct: 12 }] })
  })
})

describe('buildGlobalSummary', () => {
  it('dört gösterge, yön okları ve kural tabanlı cümleler', () => {
    const { globalMarkets, globalSeries } = buildMarketsAndSeries(
      new Map([['SA', own([{ seriesId: 1, name: 'Uzak Şehir', position: 1 }], 0)]])
    )
    const s = buildGlobalSummary(
      { globalMarkets, globalSeries },
      { students: { year: 2023, total: 298543, baseYear: 2018, changePct: 145 } }
    )
    expect(s.kpis.map((k) => [k.key, k.value, k.trend])).toEqual([
      ['ranked', '1 ülke', 'up'],
      ['reach', '—', null],
      ['students', '298.543', 'up'],
      ['press', '—', null],
    ])
    expect(s.sentences.map((x) => x.basis)).toEqual(['markets', 'series', 'students'])
  })

  it('her bölümün başlığı var', () => {
    for (const k of GLOBAL_CHAPTERS.flatMap((c) => c.sections)) expect(GLOBAL_SECTION_TITLES[k], k).toBeTruthy()
  })
})
