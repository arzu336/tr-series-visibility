import { describe, it, expect } from 'vitest'
import { generateFindings, candidateFindings, MAX_FINDINGS } from './reportFindings.js'
import { direktifIceriyorMu } from '../llm.js'

const ok = (data) => ({ status: 'hesaplandi', data })
const yok = { status: 'hesaplanamaz', reason: 'x' }

const TAM = {
  ranking: ok({ perCapitaRank: 3, perCapitaOf: 111, totalRank: 7, totalOf: 137 }),
  trend: ok({ shortTerm: { direction: 'yükseliyor', changePct: 12.4, windowDays: 7 } }),
  netflix: ok({
    rows: [
      { name: 'The Tailor', peakRank: 1, weeksInTop10: 21 },
      { name: 'Another Self', peakRank: 3, weeksInTop10: 4 },
    ],
  }),
  themes: ok({ items: [{ theme: 'aile', sharePct: 41.2 }] }),
  pressTone: ok({ mediaTone: { status: 'hesaplandi', value: 63.4, sampleSize: 9 } }),
}

describe('generateFindings — kural tabanlı, deterministik', () => {
  it('en fazla 3 bulgu, öncelik sırasıyla', () => {
    const { items, dropped } = generateFindings(TAM)
    expect(items).toHaveLength(MAX_FINDINGS)
    expect(items.map((f) => f.basis)).toEqual(['ranking', 'trend', 'netflix'])
    expect(items[0].text).toContain('111 ülke arasında 3. sırada')
    expect(items[1].text).toMatch(/%12 arttı/)
    expect(items[2].text).toMatch(/2 dizi Netflix Top 10'a girdi; en iyi sıra #1 \(The Tailor, 21 hafta\)/)
    expect(dropped).toBe(0)
  })

  it('aynı girdi aynı çıktıyı verir', () => {
    expect(generateFindings(TAM)).toEqual(generateFindings(TAM))
  })

  it('veri eksikse bulgu sayısı düşer, uydurmaz', () => {
    const { items } = generateFindings({ ranking: yok, trend: yok, netflix: yok, themes: TAM.themes, pressTone: yok })
    expect(items).toHaveLength(1)
    expect(items[0].basis).toBe('themes')
    expect(generateFindings({}).items).toEqual([])
  })

  it('hiçbir bulgu aksiyon önerisi içermez (iddia kapısı)', () => {
    for (const f of candidateFindings(TAM)) expect(direktifIceriyorMu(f.text)).toBeNull()
  })

  it('kişi başına sıralanamayan ülke için toplam sırayı ve gerekçeyi yazar', () => {
    const { items } = generateFindings({
      ranking: ok({ perCapitaRank: null, perCapitaOf: 111, totalRank: 40, totalOf: 137 }),
    })
    expect(items[0].text).toMatch(/137 ülke arasında 40\. sırada/)
    expect(items[0].text).toMatch(/küçük payda/)
  })

  it('trend yetersiz-veri ise trend bulgusu üretmez; sabit ise "sabit kaldı" der', () => {
    expect(
      generateFindings({ trend: ok({ shortTerm: { direction: 'yetersiz-veri', changePct: null } }) }).items
    ).toEqual([])
    const sabit = generateFindings({ trend: ok({ shortTerm: { direction: 'sabit', changePct: 1.2, windowDays: 8 } }) })
    expect(sabit.items[0].text).toMatch(/sabit kaldı/)
  })

  it('metinler 160 karakteri aşmaz', () => {
    const uzun = { ...TAM, netflix: ok({ rows: [{ name: 'X'.repeat(300), peakRank: 2, weeksInTop10: 1 }] }) }
    for (const f of candidateFindings(uzun)) expect(f.text.length).toBeLessThanOrEqual(160)
  })
})
