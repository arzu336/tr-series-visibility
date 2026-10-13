import { describe, it, expect } from 'vitest'
import { trtBroadcaster } from './tmdb.js'

describe('TRT yapımı işareti', () => {
  it('yalnızca TRT/tabii ağlarında yayınlanan dizi', () => {
    expect(trtBroadcaster({ networks: ['TRT 1'], companies: ['Bozdağ Film'] })).toBe('TRT 1')
    expect(trtBroadcaster({ networks: ['tabii'], companies: [] })).toBe('tabii')
    expect(trtBroadcaster({ networks: ['TRT 1', 'TRT 2'], companies: [] })).toBe('TRT 1')
  })

  it('başka kanalda da yayınlanan dizi ancak yapımcı TRT ise', () => {
    expect(trtBroadcaster({ networks: ['Star TV', 'TRT 1', 'TV8'], companies: ['Karamel Yapım'] })).toBeNull()
    expect(trtBroadcaster({ networks: ['Show TV', 'TRT 1'], companies: ['TRT', 'A Yapım'] })).toBe('TRT 1')
  })

  it('TRT ağı yoksa ya da ağ bilgisi yoksa', () => {
    expect(trtBroadcaster({ networks: ['atv'], companies: ['Bozdağ Film'] })).toBeNull()
    expect(trtBroadcaster({ networks: [], companies: ['TRT'] })).toBeNull()
    expect(trtBroadcaster({ networks: ['TRTX Tv'], companies: [] })).toBeNull()
  })

  it('iki kaynak örtüşürse (Wikidata TRT + TMDB ilk ağ TRT) başka kanalda da yayınlanan dizi TRT', () => {
    expect(trtBroadcaster({ networks: ['TRT 1', 'Exxen'], companies: [] }, { wikidataTrt: true })).toBe('TRT 1')
    expect(trtBroadcaster({ networks: ['Star TV', 'TRT 1'], companies: [] }, { wikidataTrt: true })).toBeNull()
    expect(trtBroadcaster({ networks: ['TRT 1', 'Exxen'], companies: [] })).toBeNull()
  })
})
