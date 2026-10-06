import { describe, it, expect } from 'vitest'
import { buildGdeltPhrase, gdeltNewsCacheKey, fetchNewsArticlesGdelt } from './gdeltNews.js'
import { pickLocalTitle, foldTitle, asciiVariant, pickEnglishTitles, getEnglishTitles } from './localTitles.js'
import { selectNewsScanPairs } from './newsScanTargets.js'

describe('GDELT sorgusu — Türkçe ad + yerel ad', () => {
  it('tek ad tırnakla, birden çok ad parantez içinde OR ile', () => {
    expect(buildGdeltPhrase(['Uzak Şehir'])).toBe('"Uzak Şehir"')
    expect(buildGdeltPhrase(['Kuruluş: Osman', 'Establishment: Osman'])).toBe(
      '("Kuruluş: Osman" OR "Establishment: Osman")'
    )
  })

  it('önbellek anahtarı ad listesine göre; tek ad eski anahtarla aynı', () => {
    expect(gdeltNewsCacheKey(['Uzak Şehir'], 'sa')).toBe(gdeltNewsCacheKey('Uzak Şehir', 'SA'))
    expect(gdeltNewsCacheKey(['A dizisi', 'B series'], 'SA')).not.toBe(gdeltNewsCacheKey('A dizisi', 'SA'))
    expect(gdeltNewsCacheKey(['A dizisi'], 'SA', { context: '(turkish OR turkey)' })).not.toBe(
      gdeltNewsCacheKey('A dizisi', 'SA')
    )
  })

  it('bütün adlar çok kısaysa ağa çıkmadan desteklenmiyor döner', async () => {
    await expect(fetchNewsArticlesGdelt(['Daha', 'Ezel'], 'CR')).resolves.toEqual({
      unsupported: true,
      reason: 'kisa-ad',
      news: [],
    })
  })
})

describe('pickLocalTitle — ülkedeki yerel ad', () => {
  it('Türkçe adın aynısı ya da Türkçe harfleri düşürülmüş hâli yerel ad sayılmaz', () => {
    expect(pickLocalTitle(['Kurulus: Osman', 'Establishment: Osman'], 'Kuruluş: Osman')).toBe('Establishment: Osman')
    expect(pickLocalTitle(['Kuruluş Osman'], 'Kuruluş: Osman')).toBeNull()
    expect(pickLocalTitle(['Основание: Осман'], 'Kuruluş: Osman')).toBe('Основание: Осман')
    expect(pickLocalTitle([], 'X')).toBeNull()
    expect(foldTitle('Kuruluş: Osman')).toBe(foldTitle('kurulus osman'))
  })
})

describe('selectNewsScanPairs — ülke başına ilgili diziler', () => {
  const series = [
    { id: 1, name: 'Popüler', popularity: 90 },
    { id: 2, name: 'Listede', popularity: 5 },
    { id: 3, name: 'Orta', popularity: 40 },
    { id: 4, name: 'Başka ülkede', popularity: 80 },
  ]
  const yayin = { flatrate: [{ provider_id: 1 }] }
  const providersById = { 1: { SA: yayin, DE: yayin }, 2: { SA: yayin }, 3: { SA: yayin }, 4: { DE: yayin } }
  const charted = new Map([['SA', [{ id: 2, best: 1 }]]])

  it('önce o ülkenin sıralamasına girenler, sonra orada yayında olan en popülerler; dizi başına gruplanır', () => {
    const pairs = selectNewsScanPairs({ countries: ['SA', 'DE'], series, providersById, charted, perCountry: 2 })
    const byId = Object.fromEntries(pairs.map((p) => [p.series.id, p.countries]))
    expect(byId).toEqual({ 2: ['SA'], 1: ['SA', 'DE'], 4: ['DE'] })
    expect(pairs[0].series).toEqual({ id: 1, name: 'Popüler' }) // en çok ülkesi olan önce
  })

  it('yayın kataloğu olmayan ülke: sıralamaya giren varsa o, yoksa en popüler diziler (ülke başına 2)', () => {
    const pairs = selectNewsScanPairs({
      countries: [],
      uncataloged: ['MN', 'SA'],
      series,
      providersById,
      charted,
    })
    const byId = Object.fromEntries(pairs.map((p) => [p.series.id, p.countries]))
    expect(byId).toEqual({ 1: ['MN', 'SA'], 4: ['MN'], 2: ['SA'] })
  })
})

describe('asciiVariant — yabancı basındaki yazım', () => {
  it('Türkçe harfler sadeleşir, noktalama boşluğa döner; değişmiyorsa null', () => {
    expect(asciiVariant('Kuruluş: Osman')).toBe('Kurulus Osman')
    expect(asciiVariant('Yalı Çapkını')).toBe('Yali Capkini')
    expect(asciiVariant('Gupi')).toBeNull()
  })
})

describe('İngilizce uluslararası adlar', () => {
  it('en çok bölgede kullanılan ad önce; tek bölgede geçen ikinci ad alınmaz; en çok iki', () => {
    const rows = [
      { region: 'US', title: 'Lejos de ti' },
      { region: 'US', title: 'Uzak Şehir' },
      { region: 'GB', title: 'Far Away' },
      { region: 'AU', title: 'Far Away' },
      { region: 'CA', title: 'Far Away' },
      { region: 'IN', title: 'Far Away' },
      { region: 'ZA', title: 'Uzak Sehir' },
    ]
    expect(pickEnglishTitles(rows, 'Uzak Şehir')).toEqual(['Far Away'])
    const iki = [...rows, { region: 'XWW', title: 'Faraway City' }, { region: 'IE', title: 'Faraway City' }]
    expect(pickEnglishTitles(iki, 'Uzak Şehir')).toEqual(['Far Away', 'Faraway City'])
    expect(pickEnglishTitles(iki, 'Uzak Şehir', 1)).toEqual(['Far Away'])
  })

  it('eşit oyda dünya geneli, sonra Birleşik Krallık; Türkçe adla aynısı sayılmaz; veritabanı yoksa boş', () => {
    const rows = [
      { region: 'US', title: 'Oath' },
      { region: 'GB', title: 'The Promise' },
    ]
    expect(pickEnglishTitles(rows, 'Yemin')).toEqual(['The Promise'])
    expect(pickEnglishTitles([{ region: 'US', title: 'Sila' }], 'Sıla')).toEqual([])
    expect(getEnglishTitles(1, 'X', { conn: null })).toEqual([])
  })
})
