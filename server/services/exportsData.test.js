import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseExportsFile, resolveExportCountry, fileUrl, SECTOR_TOTAL, COUNTRY_ALL } from './exportsData.js'

function workbook(rows) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'GUNLUK_SEKTOR_ULKE')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

describe('exportsData — dosya ayrıştırma', () => {
  it('aylık sütun grubunu bulur, 1000 $ → $, ülke toplamını sektörlerden kurar, Türkiye genelini ALL olarak saklar', () => {
    const buf = workbook([
      ['30.09.2026 Konsolide Ülkelere Göre Sektörel İhracat  (1000 $)'],
      [],
      [null, null, '1 - 30 EYLÜL', null, null, '1 - 31 AĞUSTOS', null, '1 OCAK  -  30 EYLÜL'],
      ['SEKTÖR', 'ULKE', 2025, 2026, 'DEĞ.', 2026, 'DEĞ.', 2025, 2026, 'DEĞ.'],
      [' Halı', 'ALMANYA', 10, 12, 0.2, 11, 0.09, 90, 100, 0.1],
      [' Halı', 'DUBAİ', 1, 2, 1, 1, 1, 9, 10, 0.1],
      [' Halı', 'ABUDABİ', 1, 1, 0, 1, 0, 9, 10, 0.1],
      [' Halı', 'EGE SERBEST BÖLGESİ', 5, 5, 0, 5, 0, 5, 5, 0],
      [' Halı', 'TOPLAM', 500, 600, 0.2, 550, 0.09, 4000, 4500, 0.1],
      [' Çelik ', 'ALMANYA', 20, 18, -0.1, 19, -0.05, 180, 170, -0.05],
      ['TOPLAM', 'TOPLAM', 9000, 9900, 0.1, 9500, 0.04, 80000, 88000, 0.1],
    ])
    const p = parseExportsFile(buf)
    expect(p.year).toBe(2026)
    expect(p.month).toBe(9)
    expect(p.unresolved).toEqual([])
    const find = (iso2, sector, year) =>
      p.rows.find((r) => r.iso2 === iso2 && r.sector === sector && r.year === year)?.usd
    expect(find('DE', 'Halı', 2026)).toBe(12000)
    expect(find('DE', 'Halı', 2025)).toBe(10000)
    expect(find('DE', 'Çelik', 2026)).toBe(18000)
    expect(find('DE', SECTOR_TOTAL, 2026)).toBe(30000)
    expect(find('AE', 'Halı', 2026)).toBe(3000) // emirlikler toplanır
    expect(find(COUNTRY_ALL, 'Halı', 2026)).toBe(600000)
    expect(find(COUNTRY_ALL, SECTOR_TOTAL, 2026)).toBe(9900000)
    expect(p.rows.some((r) => r.iso2 === 'ALL' && r.sector === 'Halı' && r.year === 2025)).toBe(true)
  })

  it('eski dosya düzeni (günlük grup önde, 13 sütun) ve küçük harf karışık ay adı', () => {
    const buf = workbook([
      ['31.05.2016 Konsolide Ülkelere Göre Sektörel İhracat  (1000 $)'],
      [],
      [null, null, 42521, null, null, '1 - 31 MAYıS', null, null, '1 - 30 NISAN', null, '1 OCAK  -  31 MAYıS'],
      ['SEKTÖR', 'ULKE', 2015, 2016, 'DEĞ.', 2015, 2016, 'DEĞ.', 2016, 'DEĞ.', 2015, 2016, 'DEĞ.'],
      [' Halı', 'HINDISTAN', 1, 1, 0, 30, 33, 0.1, 31, 0.06, 150, 160, 0.06],
    ])
    const p = parseExportsFile(buf)
    expect(p.month).toBe(5)
    expect(p.rows.find((r) => r.iso2 === 'IN' && r.sector === 'Halı' && r.year === 2016).usd).toBe(33000)
    expect(p.rows.find((r) => r.iso2 === 'IN' && r.sector === 'Halı' && r.year === 2015).usd).toBe(30000)
  })

  it('başlık yılı sütun yılıyla uyuşmazsa hata', () => {
    const buf = workbook([
      ['30.09.2026 Konsolide'],
      [],
      [null, null, '1 - 30 EYLÜL'],
      ['SEKTÖR', 'ULKE', 2024, 2025, 'DEĞ.'],
      [' Halı', 'ALMANYA', 1, 2, 1],
    ])
    expect(() => parseExportsFile(buf)).toThrow(/uyuşmuyor/)
  })
})

describe('exportsData — ülke adları ve adresler', () => {
  it('Türkçe büyük harf, kısaltma ve eski yazımlar çözülür; serbest bölge ve KKTC atlanır', () => {
    expect(resolveExportCountry('ABD')).toBe('US')
    expect(resolveExportCountry('BAE')).toBe('AE')
    expect(resolveExportCountry('RUSYA FEDERASYONU')).toBe('RU')
    expect(resolveExportCountry('HINDISTAN')).toBe('IN')
    expect(resolveExportCountry('FILIPINLER')).toBe('PH')
    expect(resolveExportCountry('GÜNEY KORE CUMHURİYE')).toBe('KR')
    expect(resolveExportCountry('İRAN (İSLAM CUM.)')).toBe('IR')
    expect(resolveExportCountry('KONGO DEM.C.(ZAİRE)')).toBe('CD')
    expect(resolveExportCountry('MERSİN SERBEST BÖLGESİ')).toBeNull()
    expect(resolveExportCountry('KUZEY KIBRIS TÜRK CUM.')).toBeNull()
    expect(resolveExportCountry('BELİRLENEMEYEN ÜLKE VE BÖLGELER')).toBeNull()
  })

  it('dosya adresi: ay klasörü sıfırsız, dosya adı sıfırlı; 2014 ve öncesi eski kalıp', () => {
    expect(fileUrl(2026, 9)[0]).toMatch(/\/2026\/9\/2026-09-ulkelere-gore-sektorel-ihracat-rakamlari\.xlsx$/)
    expect(fileUrl(2016, 5)[1]).toMatch(/\.xls$/)
    expect(fileUrl(2013, 2)[0]).toMatch(/sektor_ulke_02_2013\.xls$/)
  })
})
