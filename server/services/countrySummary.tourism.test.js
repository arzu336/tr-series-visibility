import { describe, it, expect } from 'vitest'
import { buildTourismDimension, leadingSignalFor, basinTonu } from './countrySummary.js'

// Regresyon: buildTourismDimension, tourismData.js'in camelCase sözleşmesini (visitorCount,
// düz sayı before/after) snake_case/nesne sanıyordu → undefined - undefined = NaN, ve bu NaN
// `status: 'hesaplandi'` etiketiyle rapora giriyordu. Bu dosya sözleşmeyi ve "sayısal olmayan
// hiçbir değer 'hesaplandi' olamaz" kuralını kilitler.

const seri = (iso2) =>
  ({
    DE: [
      { year: 2023, month: 7, visitorCount: 900 },
      { year: 2024, month: 7, visitorCount: 1000 },
      { year: 2025, month: 7, visitorCount: 1200 },
    ],
    PL: [
      { year: 2024, month: 7, visitorCount: 500 },
      { year: 2025, month: 7, visitorCount: 550 },
    ],
  })[iso2] || []

// tourismData.pickBeforeAfterPair'in gerçek çıktı şekli.
const cift = (s) => {
  if (!s || s.length < 2) return null
  const sorted = [...s].sort((a, b) => a.year - b.year)
  const after = sorted[sorted.length - 1]
  const before = sorted[sorted.length - 2]
  return {
    before: before.visitorCount,
    after: after.visitorCount,
    beforeYear: before.year,
    afterYear: after.year,
    month: before.month,
  }
}

// tourismCorrelation.differenceInDifferences'ın gerçek çıktı şekli.
const did = ({ treatmentBefore, treatmentAfter, controlBefore, controlAfter }) => {
  const t = treatmentAfter - treatmentBefore
  const c = controlAfter - controlBefore
  return {
    didEstimate: t - c,
    treatmentChangePct: (t / treatmentBefore) * 100,
    controlChangePct: (c / controlBefore) * 100,
  }
}

const oncul = () => ({ status: 'hesaplanamaz', reason: 'test' })

const deps = {
  getVisitorSeries: seri,
  pickBeforeAfterPair: cift,
  suggestControlCountry: async () => ({ iso2: 'PL', reason: 'benzer GSYH' }),
  differenceInDifferences: did,
  leadingSignalFor: oncul,
}

function hicNaNYok(obj) {
  const json = JSON.stringify(obj, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? 'NAN_BULUNDU' : v))
  expect(json).not.toContain('NAN_BULUNDU')
  // JSON.stringify NaN'ı zaten null yapar; ayrıca "hesaplandi" olan her değer sonlu sayı olmalı.
  for (const boyut of Object.values(obj)) {
    if (boyut && boyut.status === 'hesaplandi') expect(Number.isFinite(boyut.value)).toBe(true)
  }
}

describe('buildTourismDimension — gerçek sözleşmeyle', () => {
  it('son ay ziyaretçisini ve DiD farkını doğru okur', async () => {
    const r = await buildTourismDimension('DE', { score: 500 }, deps)

    expect(r.arrivals).toMatchObject({ status: 'hesaplandi', value: 1200, monthCount: 3, latest: '2025-07' })
    // DE +200, PL +50 → DiD +150 ziyaretçi.
    expect(r.didEstimate).toMatchObject({
      status: 'hesaplandi',
      value: 150,
      controlIso2: 'PL',
      unit: 'ziyaretci-fark',
      window: '2024-07 → 2025-07',
      controlWindow: '2024-07 → 2025-07',
      treatmentChangePct: 20,
      controlChangePct: 10,
    })
    hicNaNYok(r)
  })

  it('korelasyon: ortak ay yokken "Aylık seri birikiyor: 0/3 ay" ile hesaplanamaz kalır', async () => {
    const r = await buildTourismDimension('DE', { score: 500 }, { ...deps, getMonthlyPeriods: () => [] })
    expect(r.didEstimate.status).toBe('hesaplandi')
    expect(r.correlation.status).toBe('hesaplanamaz')
    expect(r.correlation.reason).toMatch(/^Aylık seri birikiyor: 0\/3 ay/)
    expect(r.correlation).toMatchObject({ monthsAvailable: 0, monthsRequired: 3 })
  })

  it('korelasyon: ortak ay sayısı gerçek veriden sayılır (2/3), cari ay sayılmaz', async () => {
    const aylik = () => [
      { period: '2024-07', avgScore: 100, sampleCount: 5, isCurrent: false },
      { period: '2025-07', avgScore: 120, sampleCount: 5, isCurrent: false },
      { period: '2025-08', avgScore: 130, sampleCount: 2, isCurrent: true },
      { period: '2023-01', avgScore: 90, sampleCount: 5, isCurrent: false },
    ]
    const r = await buildTourismDimension('DE', { score: 500 }, { ...deps, getMonthlyPeriods: aylik })
    expect(r.correlation.status).toBe('hesaplanamaz')
    expect(r.correlation.reason).toMatch(/^Aylık seri birikiyor: 2\/3 ay/)
    expect(r.correlation.monthsAvailable).toBe(2)
  })

  it('korelasyon: 3+ ortak ayda Pearson hesaplanır', async () => {
    const aylik = () => [
      { period: '2023-07', avgScore: 90, sampleCount: 5, isCurrent: false },
      { period: '2024-07', avgScore: 100, sampleCount: 5, isCurrent: false },
      { period: '2025-07', avgScore: 120, sampleCount: 5, isCurrent: false },
      { period: '2025-08', avgScore: 130, sampleCount: 5, isCurrent: false }, // turist serisinde yok → sayılmaz
    ]
    const r = await buildTourismDimension('DE', { score: 500 }, { ...deps, getMonthlyPeriods: aylik })
    expect(r.correlation.status).toBe('hesaplandi')
    expect(r.correlation).toMatchObject({ sampleSize: 3, unit: 'pearson-r', months: ['2023-07', '2024-07', '2025-07'] })
    expect(r.correlation.value).toBeGreaterThan(0.9) // 900/1000/1200 ile 90/100/120 neredeyse doğrusal
    expect(Math.abs(r.correlation.value)).toBeLessThanOrEqual(1)
    hicNaNYok(r)
  })

  it('korelasyon: yayın varlığı ölçümü yoksa nedeni bunu söyler', async () => {
    const r = await buildTourismDimension('DE', { score: null }, { ...deps, getMonthlyPeriods: () => [] })
    expect(r.correlation.reason).toBe('bu ülke için yayın varlığı ölçümü yok')
  })

  it('seri yoksa üç boyut da hesaplanamaz', async () => {
    const r = await buildTourismDimension('XX', { score: 1 }, deps)
    expect(r.arrivals.status).toBe('hesaplanamaz')
    expect(r.correlation.status).toBe('hesaplanamaz')
    expect(r.didEstimate.status).toBe('hesaplanamaz')
    expect(r.sources[0].source).toBe('yigm')
  })

  it('kontrol ülkesi bulunamazsa DiD hesaplanamaz, arrivals yine gelir', async () => {
    const r = await buildTourismDimension('DE', { score: 500 }, { ...deps, suggestControlCountry: async () => null })
    expect(r.arrivals.status).toBe('hesaplandi')
    expect(r.didEstimate).toMatchObject({ status: 'hesaplanamaz', reason: 'kontrol ülkesi eşleştirilemedi' })
  })

  it('kontrol ülkesinin serisi yoksa gerekçesiyle hesaplanamaz', async () => {
    const r = await buildTourismDimension(
      'DE',
      { score: 500 },
      { ...deps, suggestControlCountry: async () => ({ iso2: 'ZZ' }) }
    )
    expect(r.didEstimate.reason).toMatch(/ZZ için turist serisi yok/)
  })

  it('kontrol ülkesi servisi fırlatırsa çökmez', async () => {
    const r = await buildTourismDimension(
      'DE',
      { score: 500 },
      {
        ...deps,
        suggestControlCountry: async () => {
          throw new Error('World Bank erişilemedi')
        },
      }
    )
    expect(r.didEstimate.status).toBe('hesaplanamaz')
    expect(r.didEstimate.reason).toMatch(/World Bank erişilemedi/)
  })

  it('tek yıllık seride önce/sonra çifti kurulamaz', async () => {
    const tek = () => [{ year: 2025, month: 7, visitorCount: 100 }]
    const r = await buildTourismDimension('DE', { score: 500 }, { ...deps, getVisitorSeries: tek })
    expect(r.arrivals.value).toBe(100)
    expect(r.didEstimate.reason).toMatch(/önce\/sonra çifti kurulamadı/)
  })
})

describe('buildTourismDimension — sözleşme bozulursa NaN sızmaz (asıl regresyon)', () => {
  it('eski snake_case varsayımıyla gelen çift → hesaplanamaz, NaN değil', async () => {
    const eskiCift = () => ({
      before: { visitor_count: 1000 },
      after: { visitor_count: 1200 },
      beforeYear: 2024,
      afterYear: 2025,
      month: 7,
    })
    const r = await buildTourismDimension('DE', { score: 500 }, { ...deps, pickBeforeAfterPair: eskiCift })
    expect(r.didEstimate.status).toBe('hesaplanamaz')
    expect(r.didEstimate.reason).toMatch(/sayısal olmayan/)
    hicNaNYok(r)
  })

  it('DiD düz sayı yerine nesne bekler; düz sayı gelirse hesaplanamaz', async () => {
    const r = await buildTourismDimension('DE', { score: 500 }, { ...deps, differenceInDifferences: () => 150 })
    expect(r.didEstimate.status).toBe('hesaplanamaz')
    hicNaNYok(r)
  })

  it('seri satırlarında visitorCount yoksa arrivals hesaplandi olamaz', async () => {
    const bozuk = () => [
      { year: 2024, month: 7, visitor_count: 1000 },
      { year: 2025, month: 7, visitor_count: 1200 },
    ]
    const r = await buildTourismDimension('DE', { score: 500 }, { ...deps, getVisitorSeries: bozuk })
    expect(r.arrivals.status).toBe('hesaplanamaz')
    expect(r.didEstimate.status).toBe('hesaplanamaz')
    hicNaNYok(r)
  })
})

describe('leadingSignalFor — kapsam metni', () => {
  it('tarama henüz sonuç üretmemişse bunu söyler', () => {
    const r = leadingSignalFor('DE', { status: 'gerçek-veri-bekleniyor', scope: 15, signals: [] })
    expect(r.status).toBe('hesaplanamaz')
    expect(r.reason).toMatch(/henüz sonuç üretmedi/)
  })

  it('kapsam dışı ülkede "Kapsam: görünürlükte ilk N ülke" yazar, N özetten gelir', () => {
    const r = leadingSignalFor('DE', {
      status: 'gerçek-veri-mevcut',
      scope: 15,
      signals: [{ iso2: 'FR', correlation: 0.2 }],
    })
    expect(r.reason).toBe('Kapsam: görünürlükte ilk 15 ülke; bu ülke tarama kapsamında değil')
  })

  it('kapsamdaki ülkede en güçlü korelasyon döner', () => {
    const r = leadingSignalFor('FR', {
      status: 'gerçek-veri-mevcut',
      scope: 15,
      signals: [
        { iso2: 'FR', correlation: 0.2, travelQuery: 'Antalya', lagWeeks: 16, sampleSize: 30, direction: 'pozitif' },
        { iso2: 'FR', correlation: -0.5, travelQuery: 'Istanbul', lagWeeks: 16, sampleSize: 30, direction: 'negatif' },
      ],
    })
    expect(r).toMatchObject({ status: 'hesaplandi', value: -0.5, travelQuery: 'Istanbul' })
  })
})

describe('basinTonu — hiç taranmamış ile taranmış-ama-haber-yok ayrımı', () => {
  it('hiç tarama yoksa: henüz yapılmadı + haftalık tarama kapsamı', () => {
    const r = basinTonu('DE', [])
    expect(r.status).toBe('hesaplanamaz')
    expect(r.reason).toMatch(
      /^DE için basın taraması henüz yapılmadı \(haftalık tarama görünürlükte ilk \d+ ülke × \d+ diziyle sınırlı/
    )
    expect(r).toMatchObject({ scanned: false, scanCount: 0 })
  })

  it('taranmış ama hepsi yetersiz-veri ise: N dizi tarandı, yeterli haber yok', () => {
    const taramalar = [
      { dominant_sentiment: 'yetersiz-veri', positive_score: null },
      { dominant_sentiment: 'yetersiz-veri', positive_score: null },
    ]
    const r = basinTonu('CA', taramalar)
    expect(r.reason).toBe("CA için 2 dizi tarandı, GDELT'te yeterli haber bulunamadı")
    expect(r).toMatchObject({ scanned: true, scanCount: 2 })
  })

  it('analizli tarama varsa ortalama olumlu yüzde hesaplanır', () => {
    const r = basinTonu('BR', [
      { dominant_sentiment: 'positive', positive_score: 0.6 },
      { dominant_sentiment: 'negative', positive_score: 0.2 },
      { dominant_sentiment: 'yetersiz-veri', positive_score: null },
    ])
    expect(r).toMatchObject({ status: 'hesaplandi', value: 40, sampleSize: 2 })
  })
})
