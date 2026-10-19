import { describe, it, expect } from 'vitest'
import {
  buildLatestExports,
  buildExportCorrelation,
  buildExportDid,
  buildExportSignal,
  buildSeriesExports,
  last12Pair,
} from './exportImpact.js'

const yoy = (iso2, scale = 1) => ({
  year: 2026,
  month: 9,
  rows: [
    { sector: 'TOPLAM', cur: 1000 * scale, prev: 800 * scale },
    { sector: 'Halı', cur: 100 * scale, prev: 50 * scale },
    { sector: 'Hazırgiyim ve Konfeksiyon', cur: 200 * scale, prev: 200 * scale },
    { sector: 'Çelik', cur: 700 * scale, prev: 550 * scale },
  ],
  iso2,
})

// 36 ay: başlangıç 2023-10, her ay +1 (t), eğimli; `mult` ile ülke farkı
const months = (n, f) =>
  Array.from({ length: n }, (_, i) => ({ year: 2023 + Math.floor((9 + i) / 12), month: ((9 + i) % 12) + 1, usd: f(i) }))

describe('exportImpact — son ay', () => {
  it('toplam değişimi ve Türkiye geneli kıyası; toplam satırı yoksa null', () => {
    const l = buildLatestExports(yoy('DE'), yoy('ALL', 100))
    expect(l).toEqual({ year: 2026, month: 9, totalUsd: 1000, totalChangePct: 25, turkeyTotalChangePct: 25 })
    expect(buildLatestExports(null, null)).toBeNull()
    expect(buildLatestExports({ year: 2026, month: 9, rows: [{ sector: 'Halı', cur: 1, prev: 1 }] }, null)).toBeNull()
  })
})

describe('exportImpact — korelasyon ve 12 aylık pencere', () => {
  it('ortak dil yoksa ya da yeterli ay yoksa hesaplanamaz; yeterliyse r döner', () => {
    expect(buildExportCorrelation({ langs: [], series: new Map() }, []).status).toBe('hesaplanamaz')
    const few = buildExportCorrelation(
      { langs: ['de'], series: new Map([['2026-01', 10]]) },
      months(3, () => 5)
    )
    expect(few.status).toBe('hesaplanamaz')
    expect(few.monthsRequired).toBeGreaterThan(0)
    // 60 ay, iki seri birlikte dalgalanıyor (pandemi yılları dışında)
    const reading = new Map()
    const exportsSeries = []
    for (let i = 0; i < 72; i++) {
      const y = 2019 + Math.floor(i / 12)
      const m = (i % 12) + 1
      const v = 100 + 10 * Math.sin(i / 2) + i
      reading.set(`${y}-${String(m).padStart(2, '0')}`, v)
      exportsSeries.push({ year: y, month: m, usd: 1000 + 100 * Math.sin(i / 2) + 5 * i })
    }
    const c = buildExportCorrelation({ langs: ['de'], series: reading }, exportsSeries)
    expect(c.status).toBe('hesaplandi')
    expect(typeof c.value).toBe('number')
    expect(c.unit).toBe('pearson-r')
  })

  it('last12Pair: son 12 ay ve önceki 12 ay; hizalanan aya göre; eksik ay varsa null', () => {
    const s = months(30, (i) => 10 + i)
    const p = last12Pair(s)
    expect(p.to).toBe('2026-03')
    expect(p.after - p.before).toBe(144) // 12 ay × 12 artış
    expect(last12Pair(s, '2026-01').to).toBe('2026-01')
    expect(last12Pair(s.slice(0, 20))).toBeNull()
    expect(last12Pair(s.filter((_, i) => i !== 15))).toBeNull()
  })

  it('DiD: benzer ülkelerin ortalamasına göre yüzde puan farkı', async () => {
    const seri = {
      DE: months(30, (i) => 100 + 10 * i),
      PL: months(30, (i) => 100 + 2 * i),
      AT: months(30, (i) => 100 + 4 * i),
    }
    const d = await buildExportDid(
      'DE',
      (iso2) => seri[iso2] || [],
      async () => [{ iso2: 'PL', reason: 'bölge' }, { iso2: 'AT' }, { iso2: 'ZZ' }]
    )
    expect(d.status).toBe('hesaplandi')
    expect(d.controls.map((c) => c.iso2)).toEqual(['PL', 'AT'])
    expect(d.value).toBeCloseTo(d.treatmentChangePct - d.controlChangePct, 1)
    expect(d.window).toMatch(/→/)
    const yok = await buildExportDid(
      'DE',
      (iso2) => seri[iso2] || [],
      async () => [{ iso2: 'ZZ' }]
    )
    expect(yok.status).toBe('hesaplanamaz')
  })
})

describe('exportImpact — bölümler', () => {
  it('ülke: ihracat kaydı yoksa hesaplanamaz; varsa latest + correlation + didEstimate', async () => {
    const deps = {
      getSectorYoy: (iso2) => (iso2 === 'ALL' ? yoy('ALL', 100) : iso2 === 'DE' ? yoy('DE') : null),
      getTotalSeries: () => [],
      readingSeriesFor: () => ({ langs: [], series: new Map() }),
      rankControlCountries: async () => [],
    }
    expect((await buildExportSignal('XX', deps)).status).toBe('hesaplanamaz')
    const s = await buildExportSignal('DE', deps)
    expect(s.status).toBe('hesaplandi')
    expect(s.data.latest.totalChangePct).toBe(25)
    expect(s.data.correlation.status).toBe('hesaplanamaz')
    expect(s.data.didEstimate.status).toBe('hesaplanamaz')
    const marka = /TİM|TIM|Comtrade|TÜİK/
    expect(JSON.stringify(s)).not.toMatch(marka)
  })

  it('dizi: pazarlarındaki ihracat değişimi, ortalama ve Türkiye geneli', () => {
    const deps = {
      getSectorYoy: (iso2) => (iso2 === 'ALL' ? yoy('ALL', 100) : yoy(iso2, iso2 === 'DE' ? 1 : 2)),
      getExportIso2s: () => new Set(['DE', 'FR']),
    }
    const r = buildSeriesExports(['DE', 'FR', 'TR', 'ZZ'], deps)
    expect(r.countries.map((c) => c.iso2).sort()).toEqual(['DE', 'FR'])
    expect(r.avgChangePct).toBe(25)
    expect(r.turkeyChangePct).toBe(25)
    expect(r).toMatchObject({ year: 2026, month: 9 })
    expect(buildSeriesExports(['ZZ'], deps)).toBeNull()
  })
})
