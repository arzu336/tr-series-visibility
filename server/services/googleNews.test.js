import { describe, it, expect, vi } from 'vitest'

vi.mock('./serpApiCache.js', () => ({
  cacheFirstSerpApi: async (_key, _ttl, fn) => fn(),
  serpapiGet: vi.fn(),
  getSerpApiUsageThisMonth: () => ({ used: 0, budget: 5000 }),
  refreshSerpApiAccountUsage: async () => null,
}))
vi.mock('./gdeltNews.js', () => ({ fetchNewsArticlesGdeltCached: vi.fn() }))

const { buildGoogleNewsQuery, normalizeGoogleNews, newsLanguageOf, fetchPressArticles, googleNewsAvailable } =
  await import('./googleNews.js')

const NOW = Date.parse('2026-10-07T12:00:00Z')

describe('Google Haberler sorgusu', () => {
  it('Türkçe ad tek başına; yerel ad haberin dilindeki "Türk" kelimesiyle; İngilizce ad yalnızca İngilizce sürümde', () => {
    const turkishNames = ['Seni Tanıyorum', 'Seni Taniyorum']
    const phrases = [...turkishNames, 'Not a Stranger', 'Te conozco']
    expect(buildGoogleNewsQuery({ phrases, turkishNames, englishTitles: ['Not a Stranger'], hl: 'es' })).toBe(
      '"Seni Tanıyorum" OR "Seni Taniyorum" OR ("Te conozco" turca)'
    )
    expect(
      buildGoogleNewsQuery({ phrases: phrases.slice(0, 3), turkishNames, englishTitles: ['Not a Stranger'], hl: 'en' })
    ).toBe('"Seni Tanıyorum" OR "Seni Taniyorum" OR ("Not a Stranger" Turkish)')
  })

  it('kısa Türkçe ad da genel sayılır', () => {
    expect(buildGoogleNewsQuery({ phrases: ['Ezel'], turkishNames: ['Ezel'], hl: 'de' })).toBe('("Ezel" türkische)')
  })

  it('haber dili: ülkeye özgü dil önce; bilinmiyorsa İngilizce', () => {
    expect(newsLanguageOf('DE')).toBe('de')
    expect(newsLanguageOf('MX')).toBe('es')
    expect(newsLanguageOf('XX')).toBe('en')
  })
})

describe('normalizeGoogleNews', () => {
  it('başlıkta dizi adı geçmeyen ve 3 aydan eski haberler süzülür; aksan/büyük harf fark etmez', () => {
    const news = normalizeGoogleNews(
      [
        {
          title: 'Final de TE CONOZCO: lo que pasó',
          link: 'https://a.es/1',
          iso_date: '2026-10-01T10:00:00Z',
          source: { name: 'A' },
        },
        { title: 'Otra novela turca arrasa', link: 'https://a.es/2', iso_date: '2026-10-02T10:00:00Z' },
        { title: 'Te conozco llega a España', link: 'https://a.es/3', iso_date: '2026-03-01T10:00:00Z' },
        { highlight: { title: 'Seni Tanıyorum yeni sezon', link: 'https://a.es/4', iso_date: '2026-09-20T10:00:00Z' } },
      ],
      { phrases: ['Seni Tanıyorum', 'Te conozco'], hl: 'es', now: NOW }
    )
    expect(news.map((n) => n.url)).toEqual(['https://a.es/1', 'https://a.es/4'])
    expect(news[0]).toMatchObject({ source: 'A', snippet: null, language: 'es' })
  })
})

describe('fetchPressArticles — kaynak seçimi', () => {
  const args = { phrases: ['Kızılcık Şerbeti'], iso2: 'DE' }

  it('Google Haberler kullanılabiliyorsa oradan; kaynak google_news', async () => {
    const get = vi.fn(async () => ({
      news_results: [
        { title: 'Kızılcık Şerbeti im Fernsehen', link: 'https://x.de/1', iso_date: '2026-10-05T00:00:00Z' },
      ],
    }))
    const gdelt = vi.fn()
    const r = await fetchPressArticles(args, { get, gdelt, available: () => true })
    expect(get).toHaveBeenCalledWith({ engine: 'google_news', q: '"Kızılcık Şerbeti"', gl: 'de', hl: 'de' })
    // turkishNames verilmezse ilk iki ad (Türkçe ad + Türkçe harfsiz yazım) ayırt edici sayılır.
    expect(r.source).toBe('google_news')
    expect(r.news).toHaveLength(1)
    expect(gdelt).not.toHaveBeenCalled()
  })

  it('Google hata verirse (kota / desteklenmeyen ülke) GDELT ile sürer', async () => {
    const get = vi.fn(async () => {
      throw new Error('Unsupported country')
    })
    const gdelt = vi.fn(async () => ({ unsupported: false, news: [] }))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await fetchPressArticles(args, { get, gdelt, available: () => true })
    expect(r.source).toBe('gdelt')
    expect(gdelt).toHaveBeenCalled()
    err.mockRestore()
  })

  it('Google sonuçsuz aramayı hata olarak döndürürse "haber yok" sayılır ve GDELT kullanılmaz', async () => {
    const get = vi.fn(async () => {
      throw new Error("İstek hatası: Google News hasn't returned any results for this query.")
    })
    const gdelt = vi.fn()
    const r = await fetchPressArticles(args, { get, gdelt, available: () => true })
    expect(r).toMatchObject({ source: 'google_news', news: [] })
    expect(gdelt).not.toHaveBeenCalled()
  })

  it('kotanın basına ayrılan payı dolduysa Google hiç denenmez', async () => {
    expect(googleNewsAvailable({ used: 4300, budget: 5000 })).toBe(false)
    const get = vi.fn()
    const gdelt = vi.fn(async () => ({ unsupported: false, news: [] }))
    const r = await fetchPressArticles(args, { get, gdelt, available: () => false })
    expect(get).not.toHaveBeenCalled()
    expect(r.source).toBe('gdelt')
  })
})
