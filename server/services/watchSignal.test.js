import { describe, it, expect } from 'vitest'
import {
  percentileRank,
  levelOf,
  confidenceOf,
  opportunityOf,
  computeWatchSignals,
  netflixFromRows,
  listsFromRows,
  wikiFromRows,
  searchFromRows,
  distributionFromRows,
  cutoffWeekBefore,
  reasonLine,
  pickNetflixMarkets,
  WEIGHTS,
  MIN_COMPONENTS,
} from './watchSignal.js'

const ulke = (iso2, seriesCount = 20, dataSource = 'tmdb') => ({ iso2, seriesCount, dataSource })

describe('percentileRank / levelOf / confidenceOf / opportunityOf', () => {
  it('yüzdelik: en düşük 0, en yüksek 100, eşitler ortalama sıra, tek eleman 50', () => {
    const p = percentileRank([
      ['A', 1],
      ['B', 5],
      ['C', 5],
      ['D', 9],
    ])
    expect(p.get('A')).toBe(0)
    expect(p.get('D')).toBe(100)
    expect(p.get('B')).toBeCloseTo(50)
    expect(p.get('C')).toBeCloseTo(50)
    expect(percentileRank([['X', 3]]).get('X')).toBe(50)
  })

  it('seviye sınırları beşlik: 80 Çok yüksek, 60 Yüksek, 40 Orta, 20 Düşük, altı Çok düşük; null → null', () => {
    expect(levelOf(80)).toBe('Çok yüksek')
    expect(levelOf(79.9)).toBe('Yüksek')
    expect(levelOf(60)).toBe('Yüksek')
    expect(levelOf(40)).toBe('Orta')
    expect(levelOf(20)).toBe('Düşük')
    expect(levelOf(19)).toBe('Çok düşük')
    expect(levelOf(null)).toBeNull()
  })

  it('güven: ≥3 bileşen + Netflix ya da tek dilli Wikipedia → yüksek; 2 → orta; 1 → düşük', () => {
    expect(confidenceOf([{ key: 'lists' }, { key: 'wiki', regional: true }, { key: 'search' }])).toBe('yüksek')
    expect(confidenceOf([{ key: 'wiki', regional: true }, { key: 'search' }, { key: 'press' }])).toBe('orta')
    expect(confidenceOf([{ key: 'wiki', regional: false }, { key: 'search' }, { key: 'press' }])).toBe('yüksek')
    expect(confidenceOf([{ key: 'lists' }, { key: 'search' }])).toBe('orta')
    expect(confidenceOf([{ key: 'search' }])).toBe('düşük')
    expect(confidenceOf([])).toBeNull()
  })

  it('fırsat matrisi 50/50 ve yayın verisi olmayan ülke etiketi', () => {
    expect(opportunityOf(70, 70, true)).toBe('Oturmuş pazar')
    expect(opportunityOf(70, 30, true)).toBe('Fırsat')
    expect(opportunityOf(30, 70, true)).toBe('Doymuş')
    expect(opportunityOf(30, 30, true)).toBe('Girilmemiş')
    expect(opportunityOf(50, 50, true)).toBe('Oturmuş pazar') // eşik dahil
    expect(opportunityOf(70, null, false)).toBe('Fırsat (yayın verisi yok)')
    expect(opportunityOf(null, 70, true)).toBe('İzlenme sinyali yok (yalnızca erişim verisi)')
    expect(opportunityOf(null, null, false)).toBe('İzlenme sinyali yok')
  })
})

describe('computeWatchSignals — ağırlıklar, eksik bileşen, en az 2 bileşen, Türkiye evren dışı', () => {
  const countries = [
    ulke('TR', 400),
    ulke('BG', 33),
    ulke('RS', 31),
    ulke('DE', 50),
    ulke('AD', 5),
    ulke('XK', 0, 'proxy'),
    ulke('JP', 24),
  ]
  const inputs = {
    countries,
    markets: new Set(['TR', 'BG', 'RS', 'DE', 'JP']),
    lists: new Map([
      ['TR', { series: 10, weeks: 200, points: 1500, bestRank: 1 }],
      ['BG', { series: 4, weeks: 11, points: 80, bestRank: 1 }],
      ['RS', { series: 4, weeks: 14, points: 100, bestRank: 1 }],
      // DE: pazar ama kayıt yok → 0 değerli bileşen (eksik değil)
    ]),
    wiki: new Map([
      ['BG', { value: 5000, regional: false, langs: ['bg'] }],
      ['RS', { value: 3000, regional: false, langs: ['sr'] }],
      ['DE', { value: 100, regional: true, langs: ['de*'] }],
      ['XK', { value: 200, regional: true, langs: ['sq*'] }],
    ]),
    search: new Map([
      ['BG', { hitShare: 0.8, meanValue: 4, seriesWithInterest: 8, seriesQueried: 10 }],
      ['DE', { hitShare: 0.5, meanValue: 2, seriesWithInterest: 5, seriesQueried: 10 }],
      ['XK', { hitShare: 0.3, meanValue: 7, seriesWithInterest: 3, seriesQueried: 10 }],
      ['AD', { hitShare: 0.1, meanValue: 1, seriesWithInterest: 1, seriesQueried: 10 }],
    ]),
    press: new Map([['RS', { news: 255, scans: 17 }]]),
    distribution: new Map([
      ['DE', { titles: 173 }],
      ['BG', { titles: 20 }],
      ['JP', { titles: 96 }], // IMDb kaydı var ama ilgi sinyali yok → uyarı olmamalı
    ]),
  }
  const r = computeWatchSignals(inputs)

  it('Türkiye evrende yok; endeks sinyali olan ülkeler arasında 0–100 yüzdelik', () => {
    expect(r.byIso2.TR).toBeUndefined()
    expect(r.meta.universe).toBe(6)
    const idx = Object.values(r.byIso2)
      .map((x) => x.index)
      .filter((x) => x != null)
    expect(Math.max(...idx)).toBe(100)
    expect(Math.min(...idx)).toBe(0)
  })

  it('en az 2 bileşen: yalnızca aramaya sahip AD endeks almaz ve tek-kaynak uyarısı taşır', () => {
    expect(r.byIso2.AD.index).toBeNull()
    expect(r.byIso2.AD.componentCount).toBe(1)
    expect(r.byIso2.AD.warnings.map((w) => w.code)).toContain('single-source')
    expect(r.byIso2.AD.opportunity).toBe('İzlenme sinyali yok (yalnızca erişim verisi)')
    expect(r.meta.indexed).toBe(4) // JP tek bileşenli (Netflix 0), endeks almaz
  })

  it('tek kaynaklı ülke endeks ve resmî düzey almaz; o kaynağın yüzdelik konumundan ayrı işaretli tahmini düzey taşır', () => {
    expect(r.byIso2.AD.level).toBeNull()
    expect(r.byIso2.AD.provisional).toMatchObject({ source: 'search' })
    expect(r.byIso2.AD.provisional.level).toBeTruthy()
    expect(r.byIso2.AD.provisional.index).toBeGreaterThanOrEqual(0)
    expect(r.byIso2.DE.provisional).toBeNull() // iki kaynaklı ülkede tahmin yok, gerçek düzey var
  })

  it('Netflix pazarında kayıt olmaması 0 değerli bileşendir; pazar dışı ülke için bileşen yok', () => {
    expect(r.byIso2.DE.components.lists).toMatchObject({ present: true, weeks: 0, p: 17 }) // DE ve JP 0 puan → ortalama sıra
    expect(r.byIso2.AD.components.lists.present).toBe(false)
    expect(r.byIso2.DE.reason).toMatch(/Listeler: son 52 haftada Türk dizisi yok/)
  })

  it('bölgesel Wikipedia ağırlığı yarıya iner ve uyarı üretir; tek dilli tam ağırlık', () => {
    expect(r.byIso2.DE.components.wiki.regional).toBe(true)
    expect(r.byIso2.DE.warnings.map((w) => w.code)).toContain('regional-wiki')
    expect(r.byIso2.BG.components.wiki.regional).toBe(false)
    // BG: netflix p=66,7 (80 puan; RS 100, DE=JP 0 → ortalama sıra), wiki p=100, search p=100
    expect(r.byIso2.BG.score).toBeCloseTo(0.5 * (200 / 3) + 0.3 * 100 + 0.2 * 100, 0)
    // DE: netflix p=16,7 (w .5), wiki bölgesel p=0 (w .15), search p=66,7 (w .2) → ağırlıklı ortalama
    expect(r.byIso2.DE.score).toBeCloseTo((0.5 * (100 / 6) + 0.2 * (200 / 3)) / 0.85, 0)
  })

  it('basın bileşeni ağırlık 0: açıklayıcı kalır, bileşen sayısına girmez', () => {
    expect(r.byIso2.RS.components.press).toMatchObject({ present: true, descriptive: true, news: 255 })
    expect(r.byIso2.RS.componentCount).toBe(2) // netflix + wiki
    expect(WEIGHTS.press).toBe(0)
    expect(MIN_COMPONENTS).toBe(2)
  })

  it('güven ve gerekçe satırı bileşen gerçeklerinden üretilir', () => {
    expect(r.byIso2.BG.confidence).toBe('yüksek')
    expect(r.byIso2.RS.confidence).toBe('orta')
    expect(r.byIso2.BG.reason).toMatch(
      /^Listeler: 4 dizi, 11 hafta, en iyi sıra 1; Okunma \(bg\) medyanın [\d,.]+ katı; arama ilgisi 10 diziden 8'inde ölçülebilir/
    )
  })

  it('proxy ülke (yayın verisi yok) endekse dahil, erişim null, etiket "yayın verisi yok"', () => {
    expect(r.byIso2.XK.index).not.toBeNull()
    expect(r.byIso2.XK.access).toBeNull()
    expect(r.byIso2.XK.opportunity).toMatch(/yayın verisi yok/)
  })

  it("lineer TV uyarısı: dağıtım güçlü + Netflix'ten 30 puan önde + ilgi sinyali var", () => {
    // DE: 173 yerel başlık (p=100), Netflix p≈17, arama p≈67 → uyarı
    expect(r.byIso2.DE.warnings.map((w) => w.code)).toContain('linear-tv')
    expect(r.byIso2.DE.warnings.find((w) => w.code === 'linear-tv').text).toMatch(/173 Türk dizisi yerel adla/)
    // BG: dağıtım p=0 → yok
    expect(r.byIso2.BG.warnings.map((w) => w.code)).not.toContain('linear-tv')
    // JP: dağıtım p=50 (<60) ve hiç ilgi sinyali yok → yok; ilgi koşulu tek başına da yeter
    expect(r.byIso2.JP.warnings.map((w) => w.code)).not.toContain('linear-tv')
    const r2 = computeWatchSignals({
      ...inputs,
      distribution: new Map([
        ['JP', { titles: 96 }],
        ['DE', { titles: 10 }],
      ]),
    })
    expect(r2.byIso2.JP.distribution.p).toBe(100)
    expect(r2.byIso2.JP.warnings.map((w) => w.code)).not.toContain('linear-tv')
  })

  it('ağırlıklar ve eşik parametreyle değişebilir (varsayılan 0,50/0,30/0,20/0)', () => {
    expect(r.meta.weights).toEqual({ lists: 0.5, wiki: 0.3, search: 0.2, press: 0 })
    const r2 = computeWatchSignals(inputs, { minComponents: 1 })
    expect(r2.byIso2.AD.index).not.toBeNull()
    const r3 = computeWatchSignals(inputs, { weights: { press: 0.1 } })
    expect(r3.byIso2.RS.componentCount).toBe(3)
  })
})

describe('girdi dönüştürücüler', () => {
  it('listsFromRows: Netflix haftalık + diğer listeler günlük haftaya toplanır; aynı hafta en iyi sıra bir kez sayılır', () => {
    const m = listsFromRows(
      [{ country_iso2: 'SA', week: '2026-09-27', tmdb_id: 1, rank: 4 }], // +7 gün → 2026-10-04 haftası
      [
        { country_iso2: 'SA', period_date: '2026-10-05', series_id: 1, rank: 2 }, // aynı hafta, daha iyi sıra
        { country_iso2: 'SA', period_date: '2026-10-06', series_id: 1, rank: 6 },
        { country_iso2: 'SA', period_date: '2026-10-06', series_id: 2, rank: 9 },
        { country_iso2: 'IQ', period_date: '2025-01-01', series_id: 3, rank: 1 }, // pencere dışı
      ],
      '2025-10-06'
    )
    expect(m.get('SA')).toEqual({ weeks: 2, points: 9 + 2, bestRank: 2, series: 2 })
    expect(m.has('IQ')).toBe(false)
  })

  it('netflixFromRows: pencere dışı haftalar atılır, puan 11−sıra, dizi sayısı tekil', () => {
    const rows = [
      { country_iso2: 'BG', week: '2026-09-27', tmdb_id: 1, rank: 1 },
      { country_iso2: 'BG', week: '2026-09-20', tmdb_id: 1, rank: 3 },
      { country_iso2: 'BG', week: '2026-09-20', tmdb_id: 2, rank: 10 },
      { country_iso2: 'BG', week: '2024-01-07', tmdb_id: 3, rank: 1 }, // pencere dışı
    ]
    const m = netflixFromRows(rows, '2025-09-28')
    expect(m.get('BG')).toEqual({ series: 2, weeks: 3, points: 10 + 8 + 1, bestRank: 1 })
  })

  it('cutoffWeekBefore: 52 hafta öncesi ISO tarihi', () => {
    expect(cutoffWeekBefore(new Date('2026-09-27T00:00:00Z'), 52)).toBe('2025-09-28')
  })

  it('wikiFromRows: internet kullanıcısına normalize; bölgesel dil üyelere aynı değeri verir; İngilizce eşlenmez', () => {
    const demo = {
      BG: { internetUsers: 5e6 },
      ES: { internetUsers: 40e6 },
      MX: { internetUsers: 100e6 },
      GB: { internetUsers: 60e6 },
    }
    const m = wikiFromRows(
      [
        { lang: 'bg', views: 500000 },
        { lang: 'es', views: 1400000 },
        { lang: 'en', views: 9e9 },
      ],
      demo,
      { bg: { regional: false, iso: ['BG'] }, es: { regional: true, iso: ['ES', 'MX'] } }
    )
    expect(m.get('BG')).toMatchObject({ value: 100000, regional: false, langs: ['bg'] })
    expect(m.get('ES').value).toBeCloseTo(10000) // 1.4M / 140M kullanıcı ×1e6
    expect(m.get('MX').value).toBeCloseTo(10000)
    expect(m.get('ES').regional).toBe(true)
    expect(m.get('GB')).toBeUndefined()
  })

  it('wikiFromRows: internet kullanıcısı yoksa nüfusa düşer; ikisi de yoksa ülke atlanır', () => {
    const m = wikiFromRows(
      [{ lang: 'bg', views: 1000 }],
      { BG: { population: 2e6 } },
      { bg: { regional: false, iso: ['BG'] } }
    )
    expect(m.get('BG').value).toBeCloseTo(500)
    expect(wikiFromRows([{ lang: 'bg', views: 1000 }], {}, { bg: { regional: false, iso: ['BG'] } }).size).toBe(0)
  })

  it('searchFromRows: aynı dizinin Türkçe ve yerel ad sorguları tek dizi sayılır; ülke için en yüksek değer', () => {
    const iso = (name) => ({ Bulgaristan: 'BG', Meksika: 'MX', Türkiye: 'TR' })[name] ?? null
    const rows = [
      {
        seriesKey: 82328,
        local: false,
        byCountry: [
          { country: 'Türkiye', value: 100 },
          { country: 'Bulgaristan', value: 4 },
        ],
      },
      {
        seriesKey: 82328,
        local: true,
        byCountry: [
          { country: 'Meksika', value: 60 },
          { country: 'Bulgaristan', value: 0 },
        ],
      },
      { seriesKey: 'name:Yasak Elma', local: false, byCountry: [{ country: 'Bulgaristan', value: 9 }] },
    ]
    const m = searchFromRows(rows, iso)
    expect(m.get('BG')).toMatchObject({ seriesQueried: 2, seriesWithInterest: 2, hitShare: 1, localTitleHits: 0 })
    expect(m.get('MX')).toMatchObject({ seriesQueried: 2, seriesWithInterest: 1, hitShare: 0.5, localTitleHits: 1 })
    expect(m.get('MX').meanValue).toBeCloseTo(30)
  })

  it('distributionFromRows: İngilizce pazarlar sayılmaz, dizi tekil', () => {
    const m = distributionFromRows([
      { region: 'ES', tmdb_id: 1 },
      { region: 'ES', tmdb_id: 1 },
      { region: 'ES', tmdb_id: 2 },
      { region: 'US', tmdb_id: 3 },
      { region: 'XWW', tmdb_id: 4 },
    ])
    expect(m.get('ES')).toEqual({ titles: 2 })
    expect(m.has('US')).toBe(false)
    expect(m.has('XWW')).toBe(false)
  })

  it('reasonLine: bileşen yoksa boş', () => {
    expect(reasonLine({})).toBe('')
  })
})

describe("pickNetflixMarkets — Netflix'in çekildiği pazar veriden düşer", () => {
  it('aktif 52 hafta listesi varsa onu kullanır (RU dışarıda), yoksa tam pazar listesine düşer', () => {
    const aktif = pickNetflixMarkets({
      netflix_market_countries: JSON.stringify(['AR', 'RU', 'BR']),
      netflix_active_countries_52w: JSON.stringify(['AR', 'BR']),
    })
    expect([...aktif]).toEqual(['AR', 'BR'])
    expect([...pickNetflixMarkets({ netflix_market_countries: JSON.stringify(['AR', 'RU']) })]).toEqual(['AR', 'RU'])
    expect(pickNetflixMarkets({}).size).toBe(0)
    expect(pickNetflixMarkets({ netflix_active_countries_52w: 'bozuk' }).size).toBe(0)
  })

  it('aktif olmayan pazarda Netflix bileşeni yoktur (0 değil), endeks diğer bileşenlerden hesaplanır', () => {
    const r = computeWatchSignals({
      countries: [ulke('RU', 55), ulke('AR', 53), ulke('BR', 60)],
      markets: new Set(['AR', 'BR']),
      lists: new Map([['AR', { series: 6, weeks: 13, points: 90, bestRank: 1 }]]),
      wiki: new Map([
        ['RU', { value: 900, regional: true, langs: ['ru*'] }],
        ['AR', { value: 100, regional: true, langs: ['es*'] }],
        ['BR', { value: 80, regional: true, langs: ['pt*'] }],
      ]),
      search: new Map([
        ['RU', { hitShare: 0.2, meanValue: 1, seriesWithInterest: 2, seriesQueried: 10 }],
        ['AR', { hitShare: 0.3, meanValue: 2, seriesWithInterest: 3, seriesQueried: 10 }],
      ]),
    })
    expect(r.byIso2.RU.components.lists.present).toBe(false)
    expect(r.byIso2.RU.componentCount).toBe(2)
    expect(r.byIso2.RU.index).not.toBeNull()
    expect(r.byIso2.BR.components.lists).toMatchObject({ present: true, weeks: 0 })
  })
})
