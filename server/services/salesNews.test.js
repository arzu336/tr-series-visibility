import { describe, it, expect } from 'vitest'
import {
  buildCountryMatcher,
  buildSeriesMatcher,
  extractFacts,
  guessBuyer,
  parseBroadcastTable,
  normText,
} from './salesNews.js'

const matchCountries = buildCountryMatcher()
const matchSeries = buildSeriesMatcher([
  { id: 1, name: 'Kuruluş: Osman', englishTitles: ['Establishment: Osman'] },
  { id: 2, name: "Fatmagül'ün Suçu Ne?", englishTitles: ["What Is Fatmagül's Fault?", 'Fatmagül'] },
  { id: 3, name: 'Halef', englishTitles: [] },
  { id: 4, name: 'Aşk', englishTitles: [] },
  { id: 5, name: 'Kara', englishTitles: [] },
  { id: 6, name: 'Aile', englishTitles: ['Family Secrets'] },
  { id: 7, name: 'Aile Şirketi', englishTitles: ['Family Secrets'] }, // aynı İngilizce ad iki dizide: sayılmaz
])

describe('salesNews — eşleyiciler', () => {
  it('ülke adları İngilizce/İspanyolca/Türkçe ve kısaltmalar; Türkiye sayılmaz', () => {
    expect(matchCountries('Turkey, Türkiye, Bosnia and Herzegovina, Kosova, Estados Unidos, Almanya, UAE')).toEqual([
      'BA',
      'XK',
      'US',
      'DE',
      'AE',
    ])
    expect(matchCountries('Georgia and Jordan')).toEqual(['GE', 'JO'])
    expect(matchCountries.names.has('spain')).toBe(true)
  })

  it('dizi adı noktalama ve Türkçe harf farkıyla eşleşir; aynı İngilizce ad iki dizideyse atlanır', () => {
    expect(normText('Kuruluş: Osman!')).toBe(' kurulus osman ')
    expect(matchSeries('KURULUS OSMAN airs in Pakistan').map((s) => s.id)).toEqual([1])
    expect(matchSeries('Establishment Osman and Fatmagul').map((s) => s.id)).toEqual([1, 2])
    expect(matchSeries('Family Secrets sold to Italy')).toEqual([])
  })

  it('tek kelimelik ad yalnızca büyük harfle başlıyorsa; 3 harf ve sık sözcükler hiç sayılmaz', () => {
    expect(matchSeries('HALEF premieres in Croatia').map((s) => s.id)).toEqual([3])
    expect(matchSeries('the halef of the family')).toEqual([])
    expect(matchSeries('Aşk sold to Chile; Kara sold to Peru')).toEqual([])
  })
})

describe('salesNews — olgu çıkarma', () => {
  const text = `Kanal D International has sold Fatmagül to Spain's Antena 3. Fatmagul Joins Netflix in Latin America and Mexico.
HALEF premieres on Nova TV in Croatia and Albania. Kuruluş Osman will air in Pakistan on PTV Home.
Halef is a story about Germany.`

  it('aynı cümlede dizi + ülke (+ satış sözcüğü); alıcı ülke ve dağıtımcı adı olamaz', () => {
    const facts = extractFacts(text, { matchSeries, matchCountries, requireVerb: true })
    expect(facts).toEqual([
      { seriesId: 2, iso2: 'ES', buyer: 'Antena 3' },
      { seriesId: 2, iso2: 'MX', buyer: 'Netflix' },
      { seriesId: 3, iso2: 'HR', buyer: 'Nova TV' },
      { seriesId: 3, iso2: 'AL', buyer: 'Nova TV' },
      { seriesId: 1, iso2: 'PK', buyer: 'PTV Home' },
    ])
  })

  it('dağıtımcı kaynağında satış sözcüğü aranmaz ama tek kelimelik ad için yine gerekir', () => {
    const facts = extractFacts('Kuruluş Osman in Pakistan. Halef in Germany.', {
      matchSeries,
      matchCountries,
      requireVerb: false,
    })
    expect(facts).toEqual([{ seriesId: 1, iso2: 'PK', buyer: null }])
  })

  it('alıcı tahmini: satıcı taraf, ülke sıfatı ve fiil kalıntısı elenir', () => {
    expect(guessBuyer('Sweet Revenge to Air in Croatia.', { countryText: ['croatia'] })).toBeNull()
    expect(guessBuyer('sold by Inter Medya to Telefe in Argentina', { countryText: ['argentina'] })).toBe('Telefe')
    expect(guessBuyer('licensed to Panamanian broadcaster', {})).toBeNull()
    expect(guessBuyer('debuts on Caracol Televisión', {})).toBe('Caracol Televisión')
  })

  it('yayın tablosu: ülke, ilk kanal, tarih (tam ya da yıl)', () => {
    const html =
      '<table><tr><th>Country</th><th>Channel(s)</th><th>Premiere</th></tr>' +
      '<tr><td>Afghanistan</td><td>Tolo TV, Faza TV</td><td>24 April 2020</td></tr>' +
      '<tr><td><span>Pakistan</span></td><td>PTV Home</td><td><span data-sort="2021-01-05">5 January 2021</span></td></tr>' +
      '<tr><td>Nowhere</td><td>X</td><td></td></tr></table>'
    expect(parseBroadcastTable(html, matchCountries)).toEqual([
      { iso2: 'AF', buyer: 'Tolo TV', date: '2020-04-24' },
      { iso2: 'PK', buyer: 'PTV Home', date: '2021-01-05' },
    ])
  })
})
