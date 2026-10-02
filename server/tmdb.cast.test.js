import { describe, it, expect } from 'vitest'
import { rankCast, toCastMember, mainCast, FULL_CAST_MAX } from './tmdb.js'

// TMDB /aggregate_credits biçimi: oyuncu başına toplam bölüm ve rol(ler).
const oyuncu = (id, name, eps, order, roles = [{ character: `Rol ${id}`, episode_count: eps }]) => ({
  id,
  name,
  total_episode_count: eps,
  order,
  profile_path: `/p${id}.jpg`,
  roles,
})

describe('rankCast — tüm sezonlar, bölüm sayısına göre', () => {
  it('çok bölümde oynayan önce; eşitlikte TMDB sırası (başroller önde)', () => {
    const sirali = rankCast([oyuncu(3, 'Konuk', 2, 0), oyuncu(2, 'İkinci', 98, 1), oyuncu(1, 'Başrol', 98, 0)])
    expect(sirali.map((c) => c.name)).toEqual(['Başrol', 'İkinci', 'Konuk'])
  })
})

describe('toCastMember', () => {
  it('karakter en çok bölümde oynadığı rolden; bölüm sayısı korunur', () => {
    const c = toCastMember(
      oyuncu(7, 'Burak Özçivit', 194, 0, [
        { character: 'Kısa rol', episode_count: 3 },
        { character: 'Osman Bey', episode_count: 191 },
      ])
    )
    expect(c).toEqual({ id: 7, name: 'Burak Özçivit', character: 'Osman Bey', profilePath: '/p7.jpg', episodes: 194 })
  })
})

describe('mainCast — ana kadro', () => {
  it('bölümlerin en az %15inde oynayanlar; tek bölümlük konuklar dışarıda', () => {
    const kadro = [
      ...Array.from({ length: 10 }, (_, i) => oyuncu(i + 1, `Ana ${i + 1}`, 100 - i, i)),
      oyuncu(50, 'Yan rol', 20, 50),
      oyuncu(51, 'Konuk', 1, 51),
      oyuncu(52, 'Kısa konuk', 10, 52),
    ]
    const ana = mainCast(kadro)
    expect(ana.map((c) => c.name)).toContain('Yan rol') // 20/100 ≥ %15
    expect(ana.map((c) => c.name)).not.toContain('Konuk')
    expect(ana.map((c) => c.name)).not.toContain('Kısa konuk') // 10/100 < %15
    expect(ana[0].name).toBe('Ana 1')
  })

  it('az kişi eşiği geçiyorsa en az 8 kişi gösterilir; üst sınır FULL_CAST_MAX', () => {
    const kucuk = [oyuncu(1, 'Tek', 8, 0), ...Array.from({ length: 9 }, (_, i) => oyuncu(i + 2, `K${i}`, 1, i + 1))]
    expect(mainCast(kucuk)).toHaveLength(8)
    const buyuk = Array.from({ length: 200 }, (_, i) => oyuncu(i + 1, `O${i}`, 100, i))
    expect(mainCast(buyuk)).toHaveLength(FULL_CAST_MAX)
    expect(mainCast([])).toEqual([])
  })
})
