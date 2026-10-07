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
  rankControlCountries: async () => [{ iso2: 'PL', reason: 'benzer GSYH' }],
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
    // DE %20, PL %10 → 10 yüzde puan.
    expect(r.didEstimate).toMatchObject({
      status: 'hesaplandi',
      value: 10,
      unit: 'yuzde-puan',
      window: '2024-07 → 2025-07',
      treatmentChangePct: 20,
      controlChangePct: 10,
      controls: [{ iso2: 'PL', reason: 'benzer GSYH', changePct: 10 }],
    })
    hicNaNYok(r)
  })

  it('kontrol grubu: benzer ülkelerin yüzde değişimlerinin ortalaması; aynı ayda verisi olmayan atlanır', async () => {
    const seriler = {
      ...Object.fromEntries(['DE', 'PL'].map((i) => [i, seri(i)])),
      CZ: [
        { year: 2024, month: 7, visitorCount: 200 },
        { year: 2025, month: 7, visitorCount: 260 },
      ],
      AT: [{ year: 2025, month: 7, visitorCount: 900 }],
    }
    const r = await buildTourismDimension(
      'DE',
      { score: 500 },
      {
        ...deps,
        getVisitorSeries: (i) => seriler[i] || [],
        rankControlCountries: async () => [{ iso2: 'AT' }, { iso2: 'PL' }, { iso2: 'CZ' }],
      }
    )
    // PL %10, CZ %30 → ortalama %20; DE %20 → fark 0 puan. AT'nin 2024-07 verisi yok.
    expect(r.didEstimate).toMatchObject({ status: 'hesaplandi', value: 0, controlChangePct: 20 })
    expect(r.didEstimate.controls.map((c) => c.iso2)).toEqual(['PL', 'CZ'])
  })

  it('korelasyon: ülkenin dili ortak dilse (okunma ülkeye ayrılamaz) nedeniyle hesaplanamaz', async () => {
    const r = await buildTourismDimension(
      'DE',
      { score: 500 },
      { ...deps, readingSeriesFor: () => ({ langs: [], series: new Map() }) }
    )
    expect(r.didEstimate.status).toBe('hesaplandi')
    expect(r.correlation.status).toBe('hesaplanamaz')
    expect(r.correlation.reason).toMatch(/birden çok ülkede konuşuluyor/)
  })

  it('korelasyon: ortak ay yetersizse kaç ay olduğu ve gereken sayı söylenir', async () => {
    const okuma = () => ({
      langs: ['de'],
      series: new Map([
        ['2023-07', 10],
        ['2024-07', 12],
        ['2025-07', 15],
      ]),
    })
    const r = await buildTourismDimension('DE', { score: 500 }, { ...deps, readingSeriesFor: okuma })
    expect(r.correlation.status).toBe('hesaplanamaz')
    expect(r.correlation.reason).toMatch(/yeterli ortak ay yok/)
    expect(r.correlation).toMatchObject({ monthsRequired: 24 })
  })

  it('korelasyon: yeterli ortak ayda gecikme, ay sayısı ve anlamlılıkla hesaplanır; NaN yok', async () => {
    const ay = (y, m) => `${y}-${String(m).padStart(2, '0')}`
    const okunma = new Map()
    const turist = []
    let x = 1
    for (let y = 2016; y <= 2026; y++)
      for (let m = 1; m <= 12; m++) {
        x = (x * 16807) % 2147483647
        const sok = (x / 2147483647 - 0.5) * 0.6
        okunma.set(ay(y, m), 1000 * (1 + sok))
        turist.push({ year: y, month: m, visitorCount: Math.round(5000 * (1 + sok * 0.9)) })
      }
    const r = await buildTourismDimension(
      'DE',
      { score: 500 },
      {
        ...deps,
        getVisitorSeries: (iso2) => (iso2 === 'DE' ? turist : seri(iso2)),
        readingSeriesFor: () => ({ langs: ['de'], series: okunma }),
      }
    )
    expect(r.correlation.status).toBe('hesaplandi')
    expect(r.correlation).toMatchObject({
      lagMonths: 0,
      unit: 'pearson-r',
      significant: true,
      method: 'okunma-yillik-degisim',
    })
    expect(r.correlation.value).toBeGreaterThan(0.9)
    expect(r.correlation.sampleSize).toBeGreaterThanOrEqual(24)
    hicNaNYok(r)
  })

  it('seri yoksa üç boyut da hesaplanamaz', async () => {
    const r = await buildTourismDimension('XX', { score: 1 }, deps)
    expect(r.arrivals.status).toBe('hesaplanamaz')
    expect(r.correlation.status).toBe('hesaplanamaz')
    expect(r.didEstimate.status).toBe('hesaplanamaz')
    expect(r.sources[0].source).toBe('yigm')
  })

  it('kontrol ülkesi bulunamazsa DiD hesaplanamaz, arrivals yine gelir', async () => {
    const r = await buildTourismDimension('DE', { score: 500 }, { ...deps, rankControlCountries: async () => [] })
    expect(r.arrivals.status).toBe('hesaplandi')
    expect(r.didEstimate).toMatchObject({ status: 'hesaplanamaz', reason: 'kontrol ülkesi eşleştirilemedi' })
  })

  it('kontrol ülkesinin serisi yoksa gerekçesiyle hesaplanamaz', async () => {
    const r = await buildTourismDimension(
      'DE',
      { score: 500 },
      { ...deps, rankControlCountries: async () => [{ iso2: 'ZZ' }] }
    )
    expect(r.didEstimate.reason).toMatch(/\(ZZ\) hiçbirinde aynı aylar için turist serisi yok/)
  })

  it('kontrol ülkesi servisi fırlatırsa çökmez', async () => {
    const r = await buildTourismDimension(
      'DE',
      { score: 500 },
      {
        ...deps,
        rankControlCountries: async () => {
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
    expect(r.reason).toBe('CA için 2 dizi tarandı, yeterli haber bulunamadı')
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
