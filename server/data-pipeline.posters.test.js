import { describe, it, expect, vi } from 'vitest'

vi.mock('./cache.js', () => ({ getCached: () => null, setCached: () => {} }))
const { fillMissingPosters } = await import('./data-pipeline.js')

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
