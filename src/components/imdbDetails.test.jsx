import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import EpisodeHeatmap, { ratingColor } from './EpisodeHeatmap.jsx'
import { groupLocalizedTitles } from './SeriesPage.jsx'
import Avatar, { initialsOf } from './Avatar.jsx'

describe('groupLocalizedTitles — uluslararası adlar', () => {
  it('aynı adı kullanan ülkeler birleşir; Türkçe ad ve aksansız hâli gösterilmez', () => {
    const localized = [
      { region: 'TR', title: 'Kuruluş: Osman' },
      { region: 'DE', title: 'Kurulus: Osman' },
      { region: 'US', title: 'Establishment: Osman' },
      { region: 'GB', title: 'Establishment: Osman' },
      { region: 'RU', title: 'Основание: Осман' },
    ]
    expect(groupLocalizedTitles(localized, 'Kuruluş: Osman')).toEqual([
      { title: 'Establishment: Osman', regions: ['US', 'GB'] },
      { title: 'Основание: Осман', regions: ['RU'] },
    ])
    expect(groupLocalizedTitles(undefined, 'X')).toEqual([])
  })
})

describe('EpisodeHeatmap', () => {
  const seasons = [
    {
      season: 1,
      episodes: [
        { episode: 1, rating: 9.2, votes: 80 },
        { episode: 2, rating: 6.4, votes: 40 },
        { episode: 3, rating: null, votes: null },
      ],
    },
    { season: 2, episodes: [{ episode: 1, rating: 4.8, votes: 30 }] },
  ]

  it('puan renkleri eşiklere göre; puansız bölüm renksiz', () => {
    expect(ratingColor(9.2)).toBe('#1a9850')
    expect(ratingColor(6.4)).toBe('#fee08b')
    expect(ratingColor(4.8)).toBe('#f46d43')
    expect(ratingColor(null)).toBeNull()
  })

  it('özet, sezon ortalaması ve ipuçları; 3ten az puanlı bölümde hiç çizilmez', () => {
    const html = renderToString(<EpisodeHeatmap seasons={seasons} />).replaceAll('<!-- -->', '')
    expect(html).toContain('3/4 bölüm puanlı')
    expect(html).toContain('En iyi bölüm')
    expect(html).toContain('1. sezon 1. bölüm · 80 oy')
    expect(html).toContain('En zayıf bölüm')
    expect(html).toContain('2. sezon 1. bölüm · 30 oy')
    expect(html).toContain('düştü') // 1. sezon 7.8 → 2. sezon 4.8
    expect(html).toContain('episode-map__cell--best')
    expect(html).toContain('7.8') // 1. sezon ortalaması (9.2 + 6.4) / 2
    expect(html).toContain('1. sezon 3. bölüm: puan yok')
    expect(
      renderToString(<EpisodeHeatmap seasons={[{ season: 1, episodes: [{ episode: 1, rating: 8, votes: 1 }] }]} />)
    ).toBe('')
  })
})

describe('Avatar — fotoğrafsız oyuncu', () => {
  it('baş harfler', () => {
    expect(initialsOf('Orhan Becerir')).toBe('OB')
    expect(initialsOf('ilkay  kayku')).toBe('İK')
    expect(initialsOf('Tarkan')).toBe('T')
    const html = renderToString(<Avatar name="Orhan Becerir" src={null} className="cast-bar__photo" />)
    expect(html).toContain('avatar--initials')
    expect(html).toContain('OB')
  })
})

describe('episodeSummary — az oylu bölüm uç değer olamaz', () => {
  it('birkaç oylu 9.9 bölüm "en iyi" seçilmez', async () => {
    const { episodeSummary } = await import('./EpisodeHeatmap.jsx')
    const s = episodeSummary([
      {
        season: 1,
        episodes: [
          { episode: 1, rating: 7.1, votes: 400 },
          { episode: 2, rating: 9.9, votes: 3 },
          { episode: 3, rating: 7.8, votes: 380 },
          { episode: 4, rating: 6.2, votes: 350 },
        ],
      },
    ])
    expect(s.best).toMatchObject({ episode: 3, rating: 7.8 })
    expect(s.worst).toMatchObject({ episode: 4 })
  })
})
