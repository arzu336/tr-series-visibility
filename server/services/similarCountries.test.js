import { describe, it, expect } from 'vitest'
import { findSimilarCountries, themeShares, cosineSimilarity, CONFIDENCE_FULL_AT } from './similarCountries.js'

const ulke = (iso2, themeScores, seriesCount = 30, extra = {}) => ({
  iso2,
  dataSource: 'tmdb',
  seriesCount,
  themeScores,
  ...extra,
})

const AILE = { aile: 60, aşk: 30, tarih: 10 }
const TARIH = { tarih: 70, aile: 20, 'suç örgütü': 10 }

const meta = {
  DE: { region: 'ECS', incomeLevel: 'HIC' },
  FR: { region: 'ECS', incomeLevel: 'HIC' },
  PL: { region: 'ECS', incomeLevel: 'HIC' },
  BR: { region: 'LCN', incomeLevel: 'UMC' },
  AR: { region: 'LCN', incomeLevel: 'UMC' },
  EG: { region: 'MEA', incomeLevel: 'LMC' },
}
const gdp = { DE: 50000, FR: 45000, PL: 20000, BR: 9000, AR: 12000, EG: 4000 }

describe('themeShares / cosineSimilarity', () => {
  it('payları normalize eder ve kendisiyle benzerliği 1 verir', () => {
    const s = themeShares(AILE)
    expect(s.aile).toBeCloseTo(0.6)
    expect(cosineSimilarity(s, s)).toBeCloseTo(1)
  })

  it('boş ya da sıfır tema puanında 0 döner, NaN üretmez', () => {
    expect(cosineSimilarity(themeShares({}), themeShares(AILE))).toBe(0)
    expect(themeShares({ aile: 0 })).toEqual({})
  })
})

describe('findSimilarCountries (B3 hibrit)', () => {
  const countries = [
    ulke('DE', AILE),
    ulke('FR', AILE), // aynı bölge+gelir, aynı tema → en benzer
    ulke('PL', TARIH), // aynı bölge+gelir, farklı tema
    ulke('BR', AILE), // aynı tema ama farklı bölge/gelir → havuz dışı
    ulke('EG', AILE, 4), // farklı bölge/gelir → havuz dışı
    ulke('TR', AILE), // kaynak ülke — asla aday değil
    ulke('XX', AILE, 40, { dataSource: 'proxy' }), // yayın verisi yok
    ulke('SM', AILE, 1), // 3 diziden az
  ]

  it('aynı bölge/gelir havuzunda tema benzerliğine göre sıralar; TR ve proxy hariç', async () => {
    const r = await findSimilarCountries('DE', countries, { meta, gdp, k: 5 })
    expect(r.pool).toBe('bolge+gelir') // ECS'te yalnızca FR, PL var (k=5'ten az) → gelir grubuyla tamamlanır ama başka HIC yok
    const kodlar = r.candidates.map((c) => c.iso2)
    expect(kodlar).toEqual(['FR', 'PL'])
    expect(kodlar).not.toContain('TR')
    expect(kodlar).not.toContain('XX')
    expect(kodlar).not.toContain('BR')
    expect(r.candidates[0].reasons).toEqual(
      expect.arrayContaining(['aynı bölge', 'aynı gelir grubu', 'benzer kişi başı GSYH'])
    )
    expect(r.candidates[0].themeSimilarity).toBeCloseTo(1, 3)
  })

  it('küçük katalog güven çarpanıyla aşağı çekilir', async () => {
    const c2 = [ulke('DE', AILE), ulke('FR', AILE, 5), ulke('PL', AILE, 40)]
    const r = await findSimilarCountries('DE', c2, { meta, gdp })
    expect(r.candidates.map((c) => c.iso2)).toEqual(['PL', 'FR'])
    const fr = r.candidates.find((c) => c.iso2 === 'FR')
    expect(fr.confidence).toBeCloseTo(5 / CONFIDENCE_FULL_AT)
    expect(fr.reasons.join(' ')).toMatch(/katalog küçük/)
  })

  it('Dünya Bankası verisi yoksa havuz daraltılmaz ve bunu söyler', async () => {
    const r = await findSimilarCountries('DE', countries, { meta: null, gdp: null })
    expect(r.pool).toBe('tumu')
    expect(r.note).toMatch(/meta verisi yok/)
    // BR artık havuzda (tema benzer)
    expect(r.candidates.map((c) => c.iso2)).toContain('BR')
    expect(r.candidates.map((c) => c.iso2)).not.toContain('TR')
  })

  it('k sınırı uygulanır', async () => {
    const cok = [ulke('DE', AILE), ...['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'].map((k) => ulke(k, AILE))]
    const r = await findSimilarCountries('DE', cok, { meta: null, gdp: null, k: 5 })
    expect(r.candidates).toHaveLength(5)
  })

  it('hedef proxy ya da listede değilse boş liste + neden', async () => {
    expect((await findSimilarCountries('XX', countries, { meta, gdp })).candidates).toEqual([])
    const r = await findSimilarCountries('ZZ', countries, { meta, gdp })
    expect(r.candidates).toEqual([])
    expect(r.note).toMatch(/yayın verisi yok/)
  })

  it('sonuç deterministik: eşit skorda ISO2 alfabetik', async () => {
    const c2 = [ulke('DE', AILE), ulke('FR', AILE), ulke('AT', AILE)]
    const r = await findSimilarCountries('DE', c2, { meta: null, gdp: null })
    expect(r.candidates.map((c) => c.iso2)).toEqual(['AT', 'FR'])
  })
})

describe("eşitlik kırıcı (canlı veride kosinüs 1,0'a doyuyordu)", () => {
  it("tema benzerliği eşitken GSYH'si yakın olan öne geçer, sonra büyük katalog", async () => {
    const c2 = [ulke('DE', AILE), ulke('ZA', AILE, 30), ulke('AT', AILE, 30), ulke('FR', AILE, 45)]
    const gdp2 = { DE: 50000, AT: 52000, FR: 45000, ZA: 6000 }
    const r = await findSimilarCountries('DE', c2, { meta: null, gdp: gdp2 })
    // Hepsi benzerlik 1,0; AT (log farkı 0,04) < FR (0,105) < ZA (2,1)
    expect(r.candidates.map((c) => c.iso2)).toEqual(['AT', 'FR', 'ZA'])
    expect(r.candidates[0].gdpDistance).toBeLessThan(r.candidates[1].gdpDistance)
  })

  it('GSYH verisi yoksa büyük katalog, o da eşitse alfabetik', async () => {
    const c2 = [ulke('DE', AILE), ulke('FR', AILE, 30), ulke('AT', AILE, 40), ulke('BE', AILE, 40)]
    const r = await findSimilarCountries('DE', c2, { meta: null, gdp: null })
    expect(r.candidates.map((c) => c.iso2)).toEqual(['AT', 'BE', 'FR'])
    expect(r.candidates[0].gdpDistance).toBeNull()
  })
})

describe("eşitlik kırıcı (canlı veride kosinüs 1,0'a doyuyordu)", () => {
  it("tema benzerliği eşitken GSYH'si yakın olan öne geçer", async () => {
    const c2 = [ulke('DE', AILE), ulke('ZA', AILE, 30), ulke('AT', AILE, 30), ulke('FR', AILE, 45)]
    const gdp2 = { DE: 50000, AT: 52000, FR: 45000, ZA: 6000 }
    const r = await findSimilarCountries('DE', c2, { meta: null, gdp: gdp2 })
    expect(r.candidates.map((c) => c.iso2)).toEqual(['AT', 'FR', 'ZA'])
    expect(r.candidates[0].gdpDistance).toBeLessThan(r.candidates[1].gdpDistance)
  })

  it('GSYH verisi yoksa büyük katalog, o da eşitse alfabetik', async () => {
    const c2 = [ulke('DE', AILE), ulke('FR', AILE, 30), ulke('AT', AILE, 40), ulke('BE', AILE, 40)]
    const r = await findSimilarCountries('DE', c2, { meta: null, gdp: null })
    expect(r.candidates.map((c) => c.iso2)).toEqual(['AT', 'BE', 'FR'])
    expect(r.candidates[0].gdpDistance).toBeNull()
  })
})

describe('aday havuzu: önce bölge, yetmezse gelir grubu', () => {
  const metaLatam = {
    BR: { region: 'LCN', incomeLevel: 'UMC' },
    AR: { region: 'LCN', incomeLevel: 'UMC' },
    MX: { region: 'LCN', incomeLevel: 'UMC' },
    CL: { region: 'LCN', incomeLevel: 'HIC' },
    CO: { region: 'LCN', incomeLevel: 'UMC' },
    PE: { region: 'LCN', incomeLevel: 'UMC' },
    DO: { region: 'LCN', incomeLevel: 'UMC' },
    MK: { region: 'ECS', incomeLevel: 'UMC' },
    BA: { region: 'ECS', incomeLevel: 'UMC' },
    BY: { region: 'ECS', incomeLevel: 'UMC' },
  }
  const gdpLatam = {
    BR: 9000,
    AR: 12000,
    MX: 11000,
    CL: 16000,
    CO: 7000,
    PE: 7500,
    DO: 10000,
    MK: 7300,
    BA: 7600,
    BY: 7900,
  }
  const hepsi = ['BR', 'AR', 'MX', 'CL', 'CO', 'PE', 'DO', 'MK', 'BA', 'BY'].map((k) => ulke(k, AILE, 30))

  it('Latin Amerika ülkesi için Balkan ülkesi dönmez — bölgede yeterli aday varken gelir grubu kullanılmaz', async () => {
    const r = await findSimilarCountries('BR', hepsi, { meta: metaLatam, gdp: gdpLatam, k: 5 })
    expect(r.pool).toBe('bolge')
    const kodlar = r.candidates.map((c) => c.iso2)
    expect(kodlar).toHaveLength(5)
    for (const balkan of ['MK', 'BA', 'BY']) expect(kodlar).not.toContain(balkan)
    expect(r.candidates.every((c) => c.reasons.includes('aynı bölge'))).toBe(true)
    // CL farklı gelir grubunda ama aynı bölgede → havuzda (k=5'te GSYH mesafesiyle elenir, k=6'da girer);
    // Balkan ülkeleri gelir grubu tutsa da bölge dolu olduğu için hiçbir k'da girmez.
    const r6 = await findSimilarCountries('BR', hepsi, { meta: metaLatam, gdp: gdpLatam, k: 6 })
    expect(r6.candidates.map((c) => c.iso2)).toContain('CL')
    expect(r6.candidates.map((c) => c.iso2)).toEqual(expect.not.arrayContaining(['MK', 'BA', 'BY']))
  })

  it("aynı bölgede k'dan az aday varsa kalan yerler aynı gelir grubundan tamamlanır, bölge önce gelir", async () => {
    const az = hepsi.filter((c) => ['BR', 'AR', 'MK', 'BA', 'BY'].includes(c.iso2))
    const r = await findSimilarCountries('BR', az, { meta: metaLatam, gdp: gdpLatam, k: 3 })
    expect(r.pool).toBe('bolge+gelir')
    expect(r.candidates.map((c) => c.iso2)[0]).toBe('AR')
    expect(r.candidates).toHaveLength(3)
    expect(r.note).toMatch(/gelir grubundan tamamlandı/)
  })
})
