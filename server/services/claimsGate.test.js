import { describe, it, expect } from 'vitest'
import {
  isClaimLike,
  onlyVerifiedClaims,
  countUnverified,
  sanitizeClaimsPayload,
} from './claimsGate.js'

const dogrulanmis = { claim_id: 'a', passed_gates: true, failed_gates: [], change_pct: 45.5 }
const dogrulanmamis = { claim_id: 'b', passed_gates: false, failed_gates: ['volume'], change_pct: 100 }
const bayraksiz = { claim_id: 'c', change_pct: 12 }

describe('isClaimLike', () => {
  it('passed_gates alanı olanı iddia sayar', () => {
    expect(isClaimLike(dogrulanmis)).toBe(true)
    expect(isClaimLike(dogrulanmamis)).toBe(true)
  })

  it('alanı olmayan rastgele veriyi iddia SAYMAZ', () => {
    expect(isClaimLike({ iso2: 'BR', score: 814 })).toBe(false)
    expect(isClaimLike(null)).toBe(false)
    expect(isClaimLike('metin')).toBe(false)
    expect(isClaimLike(42)).toBe(false)
  })
})

describe('onlyVerifiedClaims', () => {
  it('doğrulanmamış iddiayı ELER', () => {
    const sonuc = onlyVerifiedClaims([dogrulanmis, dogrulanmamis])
    expect(sonuc).toHaveLength(1)
    expect(sonuc[0].claim_id).toBe('a')
  })

  it('bayrağı EKSİK olanı da eler — yokluk "doğrulanmış" demek değil', () => {
    expect(onlyVerifiedClaims([bayraksiz])).toEqual([])
  })

  it('iddia olmayan öğelere dokunmaz', () => {
    const veri = [{ iso2: 'BR' }, { iso2: 'SO' }]
    expect(onlyVerifiedClaims(veri)).toHaveLength(2)
  })

  it('dizi olmayan girdide çökmez', () => {
    expect(onlyVerifiedClaims(null)).toEqual([])
    expect(onlyVerifiedClaims(undefined)).toEqual([])
    expect(onlyVerifiedClaims({})).toEqual([])
  })

  it('boş dizi boş döner', () => {
    expect(onlyVerifiedClaims([])).toEqual([])
  })
})

describe('countUnverified', () => {
  it('elenen sayısını verir — "hiç yok" ile "hepsi elendi" ayrılabilsin', () => {
    expect(countUnverified([dogrulanmis, dogrulanmamis, bayraksiz])).toBe(2)
    expect(countUnverified([dogrulanmis])).toBe(0)
  })
})

describe('sanitizeClaimsPayload', () => {
  it('iç içe yapıdaki iddia listelerini süzer', () => {
    const yanit = {
      iso2: 'BR',
      dimensions: {
        cultural: { claims: [dogrulanmis, dogrulanmamis] },
        tourism: { claims: [dogrulanmamis] },
      },
    }
    const { payload, removed } = sanitizeClaimsPayload(yanit)
    expect(removed).toBe(2)
    expect(payload.dimensions.cultural.claims).toHaveLength(1)
    expect(payload.dimensions.tourism.claims).toEqual([])
  })

  it('iddia içermeyen yanıtı DEĞİŞTİRMEZ', () => {
    const yanit = { iso2: 'SO', dimensions: { export: { visibilityScore: { value: 12 } } } }
    const { payload, removed } = sanitizeClaimsPayload(yanit)
    expect(removed).toBe(0)
    expect(payload.dimensions.export.visibilityScore.value).toBe(12)
  })

  it('dizi içindeki nesneleri de gezer', () => {
    const yanit = { countries: [{ iso2: 'BR', claims: [dogrulanmamis] }] }
    const { payload, removed } = sanitizeClaimsPayload(yanit)
    expect(removed).toBe(1)
    expect(payload.countries[0].claims).toEqual([])
  })

  it('bozuk girdide çökmez', () => {
    expect(sanitizeClaimsPayload(null).removed).toBe(0)
    expect(sanitizeClaimsPayload('metin').removed).toBe(0)
  })
})
