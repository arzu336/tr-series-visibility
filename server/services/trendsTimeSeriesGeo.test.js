import { describe, it, expect } from 'vitest'
import { timeSeriesCacheKey } from './serpApiCache.js'
import { isValidIso2, normalizeIso2 } from './requestGuards.js'
import { countryNameFromIso2 } from './countryLookup.js'

describe('zaman serisi kapsamı (geo)', () => {
  it('küresel ve ülke bazlı seriler AYRI önbellek anahtarları kullanır', () => {
    const kuresel = timeSeriesCacheKey('Kuruluş Osman', null, 'today 12-m')
    const almanya = timeSeriesCacheKey('Kuruluş Osman', 'DE', 'today 12-m')
    expect(kuresel).not.toBe(almanya)
    expect(kuresel).toContain(':WW:')
    expect(almanya).toContain(':DE:')
  })

  it('iki ayrı ülke birbirinin önbelleğini EZMEZ', () => {
    const de = timeSeriesCacheKey('Kuruluş Osman', 'DE', 'today 12-m')
    const sa = timeSeriesCacheKey('Kuruluş Osman', 'SA', 'today 12-m')
    expect(de).not.toBe(sa)
  })

  it('aynı ülke küçük harfle gelse de tek bir anahtara düşer (ikinci ücretli çağrı açılmaz)', () => {
    const buyuk = timeSeriesCacheKey('Kuruluş Osman', normalizeIso2('DE'), 'today 12-m')
    const kucuk = timeSeriesCacheKey('Kuruluş Osman', normalizeIso2('de'), 'today 12-m')
    expect(buyuk).toBe(kucuk)
  })

  it('gerçek ülke kodlarını kabul eder', () => {
    for (const code of ['DE', 'SA', 'de', 'tr']) {
      expect(isValidIso2(code)).toBe(true)
    }
  })

  it('ülke OLMAYAN ve biçimsiz kodları dış çağrıya ulaşmadan eler', () => {
    for (const code of ['EU', 'EZ', 'ZZ', 'XX1', '', 'DEU', '../etc', null, undefined]) {
      expect(isValidIso2(code)).toBe(false)
    }
  })

  it('kapsam etiketi için okunabilir Türkçe ülke adı üretir', () => {
    expect(countryNameFromIso2('DE')).toBe('Almanya')
    expect(countryNameFromIso2('QQ')).toBe('QQ')
  })
})
