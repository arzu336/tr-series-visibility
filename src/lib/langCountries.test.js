import { describe, it, expect } from 'vitest'
import { LANG_COUNTRIES, UNMAPPED_LANGS, languagesOfCountry, countriesOfLanguage } from './langCountries.js'

describe('langCountries — dil → ülke tablosu', () => {
  it('her giriş geçerli ISO 639-1 dil kodu ve ISO 3166-1 alpha-2 ülke kodları taşır', () => {
    for (const [lang, spec] of Object.entries(LANG_COUNTRIES)) {
      expect(lang).toMatch(/^[a-z]{2,3}$/)
      expect(spec.iso.length).toBeGreaterThan(0)
      for (const iso of spec.iso) expect(iso).toMatch(/^[A-Z]{2}$/)
      expect(typeof spec.regional).toBe('boolean')
    }
  })

  it('tek ülkeli dil regional=false ve tam bir ülke; çok ülkeli dil regional=true', () => {
    for (const spec of Object.values(LANG_COUNTRIES)) {
      if (!spec.regional) expect(spec.iso).toHaveLength(1)
      else expect(spec.iso.length).toBeGreaterThan(1)
    }
    expect(countriesOfLanguage('bg')).toEqual({ regional: false, iso: ['BG'] })
    expect(countriesOfLanguage('es').regional).toBe(true)
  })

  it('İngilizce eşlenmez (ülke sinyali üretmez)', () => {
    expect(LANG_COUNTRIES.en).toBeUndefined()
    expect(UNMAPPED_LANGS.has('en')).toBe(true)
    expect(countriesOfLanguage('en')).toBeNull()
  })

  it('bir ülke birden çok dile eşlenebilir (Belçika: fr ve nl, ikisi de bölgesel)', () => {
    const be = languagesOfCountry('BE')
    expect(be.map((x) => x.lang).sort()).toEqual(['fr', 'nl'])
    expect(be.every((x) => x.regional)).toBe(true)
    // Kuzey Makedonya: mk (ülke sinyali) + sq (bölgesel) → ülke sinyali sayılır
    expect(languagesOfCountry('MK').some((x) => !x.regional)).toBe(true)
  })

  it('Türkiye yalnızca Türkçeye eşlenir', () => {
    expect(languagesOfCountry('TR')).toEqual([{ lang: 'tr', regional: false }])
  })
})
