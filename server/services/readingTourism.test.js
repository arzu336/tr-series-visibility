import { describe, it, expect } from 'vitest'
import {
  yoyLogChanges,
  readingTourismCorrelation,
  effectiveSampleSize,
  detrendByPeriod,
  MIN_PAIRS,
} from './readingTourism.js'

const ay = (y, m) => `${y}-${String(m).padStart(2, '0')}`

// Belirlenimci sözde-rastgele (testler her çalıştırmada aynı)
function rastgele(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

/** 2016–2026 aylık seri: mevsimsellik × (1 + şok). */
function seri(soklar, { taban = 1000, mevsim = true } = {}) {
  const out = new Map()
  let i = 0
  for (let y = 2016; y <= 2026; y++)
    for (let m = 1; m <= 12; m++) {
      if (y === 2026 && m > 8) break
      const sezon = mevsim ? 1 + 0.5 * Math.sin(((m - 1) / 12) * 2 * Math.PI) : 1
      out.set(ay(y, m), taban * sezon * (1 + soklar[i++]))
    }
  return out
}

describe('yoyLogChanges', () => {
  it('geçen yılın aynı ayına göre log değişim; taban yoksa ay atlanır', () => {
    const s = new Map([
      ['2016-01', 100],
      ['2017-01', 200],
      ['2017-02', 50],
    ])
    const y = yoyLogChanges(s)
    expect(y.get('2017-01')).toBeCloseTo(Math.log(2))
    expect(y.has('2017-02')).toBe(false)
    expect(y.has('2016-01')).toBe(false)
  })
})

describe('detrendByPeriod', () => {
  it('her dönemde doğrusal eğilim çıkar; saf eğilim sıfırlanır', () => {
    const v = [1, 2, 3, 10, 20, 30]
    const p = ['a', 'a', 'a', 'b', 'b', 'b']
    const t = [1, 2, 3, 100, 101, 102]
    for (const x of detrendByPeriod(v, p, t)) expect(Math.abs(x)).toBeLessThan(1e-9)
  })
})

describe('effectiveSampleSize', () => {
  it('bağımsız seride n civarında, birlikte güçlü özilişkili serilerde çok daha küçük', () => {
    const r = rastgele(7)
    const a = Array.from({ length: 80 }, () => r() - 0.5)
    const b = Array.from({ length: 80 }, () => r() - 0.5)
    expect(effectiveSampleSize(a, b)).toBeGreaterThan(50)
    // yürüyen ortalama: güçlü özilişki
    const yuru = (x) => x.map((_, i) => x.slice(Math.max(0, i - 11), i + 1).reduce((s, v) => s + v, 0))
    expect(effectiveSampleSize(yuru(a), yuru(b))).toBeLessThan(25)
  })
})

describe('readingTourismCorrelation', () => {
  const r = rastgele(42)
  const sok = Array.from({ length: 128 }, () => (r() - 0.5) * 0.6)

  it('okunmadaki şok 2 ay sonra ziyaretçiye yansıyorsa: gecikme 2, güçlü pozitif ve anlamlı', () => {
    const okuma = seri(sok)
    const gecikmeli = [0, 0, ...sok.slice(0, -2)].map((x) => x * 0.9)
    const turist = seri(gecikmeli, { taban: 5000 })
    const c = readingTourismCorrelation(okuma, turist)
    expect(c.lagMonths).toBe(2)
    expect(c.r).toBeGreaterThan(0.8)
    expect(c.significant).toBe(true)
    expect(c.n).toBeGreaterThanOrEqual(MIN_PAIRS)
    expect(c.nEff).toBeLessThanOrEqual(c.n)
  })

  it('birbirinden bağımsız iki seride anlamlı ilişki bulunmaz', () => {
    const r2 = rastgele(99)
    const baska = Array.from({ length: 128 }, () => (r2() - 0.5) * 0.6)
    const c = readingTourismCorrelation(seri(sok), seri(baska, { taban: 5000 }))
    expect(c.significant).toBe(false)
  })

  it('ortak ay yetersizse r yok', () => {
    const kisa = new Map([...seri(sok)].slice(0, 20))
    expect(readingTourismCorrelation(kisa, seri(sok)).r).toBeNull()
  })
})
