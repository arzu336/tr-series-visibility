import { describe, it, expect } from 'vitest'
import {
  buildPercentileScale,
  buildMapScale,
  metricValueOf,
  MAP_METRICS,
  SOURCE_COUNTRY_ISO2,
} from './scale.js'

function ulke(iso2, score, scorePerCapita = null, dataSource = 'tmdb', perCapitaReliable = true) {
  return { iso2, score, scorePerCapita, dataSource, perCapitaReliable }
}

describe('buildPercentileScale', () => {
  it('en düşük değeri 0, en yükseği 1 yapar', () => {
    const { toT } = buildPercentileScale([10, 20, 30, 40])
    expect(toT(10)).toBe(0)
    expect(toT(40)).toBe(1)
  })

  it('tek bir aykırı yüksek değer gradyanı EZMEZ (min-max ile asıl fark)', () => {
    const degerler = [15, 100, 848, 913, 1126]
    const { toT } = buildPercentileScale(degerler)
    expect(toT(1126)).toBe(1)
    expect(toT(913)).toBeCloseTo(0.75, 5)
    expect(toT(848)).toBeCloseTo(0.5, 5)
    expect(toT(913) - toT(848)).toBeCloseTo(toT(848) - toT(100), 5)
  })

  it('eşit değerler AYNI t alır (sıralamadaki yer rengi belirlemez)', () => {
    const { toT } = buildPercentileScale([100, 100, 100, 500])
    expect(toT(100)).toBe(toT(100))
    expect(toT(100)).toBeCloseTo(1 / 3, 5)
  })

  it('değeri olmayan ülke için null döner — 0 gibi davranmaz', () => {
    const { toT } = buildPercentileScale([10, 20, 30])
    expect(toT(null)).toBeNull()
    expect(toT(undefined)).toBeNull()
    expect(toT(NaN)).toBeNull()
  })

  it('boş alanda hiçbir şey uydurmaz', () => {
    const { toT, size } = buildPercentileScale([])
    expect(size).toBe(0)
    expect(toT(100)).toBeNull()
  })

  it('alan dışı değerleri 0-1 aralığına sıkıştırır', () => {
    const { toT } = buildPercentileScale([10, 20, 30])
    expect(toT(9999)).toBe(1)
    expect(toT(-9999)).toBe(0)
  })
})

describe('buildMapScale — kaynak ülke (TR) muafiyeti', () => {
  const countries = [
    ulke('TR', 1690, 19.7),
    ulke('MX', 1126, 10.3),
    ulke('RU', 913, 6.9),
    ulke('NI', 848, 197.3),
    ulke('CD', 15, 0.5),
  ]

  it('TR ölçek alanına GİRMEZ — tavanı o belirlemez', () => {
    const { scale } = buildMapScale(countries, MAP_METRICS.TOTAL)
    expect(scale.size).toBe(4)
    expect(scale.max).toBe(1126)
  })

  it('TR dışı en yüksek ülke gradyanın TAMAMINA ulaşır', () => {
    const { byIso2 } = buildMapScale(countries, MAP_METRICS.TOTAL)
    expect(byIso2.get('MX').t).toBe(1)
  })

  it('TR t taşımaz ama listede kalır ve kaynak ülke olarak işaretlenir', () => {
    const { byIso2 } = buildMapScale(countries, MAP_METRICS.TOTAL)
    const tr = byIso2.get('TR')
    expect(tr.t).toBeNull()
    expect(tr.isSourceCountry).toBe(true)
    expect(byIso2.get('MX').isSourceCountry).toBe(false)
  })

  it('proxy ülkeler ölçek alanına girmez (sabit 0 skorları tabanı bozmasın)', () => {
    const ileProxy = [...countries, ulke('AF', 0, null, 'proxy')]
    const { scale } = buildMapScale(ileProxy, MAP_METRICS.TOTAL)
    expect(scale.size).toBe(4)
    expect(scale.min).toBe(15)
  })
})

describe('buildMapScale — metrik seçimi', () => {
  const countries = [
    ulke('MX', 1126, 10.3),
    ulke('NI', 848, 197.3),
    ulke('CD', 15, 0.5),
  ]

  it('kişi başına metrik, katalog sayacından FARKLI bir sıralama üretir', () => {
    const toplam = buildMapScale(countries, MAP_METRICS.TOTAL).byIso2
    const kisiBasi = buildMapScale(countries, MAP_METRICS.PER_CAPITA).byIso2
    expect(toplam.get('MX').t).toBe(1)
    expect(kisiBasi.get('NI').t).toBe(1)
    expect(kisiBasi.get('MX').t).toBeLessThan(1)
  })

  it('kişi başına verisi olmayan ülke null t alır (0 ile boyanmaz)', () => {
    const eksik = [ulke('MX', 1126, 10.3), ulke('GG', 40, null)]
    const { byIso2 } = buildMapScale(eksik, MAP_METRICS.PER_CAPITA)
    expect(byIso2.get('GG').t).toBeNull()
  })

  it('metricValueOf doğru alanı okur', () => {
    const c = ulke('MX', 1126, 10.3)
    expect(metricValueOf(c, MAP_METRICS.TOTAL)).toBe(1126)
    expect(metricValueOf(c, MAP_METRICS.PER_CAPITA)).toBe(10.3)
  })

  it('kaynak ülke kodu sabiti TR', () => {
    expect(SOURCE_COUNTRY_ISO2).toBe('TR')
  })
})

describe('buildMapScale — küçük paydalı ülkeler (mikro-devlet yükselteci)', () => {
  const countries = [
    ulke('MX', 1126, 10.3),
    ulke('NI', 848, 197.3),
    ulke('CD', 15, 0.5),
    ulke('SM', 261, 7862.7, 'tmdb', false),
  ]

  it('mikro-devlet kişi başına ölçeğin TAVANINI belirlemez', () => {
    const { scale } = buildMapScale(countries, MAP_METRICS.PER_CAPITA)
    expect(scale.size).toBe(3)
    expect(scale.max).toBe(197.3)
  })

  it('mikro-devlet t taşımaz ve yetersiz örneklem olarak işaretlenir', () => {
    const { byIso2 } = buildMapScale(countries, MAP_METRICS.PER_CAPITA)
    expect(byIso2.get('SM').t).toBeNull()
    expect(byIso2.get('SM').isSmallSample).toBe(true)
    expect(byIso2.get('NI').isSmallSample).toBe(false)
  })

  it('eşik olmadan gerçek pazarlar ezilirdi — eşikle en yüksek gerçek pazar tavana ulaşır', () => {
    const { byIso2 } = buildMapScale(countries, MAP_METRICS.PER_CAPITA)
    expect(byIso2.get('NI').t).toBe(1)
  })

  it('TOPLAM metrikte eşik UYGULANMAZ — küçük payda orada bir sorun değil', () => {
    const { scale, byIso2 } = buildMapScale(countries, MAP_METRICS.TOTAL)
    expect(scale.size).toBe(4)
    expect(byIso2.get('SM').isSmallSample).toBe(false)
    expect(byIso2.get('SM').t).not.toBeNull()
  })

  it('kaynak ülke ve mikro-devlet aynı anda doğru ayrışır', () => {
    const ileTR = [...countries, ulke('TR', 1690, 19.7)]
    const { byIso2 } = buildMapScale(ileTR, MAP_METRICS.PER_CAPITA)
    expect(byIso2.get('TR').isSourceCountry).toBe(true)
    expect(byIso2.get('TR').isSmallSample).toBe(false)
    expect(byIso2.get('SM').isSourceCountry).toBe(false)
    expect(byIso2.get('SM').isSmallSample).toBe(true)
  })
})
