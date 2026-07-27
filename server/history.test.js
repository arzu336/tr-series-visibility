import { describe, it, expect } from 'vitest'
import { getTrend } from './history.js'

const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(n) {
  return Date.now() - n * DAY_MS
}

describe('getTrend', () => {
  it('hiç geçmiş yoksa uydurma bir yön göstermez', () => {
    const result = getTrend({}, 'TR', 100)
    expect(result.direction).toBe('yetersiz-veri')
    expect(result.changePct).toBeNull()
  })

  it('en eski kayıt 1 günden yeniyse yine yetersiz-veri der (MIN_WINDOW_MS)', () => {
    const history = { TR: [{ score: 100, capturedAt: daysAgo(0.5) }] }
    expect(getTrend(history, 'TR', 110).direction).toBe('yetersiz-veri')
  })

  it('%5 ve üzeri artışı "yükseliyor" olarak işaretler', () => {
    const history = { TR: [{ score: 100, capturedAt: daysAgo(8) }] }
    const result = getTrend(history, 'TR', 110)
    expect(result.direction).toBe('yükseliyor')
    expect(result.changePct).toBe(10)
    expect(result.windowDays).toBe(8)
  })

  it('%5 ve altı düşüşü "düşüyor" olarak işaretler', () => {
    const history = { TR: [{ score: 100, capturedAt: daysAgo(8) }] }
    const result = getTrend(history, 'TR', 90)
    expect(result.direction).toBe('düşüyor')
    expect(result.changePct).toBe(-10)
  })

  it('eşik aralığındaki (%5 altı) değişimi "sabit" sayar, yön uydurmaz', () => {
    const history = { TR: [{ score: 100, capturedAt: daysAgo(8) }] }
    const result = getTrend(history, 'TR', 102)
    expect(result.direction).toBe('sabit')
  })

  it('referans skor 0 ise bölme hatası yerine 0 değişim + sabit döner', () => {
    const history = { TR: [{ score: 0, capturedAt: daysAgo(8) }] }
    const result = getTrend(history, 'TR', 50)
    expect(result.changePct).toBe(0)
    expect(result.direction).toBe('sabit')
  })

  it('tam 7 günlük referans yoksa elde olan en eski kaydı kısmi pencere olarak kullanır', () => {
    const history = { TR: [{ score: 100, capturedAt: daysAgo(2) }] }
    const result = getTrend(history, 'TR', 120)
    expect(result.direction).toBe('yükseliyor')
    expect(result.windowDays).toBe(2)
  })

  it('7 günden eski birden fazla kayıt varsa 7 güne en yakın olanı referans alır', () => {
    const history = {
      TR: [
        { score: 50, capturedAt: daysAgo(20) },
        { score: 100, capturedAt: daysAgo(7) }, // hedeflenen referans bu olmalı
        { score: 150, capturedAt: daysAgo(1) },
      ],
    }
    const result = getTrend(history, 'TR', 110)
    // 100 -> 110 = +%10, 50 baz alınsaydı çok farklı bir sonuç çıkardı
    expect(result.changePct).toBe(10)
  })
})
