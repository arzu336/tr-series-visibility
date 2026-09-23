import { describe, it, expect } from 'vitest'
import { describePerCapita, formatTotalScore } from './perCapitaLabel.js'

describe('describePerCapita', () => {
  it('internet kullanıcısı paydasını ve yılını açıkça yazar', () => {
    const r = describePerCapita({ scorePerCapita: 6.4, perCapitaBasis: 'internet-kullanicisi', perCapitaYear: 2024, perCapitaReliable: true })
    expect(r.status).toBe('ready')
    expect(r.valueText).toBe('6,40')
    expect(r.denominatorText).toBe('milyon internet kullanıcısı başına (World Bank, 2024)')
  })

  it('nüfusa düşüldüğünde bunu gizlemez', () => {
    const r = describePerCapita({ scorePerCapita: 20, perCapitaBasis: 'nufus', perCapitaYear: 2023, perCapitaReliable: true })
    expect(r.denominatorText).toContain('milyon kişi (nüfus)')
    expect(r.denominatorText).toContain('2023')
  })

  it('küçük paydalı ülkede değeri gösterir AMA güvenilmez olarak işaretler', () => {
    const r = describePerCapita({ scorePerCapita: 9842.11, perCapitaBasis: 'internet-kullanicisi', perCapitaYear: 2024, perCapitaReliable: false })
    expect(r.status).toBe('unreliable')
    expect(r.valueText).toBe('9.842,11')
    expect(r.note).toMatch(/1 milyonun altında/)
  })

  it('demografisi olmayan ülkede değer uydurmaz', () => {
    const r = describePerCapita({ scorePerCapita: null, perCapitaBasis: null, perCapitaYear: null, perCapitaReliable: false })
    expect(r.status).toBe('unavailable')
    expect(r.valueText).toBeNull()
    expect(r.denominatorText).toBeNull()
  })

  it('alanlar hiç yoksa (eski önbellek / proxy ülke) çökmez', () => {
    expect(describePerCapita({}).status).toBe('unavailable')
    expect(describePerCapita(null).status).toBe('unavailable')
  })

  it('bilinmeyen payda anahtarını sessizce internet sanmaz', () => {
    const r = describePerCapita({ scorePerCapita: 1, perCapitaBasis: 'hane-sayisi', perCapitaYear: 2024, perCapitaReliable: true })
    expect(r.denominatorText).toContain('bilinmeyen payda')
  })

  it('yıl yoksa parantez içinde sadece kaynak kalır', () => {
    const r = describePerCapita({ scorePerCapita: 1, perCapitaBasis: 'nufus', perCapitaYear: null, perCapitaReliable: true })
    expect(r.denominatorText).toBe('milyon kişi (nüfus) başına (World Bank)')
  })
})

describe('formatTotalScore', () => {
  it('Türkçe biçimde en fazla 1 ondalık', () => {
    expect(formatTotalScore(1690.4567)).toBe('1.690,5')
    expect(formatTotalScore(500)).toBe('500')
  })
  it('eksik skorda tire döner', () => {
    expect(formatTotalScore(null)).toBe('—')
    expect(formatTotalScore(undefined)).toBe('—')
  })
})
