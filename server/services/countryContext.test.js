import { describe, it, expect, beforeEach } from 'vitest'
import db from '../db.js'
import { getCountryContext, PARENT_COUNTRY } from './countryContext.js'

beforeEach(() => {
  db.prepare("DELETE FROM media_sentiment WHERE country_iso2 IN ('GL', 'RW')").run()
  db.prepare("DELETE FROM foreign_students WHERE iso2 = 'RW'").run()
})

const sentiment = db.prepare(`
  INSERT INTO media_sentiment (series_id, country_iso2, query_used, total_news_count, positive_score, neutral_score,
    negative_score, dominant_sentiment, llm_summary, raw_articles, created_at, expires_at, source)
  VALUES (?, ?, 'q', ?, ?, NULL, ?, 'x', NULL, '[]', '2026-10-06', 0, 'gdelt')
`)

describe('getCountryContext — yayın kataloğu olmayan ülkenin paneli', () => {
  it('bağlı ülke: o ülkenin bu haftaki ilk 5 dizisi; küçük bölgeler eşlenmez', async () => {
    const rankings = new Map([
      ['DK', { to: '2026-10-06', current: [{ seriesId: 1, name: 'Uzak Şehir', position: 1 }] }],
    ])
    const c = await getCountryContext('gl', { rankings })
    expect(c.parent).toEqual({
      iso2: 'DK',
      week: '2026-10-06',
      now: [{ seriesId: 1, name: 'Uzak Şehir', position: 1 }],
    })
    expect(PARENT_COUNTRY.GI).toBeUndefined()
    expect(PARENT_COUNTRY.GG).toBeUndefined()
    expect((await getCountryContext('RW', { rankings })).parent).toBeNull()
  })

  it('öğrenci ve basın özeti; veri yoksa null', async () => {
    const rankings = new Map()
    expect(await getCountryContext('RW', { rankings })).toMatchObject({ students: null, press: null })
    db.prepare("INSERT INTO foreign_students (iso2, year, students, imported_at) VALUES ('RW', 2023, 120, 'x')").run()
    sentiment.run(1, 'RW', 3, 0.7, 0.1)
    sentiment.run(2, 'RW', 0, null, null)
    const c = await getCountryContext('RW', { rankings })
    expect(c.students).toMatchObject({ year: 2023, students: 120 })
    expect(c.press).toEqual({ scanned: 2, series: 2, withNews: 1, news: 3, tone: 'olumlu', positivePct: 70 })
  })
})
