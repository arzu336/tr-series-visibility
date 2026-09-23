import { describe, it, expect } from 'vitest'
import { attachPerCapitaScores, PER_CAPITA_BASIS, MIN_PER_CAPITA_DENOMINATOR } from './aggregate.js'

const demo = {
  DE: { population: 83_500_000, populationYear: 2024, internetPct: 93.5, internetYear: 2024, internetUsers: 78_072_500 },
  NI: { population: 7_000_000, populationYear: 2024, internetPct: 61.4, internetYear: 2024, internetUsers: 4_298_000 },
  XA: { population: 10_000_000, populationYear: 2023, internetPct: null, internetYear: null, internetUsers: null },
  XB: { population: 0, populationYear: 2024, internetPct: null, internetYear: null, internetUsers: null },
  SM: { population: 34_000, populationYear: 2024, internetPct: 78, internetYear: 2024, internetUsers: 26_520 },
}

const ulkeler = [
  { iso2: 'DE', score: 500 },
  { iso2: 'NI', score: 848 },
  { iso2: 'XA', score: 200 },
  { iso2: 'XB', score: 100 },
  { iso2: 'GG', score: 40 },
  { iso2: 'SM', score: 261 },
]

function bul(list, iso2) {
  return list.find((c) => c.iso2 === iso2)
}

describe('attachPerCapitaScores', () => {
  it('skoru milyon internet kullanıcısına böler', () => {
    const sonuc = attachPerCapitaScores(ulkeler, demo)
    expect(bul(sonuc, 'DE').scorePerCapita).toBeCloseTo(6.4, 1)
    expect(bul(sonuc, 'DE').perCapitaBasis).toBe(PER_CAPITA_BASIS.INTERNET)
    expect(bul(sonuc, 'DE').perCapitaYear).toBe(2024)
  })

  it('katalog sayacının gizlediği farkı ortaya çıkarır', () => {
    const sonuc = attachPerCapitaScores(ulkeler, demo)
    const de = bul(sonuc, 'DE')
    const ni = bul(sonuc, 'NI')
    expect(ni.score).toBeGreaterThan(de.score)
    expect(ni.scorePerCapita).toBeCloseTo(197.3, 1)
    expect(ni.scorePerCapita / de.scorePerCapita).toBeGreaterThan(10)
  })

  it('internet yüzdesi yoksa nüfusa düşer VE bunu etiketler', () => {
    const xa = bul(attachPerCapitaScores(ulkeler, demo), 'XA')
    expect(xa.scorePerCapita).toBeCloseTo(20, 5)
    expect(xa.perCapitaBasis).toBe(PER_CAPITA_BASIS.POPULATION)
    expect(xa.perCapitaYear).toBe(2023)
  })

  it('demografisi olmayan ülke için NULL bırakır — tahmini nüfus uydurmaz', () => {
    const gg = bul(attachPerCapitaScores(ulkeler, demo), 'GG')
    expect(gg.scorePerCapita).toBeNull()
    expect(gg.perCapitaBasis).toBeNull()
    expect(gg.perCapitaYear).toBeNull()
  })

  it('sıfır/geçersiz paydada bölme yapmaz', () => {
    const xb = bul(attachPerCapitaScores(ulkeler, demo), 'XB')
    expect(xb.scorePerCapita).toBeNull()
    expect(xb.perCapitaBasis).toBeNull()
  })

  it('demografi hiç yoksa (dış servis düştü) tüm ülkeler null döner, hata fırlatmaz', () => {
    const sonuc = attachPerCapitaScores(ulkeler, null)
    expect(sonuc).toHaveLength(ulkeler.length)
    expect(sonuc.every((c) => c.scorePerCapita === null)).toBe(true)
    expect(bul(sonuc, 'DE').score).toBe(500)
  })

  it('girdi dizisini MUTASYONA UĞRATMAZ', () => {
    const kopya = JSON.parse(JSON.stringify(ulkeler))
    attachPerCapitaScores(ulkeler, demo)
    expect(ulkeler).toEqual(kopya)
  })

  it('küçük paydalı ülkeyi GÜVENİLMEZ işaretler ama skorunu yine de hesaplar', () => {
    const sm = bul(attachPerCapitaScores(ulkeler, demo), 'SM')
    expect(sm.scorePerCapita).toBeGreaterThan(1000)
    expect(sm.perCapitaReliable).toBe(false)
  })

  it('eşiği geçen ülkeyi güvenilir işaretler', () => {
    const sonuc = attachPerCapitaScores(ulkeler, demo)
    expect(bul(sonuc, 'DE').perCapitaReliable).toBe(true)
    expect(bul(sonuc, 'NI').perCapitaReliable).toBe(true)
  })

  it('eşik tam sınırda dahil eder (>=)', () => {
    const sinir = { ZZ: { population: MIN_PER_CAPITA_DENOMINATOR, populationYear: 2024, internetPct: null, internetYear: null, internetUsers: null } }
    const [c] = attachPerCapitaScores([{ iso2: 'ZZ', score: 100 }], sinir)
    expect(c.perCapitaReliable).toBe(true)
  })

  it('demografisi olmayan ülke güvenilir sayılmaz', () => {
    expect(bul(attachPerCapitaScores(ulkeler, demo), 'GG').perCapitaReliable).toBe(false)
  })

  it('ham skoru ve diğer alanları korur', () => {
    const zengin = [{ iso2: 'DE', score: 500, seriesCount: 30, dominantTheme: 'aile' }]
    const [sonuc] = attachPerCapitaScores(zengin, demo)
    expect(sonuc.score).toBe(500)
    expect(sonuc.seriesCount).toBe(30)
    expect(sonuc.dominantTheme).toBe('aile')
  })
})
