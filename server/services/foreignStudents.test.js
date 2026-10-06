import { describe, it, expect } from 'vitest'
import { normalizeName, resolveUnCountry, pickOriginIndicators } from './foreignStudents.js'

describe('UNESCO ülke adları → ISO2', () => {
  it('adlandırma farkları ve yazım biçimleri', () => {
    expect(resolveUnCountry('Egypt')).toBe('EG')
    expect(resolveUnCountry('the Islamic Republic of Iran')).toBe('IR')
    expect(resolveUnCountry('Bosnia and Herzegovina')).toBe('BA')
    expect(resolveUnCountry('the Russian Federation')).toBe('RU')
    expect(resolveUnCountry("Côte d'Ivoire")).toBe('CI')
    expect(resolveUnCountry('Republic of Korea')).toBe('KR')
    expect(resolveUnCountry('unknown countries')).toBeNull()
    expect(normalizeName('East Timor')).toBe('east timor') // "st " kelime içinde değiştirilmez
  })

  it('yalnızca "Students from X, both sexes (number)" göstergeleri; eşleşmeyenler ayrıca bildirilir', () => {
    const { indicators, unresolved } = pickOriginIndicators([
      {
        indicatorCode: '1',
        name: 'Inbound internationally mobile students from Africa: Students from Egypt, both sexes (number)',
      },
      { indicatorCode: '2', name: 'Inbound internationally mobile students from Africa, both sexes (number)' },
      {
        indicatorCode: '3',
        name: 'Inbound internationally mobile students from Asia: Students from unknown countries, both sexes (number)',
      },
      { indicatorCode: '4', name: 'Official entrance age to primary education (years)' },
    ])
    expect(indicators).toEqual([{ code: '1', iso2: 'EG', origin: 'Egypt' }])
    expect(unresolved).toEqual(['unknown countries'])
  })
})
