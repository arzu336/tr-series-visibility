import { describe, it, expect } from 'vitest'
import {
  buildImpactChart,
  tourismFacts,
  exportFacts,
  seriesExportFacts,
  insightKey,
  acceptInsight,
  ensureImpactInsight,
  readImpactInsight,
} from './impactInsight.js'

const ok = (value, extra = {}) => ({ status: 'hesaplandi', value, ...extra })

describe('impactInsight — grafik verisi', () => {
  it('son 36 ay; okunma anahtara göre eşlenir, yoksa null; 6 aydan azsa null', () => {
    const primary = Array.from({ length: 40 }, (_, i) => ({
      year: 2023 + Math.floor(i / 12),
      month: (i % 12) + 1,
      value: 100 + i,
    }))
    const reading = new Map([['2026-04', 55]])
    const c = buildImpactChart(primary, reading)
    expect(c).toHaveLength(36)
    expect(c[0].key).toBe('2023-05')
    expect(c.at(-1)).toEqual({ key: '2026-04', primary: 139, secondary: 55 })
    expect(c[0].secondary).toBeNull()
    expect(buildImpactChart(primary.slice(0, 4), reading)).toBeNull()
  })
})

describe('impactInsight — olgular', () => {
  it('turizm: yalnızca hesaplanan maddeler, Türkçe sayılar, kontrol ülkeleri adla', () => {
    const f = tourismFacts('Almanya', {
      arrivals: ok(123456, { latest: '2026-08' }),
      correlation: { status: 'hesaplanamaz' },
      didEstimate: ok(3.2, {
        window: '2025-08 → 2026-08',
        treatmentChangePct: 10.5,
        controlChangePct: 7.3,
        controls: [{ iso2: 'FR' }, { iso2: 'PL' }],
      }),
      leadingSignal: { status: 'hesaplanamaz' },
    })
    expect(f).toHaveLength(2)
    expect(f[0]).toContain('123.456')
    expect(f[1]).toContain('Fransa, Polonya')
    expect(f[1]).toContain('%10,5 arttı')
  })

  it('ihracat: son ay, korelasyon ve kıyas', () => {
    const f = exportFacts('Kazakistan', {
      latest: {
        year: 2026,
        month: 9,
        totalChangePct: 6.8,
        turkeyTotalChangePct: 15.1,
      },
      correlation: ok(0.28, { lagMonths: 5, sampleSize: 77, significant: false }),
      didEstimate: { status: 'hesaplanamaz' },
    })
    expect(f[0]).toMatch(
      /^Eyl 2026 ayında Türkiye'nin Kazakistan'a ihracatı .*%6,8 arttı; Türkiye'nin toplam ihracatı %15,1 arttı$/
    )
    expect(f).toHaveLength(2)
    expect(f.at(-1)).toContain('rastlantı olabilir')
  })

  it('dizi ihracatı: başlık + en çok 6 ülke; veri yoksa boş', () => {
    const d = {
      year: 2026,
      month: 9,
      avgChangePct: -1.2,
      turkeyChangePct: 19.8,
      countries: Array.from({ length: 8 }, (_, i) => ({
        iso2: `C${i}`,
        name: `Ülke${i}`,
        relatedChangePct: i,
        totalChangePct: null,
      })),
    }
    const f = seriesExportFacts('Siyah Kalp', d)
    expect(f).toHaveLength(7)
    expect(f[0]).toContain('8 ülkeye')
    expect(seriesExportFacts('X', { countries: [] })).toEqual([])
  })
})

describe('impactInsight — önbellek ve süzgeç', () => {
  it('anahtar olgulara göre değişir', () => {
    expect(insightKey('export', 'DE', ['a'])).not.toBe(insightKey('export', 'DE', ['b']))
    expect(insightKey('export', 'DE', ['a'])).toBe(insightKey('export', 'DE', ['a']))
  })

  it('direktif, kurum adı ve nedensellik iddiası reddedilir; sade gözlem kabul', () => {
    expect(
      acceptInsight(
        'İhracat bu dönemde benzer ülkelere göre daha iyi seyretti; korelasyon zayıf olduğundan rastlantı olabilir.'
      )
    ).toBeTruthy()
    expect(
      acceptInsight('Pazarlama hızlandırılmalıdır ve stratejiler geliştirilmelidir çünkü ihracat düştü.')
    ).toBeNull()
    expect(acceptInsight('TÜİK verisine göre ihracat %5 arttı ve bu dönemde benzerlerinden iyi seyretti.')).toBeNull()
    expect(acceptInsight('Diziler sayesinde ihracat arttı ve ülke benzerlerinden iyi seyretti.')).toBeNull()
    expect(acceptInsight('kısa')).toBeNull()
  })

  it('ensure: üretir, kaydeder, ikinci çağrı modeli çağırmaz; geçici hata kaydedilmez', async () => {
    const facts = [`olgu ${Date.now()}`]
    let calls = 0
    const generate = async () => {
      calls++
      return 'Bu dönemde ziyaretçi sayısı benzer ülkelere göre daha iyi seyretti; tek pencereye dayandığı için temkinli okunmalı.'
    }
    const t1 = await ensureImpactInsight('tourism', 'XX', 'Test', facts, { generate })
    const t2 = await ensureImpactInsight('tourism', 'XX', 'Test', facts, { generate })
    expect(t1).toBe(t2)
    expect(calls).toBe(1)
    expect(readImpactInsight('tourism', 'XX', facts)).toBe(t1)
    const facts2 = [`olgu2 ${Date.now()}`]
    const hata = await ensureImpactInsight('tourism', 'XY', 'Test', facts2, {
      generate: async () => {
        throw new Error('model yok')
      },
    })
    expect(hata).toBeNull()
    expect(readImpactInsight('tourism', 'XY', facts2)).toBeNull()
    // Süzgeçten geçmeyen çıktı: boş kayıt, bir daha denenmez
    let n = 0
    const red = await ensureImpactInsight('tourism', 'XZ', 'Test', [`olgu3 ${Date.now()}`], {
      generate: async () => {
        n++
        return 'Pazarlama hızlandırılmalıdır.'
      },
    })
    expect(red).toBeNull()
    expect(n).toBe(1)
  })
})
