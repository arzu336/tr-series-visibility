import { describe, it, expect } from 'vitest'
import { pearsonCorrelation, confidenceInterval95, differenceInDifferences } from './impact.js'

describe('pearsonCorrelation', () => {
  it('tam pozitif ilişkide r = 1 döner', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 5)
  })

  it('tam negatif ilişkide r = -1 döner', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 5)
  })

  it('y sabitse (varyans yok) 0/0 yerine 0 döner — NaN sızdırmaz', () => {
    expect(pearsonCorrelation([1, 2, 3], [5, 5, 5])).toBe(0)
  })
})

describe('confidenceInterval95', () => {
  it('n < 4 iken null döner (istatistiksel olarak anlamsız örneklem)', () => {
    expect(confidenceInterval95(0.8, 3)).toBeNull()
  })

  it('gerçek r değerini güven aralığının içinde tutar', () => {
    const ci = confidenceInterval95(0.6, 30)
    expect(ci).not.toBeNull()
    expect(ci.low).toBeLessThan(0.6)
    expect(ci.high).toBeGreaterThan(0.6)
  })

  it('örneklem büyüdükçe aralık daralır (daha az belirsizlik)', () => {
    const narrow = confidenceInterval95(0.6, 200)
    const wide = confidenceInterval95(0.6, 10)
    expect(narrow.high - narrow.low).toBeLessThan(wide.high - wide.low)
  })
})

describe('differenceInDifferences', () => {
  it('kontrol ülkenin ortak etkisini doğru çıkarır', () => {
    const result = differenceInDifferences({
      treatmentBefore: 100,
      treatmentAfter: 120,
      controlBefore: 100,
      controlAfter: 110,
    })
    expect(result.treatmentChangePct).toBe(20)
    expect(result.controlChangePct).toBe(10)
    // Dizi trendine atfedilebilecek gerçek fark: (120-100) - (110-100) = 10
    expect(result.didEstimate).toBe(10)
  })

  it('before = 0 iken yüzde hesaplamaz (bölme hatası yerine null)', () => {
    const result = differenceInDifferences({
      treatmentBefore: 0,
      treatmentAfter: 50,
      controlBefore: 100,
      controlAfter: 110,
    })
    expect(result.treatmentChangePct).toBeNull()
    expect(result.controlChangePct).toBe(10)
  })
})
