import { describe, it, expect, vi, beforeEach } from 'vitest'

// Haber bulunup ton analizi başarısız olduğunda kayıt 14 gün "yetersiz veri" kalmamalı: sonraki çağrıda
// haber yeniden aranmadan, kayıtlı haberlerle analiz yeniden denenir.

const analyze = vi.hoisted(() => vi.fn())
const gdelt = vi.hoisted(() => vi.fn())
vi.mock('../llm.js', () => ({ analyzeMediaSentiment: analyze }))
vi.mock('./gdeltNews.js', () => ({ fetchNewsArticlesGdeltCached: gdelt, TURKISH_CONTEXT: '(turkish OR turkey)' }))

const db = (await import('../db.js')).default
const { fetchAndAnalyzeSentiment } = await import('./newsSentiment.js')

beforeEach(() => {
  db.prepare('DELETE FROM media_sentiment WHERE series_id = 777').run()
  analyze.mockReset()
  gdelt.mockReset()
})

describe('ton analizi yeniden deneme', () => {
  it('ilk analiz başarısızsa kayıt haberleri saklar; sonraki çağrı GDELT’e gitmeden analizi tamamlar', async () => {
    gdelt.mockResolvedValue({ unsupported: false, news: [{ title: 'Turkish series Not a Stranger', source: 'x.com' }] })
    analyze.mockRejectedValueOnce(new Error('zaman aşımı'))
    const ilk = await fetchAndAnalyzeSentiment(777, 'Seni Tanıyorum', null, 'US', { englishTitles: ['Not a Stranger'] })
    expect(ilk.totalNewsCount).toBe(1)
    expect(ilk.dominantSentiment).toBe('yetersiz-veri')

    analyze.mockResolvedValueOnce({ positive: 0.8, neutral: 0.2, negative: 0, dominant: 'positive', summary: 'olumlu' })
    const ikinci = await fetchAndAnalyzeSentiment(777, 'Seni Tanıyorum', null, 'US', {
      englishTitles: ['Not a Stranger'],
    })
    expect(gdelt).toHaveBeenCalledTimes(1)
    expect(analyze).toHaveBeenCalledTimes(2)
    expect(ikinci.dominantSentiment).toBe('positive')
    expect(ikinci.totalNewsCount).toBe(1)
  })

  it('analizi başarılı kayıt yeniden analiz edilmez', async () => {
    gdelt.mockResolvedValue({ unsupported: false, news: [{ title: 'a', source: 'x.com' }] })
    analyze.mockResolvedValue({ positive: 0.5, neutral: 0.5, negative: 0, dominant: 'neutral', summary: 's' })
    await fetchAndAnalyzeSentiment(777, 'Seni Tanıyorum', null, 'US', { englishTitles: [] })
    await fetchAndAnalyzeSentiment(777, 'Seni Tanıyorum', null, 'US', { englishTitles: [] })
    expect(analyze).toHaveBeenCalledTimes(1)
  })
})
