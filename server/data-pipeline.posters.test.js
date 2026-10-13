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
  it('tabii kataloğundaki dizilere tabii ülkelerinde tabii eklenir; tarama yokken TRT 1 + yedek liste', () => {
    const raw = () => ({
      series: [{ id: 1, broadcaster: 'TRT 1' }, { id: 2 }],
      providersById: { 1: { DE: { flatrate: [{ provider_name: 'Netflix' }] } }, 2: {} },
    })
    // Tarama yokken: TRT 1 yapımı + yedek ülke listesi.
    const yedek = applyTabiiAvailability(raw(), null)
    expect(yedek.providersById[1].PK.flatrate[0].provider_name).toBe('tabii')
    expect(yedek.providersById[2]).toEqual({})
    // Tarama varken: yalnızca tabii kataloğunda bulunan dizi, taranan ülkelerde.
    const r = applyTabiiAvailability(raw(), { countries: ['DE', 'PK'], matched: { 1: { url: 'u' } } })
    expect(Object.keys(r.providersById[1]).sort()).toEqual(['DE', 'PK'])
    expect(r.providersById[1].DE.flatrate.map((p) => p.provider_name)).toEqual(['Netflix', 'tabii'])
    expect(r.series[0].tabiiUrl).toBe('u')
    expect(r.providersById[2]).toEqual({})
  })
})
