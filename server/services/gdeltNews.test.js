import { describe, it, expect } from 'vitest'
import {
  normalizeGdeltArticles,
  seendateToIso,
  gdeltNewsCacheKey,
  isGdeltSupportedCountry,
  fetchNewsArticlesGdelt,
  ISO2_TO_FIPS,
} from './gdeltNews.js'

// Denetim raporu D.6 — GDELT DOC 2.0 geçişi. Buradaki örnek makaleler UYDURMA DEĞİL: canlı
// api.gdeltproject.org yanıtından alınmış gerçek alan yapısıdır (url / url_mobile / title /
// seendate / socialimage / domain / language / sourcecountry — özet alanı YOKTUR).
const CANLI_ORNEK = [
  {
    url: 'https://1plus1.ua/slozy-dzhennet/novyny/slozy-dzhennet-5-prychyn',
    title: 'Сльози Дженнет : 5 причин подивитися турецький серіал',
    seendate: '20260907T203000Z',
    domain: '1plus1.ua',
    language: 'Ukrainian',
    sourcecountry: 'Ukraine',
  },
  {
    url: 'https://www.almasryalyoum.com/news/details/4353542',
    title: 'مسلسل المدينة البعيدة يعود بالموسم الثالث',
    seendate: '20260906T134500Z',
    domain: 'almasryalyoum.com',
    language: 'Arabic',
    sourcecountry: 'Egypt',
  },
]

describe('seendateToIso', () => {
  it('GDELT damgasını ISO 8601 e çevirir', () => {
    expect(seendateToIso('20260907T203000Z')).toBe('2026-09-07T20:30:00Z')
  })

  it('tanınmayan biçimi olduğu gibi bırakır (uydurma tarih üretmez)', () => {
    expect(seendateToIso('bozuk-deger')).toBe('bozuk-deger')
    expect(seendateToIso(null)).toBe(null)
  })
})

describe('gdeltNewsCacheKey', () => {
  it('gdelt:news ad alanını kullanır — SerpAPI dönemindeki serp:* anahtarlarıyla çakışmaz', () => {
    const key = gdeltNewsCacheKey('Kuruluş Osman', 'de')
    expect(key.startsWith('gdelt:news:')).toBe(true)
    expect(key.includes('serp:')).toBe(false)
    expect(key.endsWith('::DE')).toBe(true)
  })

  it('aynı sorgunun büyük/küçük harf varyantları tek anahtara düşer', () => {
    expect(gdeltNewsCacheKey('  esaret ', 'TR')).toBe(gdeltNewsCacheKey('Esaret', 'tr'))
  })
})

describe('normalizeGdeltArticles', () => {
  it('istenen ülkeyle eşleşmeyen makaleleri ELER (yanlış ülkenin basını kaydedilemez)', () => {
    const sonuc = normalizeGdeltArticles(CANLI_ORNEK, 'UA')
    expect(sonuc).toHaveLength(1)
    expect(sonuc[0].source).toBe('1plus1.ua')
  })

  it('ülke adı varyantlarını kabul eder (GDELT kısa ad kullanabiliyor)', () => {
    const makaleler = [{ title: 'x', domain: 'bbc.co.uk', seendate: '20260901T000000Z', sourcecountry: 'UK' }]
    expect(normalizeGdeltArticles(makaleler, 'GB')).toHaveLength(1)
  })

  it('hiçbiri eşleşmiyorsa boş döner — başka ülkenin haberlerine düşmez', () => {
    expect(normalizeGdeltArticles(CANLI_ORNEK, 'DE')).toHaveLength(0)
  })

  it('snippet her zaman null — GDELT özet döndürmüyor, uydurulmuyor', () => {
    const sonuc = normalizeGdeltArticles(CANLI_ORNEK, 'EG')
    expect(sonuc).toHaveLength(1)
    expect(sonuc[0].snippet).toBe(null)
    expect(sonuc[0].source).toBe('almasryalyoum.com')
    expect(sonuc[0].date).toBe('2026-09-06T13:45:00Z')
  })

  it('boş/eksik girdide çökmez', () => {
    expect(normalizeGdeltArticles(null, 'TR')).toEqual([])
    expect(normalizeGdeltArticles([], 'TR')).toEqual([])
  })
})

// CANLI ÖLÇÜM: filtresiz bir GDELT sorgusundan (75 makale) dönen 22 gerçek `sourcecountry` değeri.
// Katı ad eşitliği bunların 4'ünü reddediyordu (Bosnia-Herzegovina, Slovak Republic, Macedonia,
// Turkey) — normalizasyon + FIPS dönemi alias tablosu hepsini kurtarıyor.
const CANLI_ULKE_ADLARI = [
  ['Ukraine', 'UA'], ['Bulgaria', 'BG'], ['Pakistan', 'PK'], ['Bosnia-Herzegovina', 'BA'],
  ['Serbia', 'RS'], ['Poland', 'PL'], ['Hungary', 'HU'], ['Slovak Republic', 'SK'],
  ['United Kingdom', 'GB'], ['Russia', 'RU'], ['Macedonia', 'MK'], ['Germany', 'DE'],
  ['Azerbaijan', 'AZ'], ['India', 'IN'], ['Turkey', 'TR'], ['United States', 'US'],
  ['Saudi Arabia', 'SA'], ['Greece', 'GR'], ['Italy', 'IT'], ['Bangladesh', 'BD'],
  ['Israel', 'IL'], ['South Africa', 'ZA'],
]

describe('ülke adı doğrulaması — canlı GDELT adlarıyla', () => {
  it('canlı yanıtta görülen 22 ülke adının TAMAMI doğru ISO2 ile eşleşir', () => {
    const eslesmeyen = CANLI_ULKE_ADLARI.filter(([ad, iso2]) => {
      const makale = [{ title: 't', domain: 'd.com', seendate: '20260901T000000Z', sourcecountry: ad }]
      return normalizeGdeltArticles(makale, iso2).length !== 1
    })
    expect(eslesmeyen).toEqual([])
  })

  it('Türkiye: Intl "Türkiye" der ama GDELT "Turkey" yazar — yine de eşleşmeli', () => {
    const makale = [{ title: 't', domain: 'hurriyet.com.tr', seendate: '20260901T000000Z', sourcecountry: 'Turkey' }]
    expect(normalizeGdeltArticles(makale, 'TR')).toHaveLength(1)
  })

  it('yanlış ülke hâlâ elenir (gevşetme bir kaçak yaratmadı)', () => {
    const makale = [{ title: 't', domain: 'd.com', seendate: '20260901T000000Z', sourcecountry: 'Germany' }]
    expect(normalizeGdeltArticles(makale, 'FR')).toHaveLength(0)
    expect(normalizeGdeltArticles(makale, 'TR')).toHaveLength(0)
  })

  it('boş sourcecountry kabul edilmez (canlı yanıtta 2 makalede boştu)', () => {
    const makale = [{ title: 't', domain: 'd.com', seendate: '20260901T000000Z', sourcecountry: '' }]
    expect(normalizeGdeltArticles(makale, 'DE')).toHaveLength(0)
  })
})

// Denetim bulgusu Y-2: FIPS tablosu 57 ülkeyle sınırlıydı ve haftalık tarama hedeflerinden Peru
// ile Bolivya bile dışarıdaydı — bu ülkelerde sorgu filtresiz gidiyor, ad doğrulaması her şeyi
// eliyor ve ortaya çıkan boş sonuç 14 gün "yetersiz-veri" olarak önbelleğe yazılıyordu.
describe('GDELT ülke kapsamı (Y-2)', () => {
  it('haftalık tarama hedeflerinin TAMAMI destekleniyor', () => {
    const hedefler = ['AR', 'PE', 'BO', 'SA', 'EG', 'MA', 'UA', 'RS', 'BA', 'KZ', 'UZ', 'TM']
    expect(hedefler.filter((c) => !isGdeltSupportedCountry(c))).toEqual([])
  })

  it('ISO2 ile FIPS ayrışan tuzak çiftleri doğru eşlenir', () => {
    // Bunların hepsi karışması kolay gerçek çiftler; biri ters yazılırsa sonuç sessizce boşalır.
    expect(ISO2_TO_FIPS.CH).toBe('SZ') // İsviçre
    expect(ISO2_TO_FIPS.SZ).toBe('WZ') // Esvatini
    expect(ISO2_TO_FIPS.ZA).toBe('SF') // Güney Afrika
    expect(ISO2_TO_FIPS.ZM).toBe('ZA') // Zambiya
    expect(ISO2_TO_FIPS.SN).toBe('SG') // Senegal
    expect(ISO2_TO_FIPS.SG).toBe('SN') // Singapur
    expect(ISO2_TO_FIPS.CL).toBe('CI') // Şili
    expect(ISO2_TO_FIPS.CI).toBe('IV') // Fildişi Sahili
    expect(ISO2_TO_FIPS.BO).toBe('BL') // Bolivya
    expect(ISO2_TO_FIPS.TR).toBe('TU') // Türkiye
  })

  it('desteklenmeyen ülke için DIŞ ÇAĞRI YAPILMADAN unsupported döner', async () => {
    // Filistin bilerek dışarıda (GDELT'te tek kod yok: WE/GZ ayrımı). Ağ erişimi olmadan
    // çözülmesi, çağrının gerçekten yapılmadığını kanıtlar.
    await expect(fetchNewsArticlesGdelt('herhangi bir dizi', 'PS')).resolves.toEqual({
      unsupported: true,
      news: [],
    })
  })

  it('desteklenen ülke unsupported dönmez', () => {
    expect(isGdeltSupportedCountry('TR')).toBe(true)
    expect(isGdeltSupportedCountry('PS')).toBe(false)
  })
})
