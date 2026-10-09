import { describe, it, expect, vi } from 'vitest'

vi.mock('../llm.js', () => ({ generateTrendMovementNotes: vi.fn(), direktifIceriyorMu: () => null }))
vi.mock('../tmdb.js', () => ({ getSeasonDates: vi.fn(async () => []) }))
vi.mock('../cache.js', () => ({ getCached: () => null, setCached: () => {} }))

const { detectMovements, listingEvents, eventsForMove, getTrendMovements } = await import('./trendMovements.js')

const W = 7 * 86400
const T0 = Date.parse('2026-01-05T00:00:00Z') / 1000
const seri = (values) => values.map((value, i) => ({ timestamp: T0 + i * W, value }))

describe('detectMovements — grafikteki belirgin hareketler', () => {
  it('yükseliş ve düşüşü bulur; küçük dalgalanmaları hareket saymaz', () => {
    const m = detectMovements(seri([10, 12, 11, 30, 70, 100, 95, 60, 40, 42, 38, 41]))
    expect(m.map((x) => [x.kind, x.fromValue, x.toValue])).toEqual([
      ['yükseliş', 11, 100],
      ['düşüş', 95, 38],
    ])
    // Başlangıç, değerin yerinden ayrılmaya başladığı haftaya kırpılır (uzun düz dönem harekete katılmaz).
    expect(m[0].from).toBe(T0 + 2 * W)
  })

  it('düz seride hareket yok', () => {
    expect(detectMovements(seri([50, 52, 49, 51, 50, 53]))).toEqual([])
  })
})

describe('listingEvents — liste girişleri ve çıkışları', () => {
  it('yeni giren ülkeler haftasında; iki ve daha fazla ülkeden çıkış ayrıca', () => {
    const ev = listingEvents([
      { iso2: 'MX', date: '2026-03-03' },
      { iso2: 'MX', date: '2026-03-10' },
      { iso2: 'AR', date: '2026-03-11' },
      { iso2: 'CL', date: '2026-03-12' },
      { iso2: 'MX', date: '2026-03-17' },
    ])
    expect(ev.map((e) => [e.type, e.countries.sort()])).toEqual([
      ['listeye girdi', ['MX']],
      ['listeye girdi', ['AR', 'CL']],
      ['listeden çıktı', ['AR', 'CL']],
    ])
  })
})

describe('getTrendMovements — her hareket için olaylar ve yorum', () => {
  const timeline = seri([10, 12, 11, 30, 70, 100, 95, 60, 40, 42, 38, 41])
  const deps = {
    readListings: () => [{ iso2: 'MX', date: '2026-01-12' }],
    readNews: () => [],
    readSeasons: async () => [],
  }

  it('dil modeli yorumu hareket sırasıyla eşleşir; olaylar penceresinde', async () => {
    const llm = vi.fn(async () => ({
      notes: ['Meksika’da listeye girişle aynı döneme denk geliyor.', 'Kayıtlı gelişme yok.'],
      summary: 'Kısa yükseliş.',
    }))
    const r = await getTrendMovements(1, 'Dizi', timeline, null, { deps: { ...deps, llm } })
    expect(r.source).toBe('yapay-zeka')
    expect(r.movements).toHaveLength(2)
    expect(r.movements[0].events[0].text).toMatch(/1 ülkede listeye girdi \(Meksika\)/)
    expect(r.movements[0].note).toMatch(/Meksika/)
    expect(r.summary).toBe('Kısa yükseliş.')
    expect(llm.mock.calls[0][2][0].eventTexts[0]).toMatch(/listeye girdi/)
  })

  it('dil modeli ulaşılamazsa kurallı not yazılır, yorum boş kalmaz', async () => {
    const llm = vi.fn(async () => {
      throw new Error('zaman aşımı')
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await getTrendMovements(1, 'Dizi', timeline, null, { deps: { ...deps, llm } })
    expect(r.source).toBe('kural')
    expect(r.movements[0].note).toMatch(/listeye girdi/)
    expect(r.movements[1].note).toMatch(/kayıtlı bir gelişme bulunmuyor/)
    err.mockRestore()
  })

  it('Türkçe olmayan yazı karışmış yorum atılır, yerine kurallı not', async () => {
    const llm = vi.fn(async () => ({ notes: ['İlgi 随后的 haftalarda arttı.', 'Tamam.'], summary: '随后的' }))
    const r = await getTrendMovements(1, 'Dizi', timeline, null, { deps: { ...deps, llm } })
    expect(r.movements[0].note).toMatch(/listeye girdi/)
    expect(r.movements[1].note).toBe('Tamam.')
    expect(r.summary).toBeNull()
  })

  it('pencere: hareketten 3 hafta önce ile 1 hafta sonrası', () => {
    const move = { from: T0 + 4 * W, to: T0 + 6 * W }
    const ev = eventsForMove(move, [
      { ts: T0, type: 'haber' },
      { ts: T0 + 2 * W, type: 'haber' },
      { ts: T0 + 7 * W, type: 'sezon başladı' },
      { ts: T0 + 9 * W, type: 'haber' },
    ])
    expect(ev.map((e) => e.ts)).toEqual([T0 + 7 * W, T0 + 2 * W])
  })
})
