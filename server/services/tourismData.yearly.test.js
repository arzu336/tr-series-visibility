import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseYearlyBulletin } from './tourismData.js'

const AYLAR = [
  'OCAK',
  'ŞUBAT',
  'MART',
  'NİSAN',
  'MAYIS',
  'HAZİRAN',
  'TEMMUZ',
  'AĞUSTOS',
  'EYLÜL',
  'EKİM',
  'KASIM',
  'ARALIK',
]

function kitap(sayfaAdi, satirlar) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Kapak']]), 'Kapak')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(satirlar), sayfaAdi)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

describe('parseYearlyBulletin — yıllık bülten T7 (milliyet × ay)', () => {
  const satirlar = [
    ["7- TÜRKİYE'YE GELEN YABANCI ZİYARETÇİLERİN MİLLİYETLERE VE AYLARA GÖRE DAĞILIMI - 2025"],
    ['', 'AYLAR'],
    ['MİLLİYET', ...AYLAR, 'TOPLAM'],
    ['Bulgaristan', ...AYLAR.map((_, i) => 1000 + i), 99999],
    ['Fas', ...AYLAR.map(() => 50), 600],
    ['DİĞ. AMERİKA', ...AYLAR.map(() => 7), 84],
    ['TOPLAM', ...AYLAR.map(() => 9), 108],
    ['Atlantis', ...AYLAR.map(() => 1), 12],
  ]

  it('ülke başına 12 ay; ara toplamlar ve TOPLAM sütunu alınmaz; eşleşmeyen ad bildirilir', () => {
    const { entries, unresolvedNames } = parseYearlyBulletin(kitap('T7-Mil-Ay Göre G.Yabancı', satirlar), 2025)
    const bg = entries.filter((e) => e.iso2 === 'BG')
    expect(bg).toHaveLength(12)
    expect(bg[0]).toEqual({ iso2: 'BG', year: 2025, month: 1, visitorCount: 1000 })
    expect(bg[11]).toEqual({ iso2: 'BG', year: 2025, month: 12, visitorCount: 1011 })
    expect(entries.filter((e) => e.iso2 === 'MA')).toHaveLength(12)
    expect(entries.some((e) => e.visitorCount === 99999 || e.visitorCount === 7 || e.visitorCount === 9)).toBe(false)
    expect(unresolvedNames).toEqual(['Atlantis'])
  })

  it('başlık satırının ilk hücresi boş olsa da (2016) ay adlarından tanınır', () => {
    const eski = satirlar.map((r, i) => (i === 2 ? [null, ...r.slice(1)] : r))
    expect(parseYearlyBulletin(kitap('T7-Mil-Ay Göre G.Yabancı', eski), 2016).entries).toHaveLength(24)
  })

  it('T7 sayfası yoksa açık hata', () => {
    expect(() => parseYearlyBulletin(kitap('Başka', satirlar), 2025)).toThrow(/T7/)
  })
})
