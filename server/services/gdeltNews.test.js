import { describe, it, expect } from 'vitest'
import { normalizeGdeltArticles, seendateToIso, gdeltNewsCacheKey } from './gdeltNews.js'

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
