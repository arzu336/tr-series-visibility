import { describe, it, expect, vi } from 'vitest'

vi.mock('../data-pipeline.js', () => ({ getEnrichedVisibility: vi.fn() }))
vi.mock('./charts.js', () => ({ getAllOwnRankings: vi.fn() }))
const { selectSeriesPressCountries } = await import('./newsScanTargets.js')

describe('selectSeriesPressCountries — dizinin basın ülkeleri', () => {
  it('önce sıralamaya girdiği ülkeler (en iyi sıra), sonra izlenebildiği ülkeler (görünürlüğe göre); TR yok', () => {
    const rankings = new Map([
      ['MX', { all: [{ seriesId: 7, bestPosition: 3, weeks: 2 }] }],
      ['ES', { all: [{ seriesId: 7, bestPosition: 1, weeks: 5 }] }],
      ['TR', { all: [{ seriesId: 7, bestPosition: 1, weeks: 9 }] }],
      ['DE', { all: [{ seriesId: 8, bestPosition: 1, weeks: 9 }] }],
    ])
    const yayin = { flatrate: [{ provider_id: 8 }] }
    const out = selectSeriesPressCountries({
      seriesId: 7,
      rankings,
      providersForSeries: { FR: yayin, IT: yayin, MX: yayin, AR: { rent: [{}] } },
      countryScores: new Map([
        ['FR', 10],
        ['IT', 50],
      ]),
      limit: 4,
    })
    expect(out).toEqual(['ES', 'MX', 'IT', 'FR'])
  })
})
