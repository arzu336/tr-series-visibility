import { describe, it, expect, vi } from 'vitest'

vi.mock('./cache.js', () => ({ getCached: () => null, setCached: () => {} }))
const { fillMissingPosters, applyTabiiAvailability } = await import('./data-pipeline.js')

describe('fillMissingPosters — afişsiz dizilere yedek görsel', () => {
  it('önce aynı adlı kaydın afişi, yoksa backdrop; hiçbiri yoksa boş kalır', () => {
    const s = fillMissingPosters([
      { id: 277655, name: 'Gupi', posterPath: null },
      { id: 304413, name: 'Gupi', posterPath: '/gupi.jpg' },
      { id: 1, name: 'Yalnız Kapak', posterPath: null, backdropPath: '/kapak.jpg' },
      { id: 2, name: 'Usta', posterPath: null, backdropPath: null },
    ])
    expect(s.map((x) => x.posterPath)).toEqual(['/gupi.jpg', '/gupi.jpg', '/kapak.jpg', null])
  })
})

describe('applyTabiiAvailability — TRT 1 yapımları tabii ülkelerinde', () => {
  it('liste boşken hiçbir ülke eklenmez; doluyken yalnızca TRT 1 yapımlarına tabii eklenir', () => {
    const raw = () => ({
      series: [{ id: 1, broadcaster: 'TRT 1' }, { id: 2 }],
      providersById: { 1: { DE: { flatrate: [{ provider_name: 'Netflix' }] } }, 2: {} },
    })
    expect(applyTabiiAvailability(raw(), []).providersById[1]).toEqual({
      DE: { flatrate: [{ provider_name: 'Netflix' }] },
    })
    const r = applyTabiiAvailability(raw(), ['DE', 'PK'])
    expect(r.providersById[1].DE.flatrate.map((p) => p.provider_name)).toEqual(['Netflix', 'tabii'])
    expect(r.providersById[1].PK.flatrate.map((p) => p.provider_name)).toEqual(['tabii'])
    expect(r.providersById[2]).toEqual({})
  })
})
