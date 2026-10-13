import { describe, it, expect, beforeEach } from 'vitest'
import db from '../db.js'
import { recordPress, recordWatchSignals, recordAvailability, recordTrendsWindow } from './historyStore.js'

beforeEach(() => {
  for (const t of ['press_history', 'watch_signal_daily', 'availability_spans', 'trends_windows'])
    db.exec(`DELETE FROM ${t}`)
})

describe('historyStore — tarihe göre rapor için geçmiş', () => {
  it('basın: her tarama günü ayrı kayıt; aynı gün ikinci tarama ilkinin yerine geçer', () => {
    const row = { series_id: 1, country_iso2: 'DE', source: 'google_news', total_news_count: 3, positive_score: 0.5 }
    recordPress(row, new Date('2026-10-01T10:00:00Z'))
    recordPress({ ...row, total_news_count: 5 }, new Date('2026-10-01T18:00:00Z'))
    recordPress({ ...row, total_news_count: 8 }, new Date('2026-10-15T10:00:00Z'))
    const rows = db.prepare('SELECT scanned_on, total_news_count FROM press_history ORDER BY scanned_on').all()
    expect(rows.map((r) => [r.scanned_on, r.total_news_count])).toEqual([
      ['2026-10-01', 5],
      ['2026-10-15', 8],
    ])
  })

  it('izlenme düzeyi: günde bir kez; bileşenler yüzdelik olarak', () => {
    const byIso2 = {
      DE: {
        index: 61,
        level: 'Yüksek',
        provisional: null,
        components: { lists: { present: true, p: 53 }, press: { present: false } },
      },
    }
    expect(recordWatchSignals(byIso2, new Date('2026-10-13T08:00:00Z'))).toBe(true)
    expect(recordWatchSignals(byIso2, new Date('2026-10-13T20:00:00Z'))).toBe(false)
    const r = db.prepare('SELECT * FROM watch_signal_daily').get()
    expect(r).toMatchObject({ iso2: 'DE', date: '2026-10-13', idx: 61, level: 'Yüksek', provisional: 0 })
    expect(JSON.parse(r.components)).toEqual({ lists: 53, press: null })
  })

  it('yayın durumu: dizi × ülke × platform aralığı; son görüldüğü gün ilerler', () => {
    const p = { 7: { DE: { flatrate: [{ provider_name: 'Netflix' }], rent: [{ provider_name: 'Apple TV' }] } } }
    recordAvailability(p, new Date('2026-10-01T08:00:00Z'))
    recordAvailability(p, new Date('2026-10-20T08:00:00Z'))
    const rows = db.prepare('SELECT * FROM availability_spans').all()
    expect(rows).toEqual([
      { series_id: 7, iso2: 'DE', platform: 'Netflix', first_seen: '2026-10-01', last_seen: '2026-10-20' },
    ])
  })

  it('arama ilgisi: seri kendi aralığıyla saklanır', () => {
    const t0 = Date.parse('2025-10-05T00:00:00Z') / 1000
    recordTrendsWindow({
      query: 'Seni Tanıyorum',
      iso2: null,
      queriedAt: '2026-10-13T00:00:00Z',
      timeline: [
        { timestamp: t0, value: 0 },
        { timestamp: t0 + 7 * 86400, value: 100 },
      ],
    })
    const r = db.prepare('SELECT query, geo, window_start, window_end FROM trends_windows').get()
    expect(r).toEqual({ query: 'seni tanıyorum', geo: 'WW', window_start: '2025-10-05', window_end: '2025-10-12' })
  })
})
