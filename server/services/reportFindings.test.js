import { describe, it, expect } from 'vitest'
import { generateFindings, candidateFindings, MAX_FINDINGS } from './reportFindings.js'
import { direktifIceriyorMu } from '../llm.js'

const ok = (data) => ({ status: 'hesaplandi', data })
const yok = { status: 'hesaplanamaz', reason: 'x' }

const TAM = {
  ranking: ok({ rank: 3, of: 111, index: 97, level: 'çok yüksek', confidence: 'yüksek' }),
  trend: ok({ shortTerm: { direction: 'yükseliyor', changePct: 12.4, windowDays: 7 } }),
  netflix: ok({
    rows: [
      { name: 'The Tailor', peakRank: 1, weeksInTop10: 21 },
      { name: 'Another Self', peakRank: 3, weeksInTop10: 4 },
    ],
  }),
  themes: ok({ items: [{ theme: 'aile', sharePct: 41.2 }] }),
  pressTone: ok({ mediaTone: { status: 'hesaplandi', value: 63.4, sampleSize: 9 } }),
}

describe('generateFindings — kural tabanlı, deterministik', () => {
  it('en fazla 3 bulgu, öncelik sırasıyla (izleyici sinyalleri önce, yayın varlığı sonda)', () => {
    const { items, dropped } = generateFindings(TAM)
    expect(items).toHaveLength(MAX_FINDINGS)
    expect(items.map((f) => f.basis)).toEqual(['ranking', 'pressTone', 'themes'])
    expect(items[0].text).toContain('111 ülke arasında 3. sırada')
    expect(dropped).toBe(0)
    // üst sınır parametresi: tüm adaylar sırasıyla
    expect(generateFindings(TAM, { max: 10 }).items.map((f) => f.basis)).toEqual([
      'ranking',
      'pressTone',
      'themes',
      'netflix',
      'trend',
    ])
  })

  it('"diğer" teması bulgu üretmez', () => {
    const f = candidateFindings({ themes: ok({ items: [{ theme: 'diğer', sharePct: 30 }] }) })
    expect(f).toEqual([])
  })

  it('aynı girdi aynı çıktıyı verir', () => {
    expect(generateFindings(TAM)).toEqual(generateFindings(TAM))
  })

  it('veri eksikse bulgu sayısı düşer, uydurmaz', () => {
    const { items } = generateFindings({ ranking: yok, trend: yok, netflix: yok, themes: TAM.themes, pressTone: yok })
    expect(items).toHaveLength(1)
    expect(items[0].basis).toBe('themes')
    expect(generateFindings({}).items).toEqual([])
  })

  it('hiçbir bulgu aksiyon önerisi içermez (iddia kapısı)', () => {
    for (const f of candidateFindings(TAM)) expect(direktifIceriyorMu(f.text)).toBeNull()
  })

  it('sıralama bulgusu düzeyi ve sırayı yazar; skor/puan kelimesi geçmez', () => {
    const { items } = generateFindings({ ranking: ok({ rank: 40, of: 137, level: 'orta' }) })
    expect(items[0].text).toMatch(/"orta".*137 ülke arasında 40\. sırada/)
    expect(items[0].text).not.toMatch(/skor|puan|görünürlük/i)
  })

  it('trend yetersiz-veri ise trend bulgusu üretmez; sabit ise "sabit kaldı" der', () => {
    expect(
      generateFindings({ trend: ok({ shortTerm: { direction: 'yetersiz-veri', changePct: null } }) }).items
    ).toEqual([])
    const sabit = generateFindings({ trend: ok({ shortTerm: { direction: 'sabit', changePct: 1.2, windowDays: 8 } }) })
    expect(sabit.items[0].text).toMatch(/sabit kaldı/)
  })

  it('metinler 160 karakteri aşmaz', () => {
    const uzun = { ...TAM, netflix: ok({ rows: [{ name: 'X'.repeat(300), peakRank: 2, weeksInTop10: 1 }] }) }
    for (const f of candidateFindings(uzun)) expect(f.text.length).toBeLessThanOrEqual(160)
  })
})

describe('platform listeleri ve IMDb bulguları', () => {
  const lists = {
    status: 'hesaplandi',
    data: {
      now: [
        { name: 'Uzak Şehir', position: 2, weeks: 3 },
        { name: 'Seni Tanıyorum', position: 1, weeks: 5 },
      ],
    },
  }
  const imdb = {
    status: 'hesaplandi',
    data: {
      entries: [
        { name: 'A', imdb: { rating: 7.4, votes: 1, growth7: { votes: 1200, days: 7 } } },
        { name: 'B', imdb: { rating: 8.1, votes: 1, growth7: { votes: 80, days: 7 } } },
        { name: 'C', imdb: null },
      ],
    },
  }

  it('listede kaç Türk dizisi ve en iyi sıra; en çok oy artışı alan dizi', () => {
    const f = candidateFindings({ lists, imdb })
    expect(f.map((x) => x.basis)).toEqual(['lists', 'imdb'])
    expect(f[0].text).toBe('Bu hafta 2 Türk dizisi sıralamada; ilk sırada Seni Tanıyorum (5 haftadır listede).')
    expect(f[1].text).toBe('A son 7 günde 1.200 yeni izleyici oyu aldı (izleyici puanı 7,4).')
    for (const x of f) expect(direktifIceriyorMu(x.text)).toBeFalsy()
  })

  it('oy artışı ölçülmemişse IMDb bulgusu yok; listede dizi yoksa liste bulgusu yok', () => {
    const f = candidateFindings({
      lists: { status: 'hesaplandi', data: { now: [] } },
      imdb: { status: 'hesaplandi', data: { entries: [{ name: 'A', imdb: { rating: 7, growth7: null } }] } },
    })
    expect(f).toEqual([])
  })
})

describe('öğrenci bulgusu', () => {
  it('son yıl sayısı ve 5 yıllık değişim', () => {
    const f = candidateFindings({
      students: ok({ year: 2023, students: 5120, baseYear: 2018, changePct: 104 }),
    })
    expect(f).toEqual([
      { text: "2023'te bu ülkeden Türkiye'de 5.120 öğrenci okuyordu; 2018'e göre %104 artış.", basis: 'students' },
    ])
  })
})
