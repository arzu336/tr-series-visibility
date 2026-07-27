import { describe, it, expect } from 'vitest'
import { trendLabel } from './trend.js'

describe('trendLabel', () => {
  it('yetersiz veri olduğunda uydurma bir yön göstermez', () => {
    const result = trendLabel({ direction: 'yetersiz-veri', changePct: null, windowDays: null })
    expect(result.className).toBe('trend--neutral')
    expect(result.icon).toBe('•')
    expect(result.text).toMatch(/yetersiz veri/i)
  })

  it('trend hiç yoksa (null) da uydurma bir yön göstermez', () => {
    const result = trendLabel(null)
    expect(result.className).toBe('trend--neutral')
  })

  it('yükseliş için doğru ikon/sınıf/işaret verir', () => {
    const result = trendLabel({ direction: 'yükseliyor', changePct: 12.3, windowDays: 7 })
    expect(result.icon).toBe('▲')
    expect(result.className).toBe('trend--up')
    expect(result.pct).toBe('+12.3')
    expect(result.text).toContain('+12.3%')
    expect(result.text).toContain('7 gün')
  })

  it('düşüş için doğru ikon/sınıf/işaret verir', () => {
    const result = trendLabel({ direction: 'düşüyor', changePct: -8.5, windowDays: 5 })
    expect(result.icon).toBe('▼')
    expect(result.className).toBe('trend--down')
    // negatif değer zaten "-" işaretini taşıyor, önüne ikinci bir "+" eklenmemeli
    expect(result.pct).toBe('-8.5')
  })

  it('sabit trend için doğru ikon/sınıf verir', () => {
    const result = trendLabel({ direction: 'sabit', changePct: 1.2, windowDays: 7 })
    expect(result.icon).toBe('→')
    expect(result.className).toBe('trend--flat')
  })
})
