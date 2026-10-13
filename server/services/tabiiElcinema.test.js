import { describe, it, expect } from 'vitest'
import { slugify, parseSitemapDetails, parseTabiiCountries, matchTabii } from './tabiiCatalog.js'
import {
  parseChannelList,
  parseChannelPage,
  parseWorkPage,
  matchWork,
  dayToIso,
  workNames,
  channelCountry,
} from './elcinemaGuide.js'

describe('tabii', () => {
  it('slug ve site haritası', () => {
    expect(slugify('Kudüs Fatihi: Selahaddin Eyyubi')).toBe('kudus-fatihi-selahaddin-eyyubi')
    expect(slugify('Teşkilat')).toBe('teskilat')
    const d = parseSitemapDetails(
      '<loc>https://www.tabii.com/tr/detail/6750/teskilat</loc><loc>https://www.tabii.com/tr/detail/6750/teskilat</loc><loc>https://www.tabii.com/tr/person/1/x</loc>'
    )
    expect(d).toEqual([{ id: 6750, slug: 'teskilat' }])
  })

  it('SSS ülke listesi ISO koduna çevrilir; KKTC atlanır', () => {
    const data = {
      props: {
        pageProps: {
          data: {
            faq: [
              {
                items: [
                  {
                    title: '<p>In which countries can I watch tabii?</p>',
                    description:
                      '<p>tabii is available in following countries: Algeria, Czech Republic, Germany, Turkish Republic of Northern Cyprus, Türkiye, United States.</p>',
                  },
                ],
              },
            ],
          },
        },
      },
    }
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`
    expect(parseTabiiCountries(html)).toEqual(['CZ', 'DE', 'DZ', 'TR', 'US'])
  })

  it('eşleme slug birebir, yalnızca TRT 1/tabii yapımları; aynı slug’a düşen iki dizi eşlenmez', () => {
    const m = matchTabii(
      [
        { id: 1, name: 'Teşkilat', broadcaster: 'TRT 1' },
        { id: 2, name: 'Aile', broadcaster: 'TRT 1' },
        { id: 3, name: 'Aile', broadcaster: 'tabii' },
        { id: 4, name: 'Emanet', broadcaster: null },
      ],
      [
        { id: 6750, slug: 'teskilat' },
        { id: 9, slug: 'aile' },
        { id: 10, slug: 'emanet' },
      ]
    )
    expect(Object.keys(m)).toEqual(['1'])
    expect(m[1].url).toBe('https://www.tabii.com/tr/detail/6750/teskilat')
  })
})

describe('elcinema', () => {
  it('kanal listesi: kısaltılmış ad yerine tam ad', () => {
    const html =
      '<a href="/en/tvguide/1129/">MBC 4 Channel</a><a href="/en/tvguide/1129/">MBC 4</a><a href="/en/tvguide/1391/">OSN TV Movies H...</a>'
    expect(parseChannelList(html)).toEqual([
      { id: '1129', name: 'MBC 4' },
      { id: '1391', name: 'OSN TV Movies H' },
    ])
  })

  it('gün başlığı → tarih (yıl dönümü dahil)', () => {
    expect(dayToIso('Friday  9 October', '2026-10-09')).toBe('2026-10-09')
    expect(dayToIso('Friday 1 January', '2026-12-31')).toBe('2027-01-01')
  })

  it('kanal sayfası: ülke, gün ve kayıtlar', () => {
    const entry = (t, min, id, title, kind) =>
      `<ul class="unstyled text-center"><li>${t}</li><li><span class="subheader">[${min} minutes]</span></li></ul></div><div><a href="/en/work/${id}/"><img /></a></div><div><ul class="unstyled no-margin"><li><a href="/en/work/${id}/">${title}</a></li><li>\n ${kind}\n (2025)</li>`
    const html = `<li>country: Saudi Arabia</li><li>Category: Series</li><div class=" dates">\n Friday  9 October\n</div>${entry('09:00  PM', 150, 2096895, 'Sins and Roses', 'Series - Normal')}${entry('11:30  PM', 60, 2096895, 'Sins and Roses', 'Series - Normal')}<div class=" dates">Saturday 10 October</div>${entry('02:00  PM', 120, 1, 'A Film', 'Movie')}`
    const p = parseChannelPage(html, '2026-10-09')
    expect(p.country).toBe('Saudi Arabia')
    expect(p.entries.map((e) => [e.date, e.workId, e.kind])).toEqual([
      ['2026-10-09', '2096895', 'Series - Normal'],
      ['2026-10-09', '2096895', 'Series - Normal'],
      ['2026-10-10', '1', 'Movie'],
    ])
  })

  it('eser sayfası ve eşleme: IMDb kimliği önce, sonra özgün ad; Türk yapımı değilse eşlenmez', () => {
    const html =
      '<span class="left" dir="ltr">\n Sins and Roses\n</span><span class="right" dir="rtl">Güller ve Günahlar</span><a href="/en/index/work/category/3">Series</a><a href="/en/index/work/country/tr">Turkey</a><a href="https://www.imdb.com/title/tt38074086">IMDb</a>'
    const w = parseWorkPage(html)
    expect(w).toMatchObject({
      title: 'Sins and Roses',
      originalTitle: 'Güller ve Günahlar',
      country: 'TR',
      imdbId: 'tt38074086',
      kind: 'Series',
    })
    const idx = { tmdbByTconst: new Map([['tt38074086', 99]]), seriesByName: new Map([['guller ve gunahlar', [7]]]) }
    expect(matchWork(w, idx)).toBe(99)
    expect(matchWork({ ...w, imdbId: null }, idx)).toBe(7)
    expect(matchWork({ ...w, country: 'EG' }, idx)).toBeNull()
  })
})

describe('elcinema — ad biçimleri', () => {
  it('sezon eki ve eğik çizgiyle ayrılmış adlar', () => {
    expect(workNames({ originalTitle: 'Kurulus: Osman S2', title: 'Establishment: Osman S2' })).toEqual([
      'Kurulus: Osman',
      'Establishment: Osman',
    ])
    expect(workNames({ originalTitle: 'Yargi/ The Judgment/ Rekabet', title: 'Family Secrets' })).toEqual([
      'Yargi',
      'The Judgment',
      'Rekabet',
      'Family Secrets',
    ])
  })

  it('Türkçe karakter katlanmış birebir eşleşme; iki diziye giden ad eşlenmez', () => {
    const idx = {
      tmdbByTconst: new Map(),
      seriesByName: new Map([
        ['kurulus osman', [95603]],
        ['yargi', [131426]],
        ['aile', [1, 2]],
      ]),
    }
    expect(matchWork({ country: 'TR', originalTitle: 'Kurulus: Osman S2' }, idx)).toBe(95603)
    expect(matchWork({ country: 'TR', originalTitle: 'Yargi/ The Judgment' }, idx)).toBe(131426)
    expect(matchWork({ country: 'TR', originalTitle: 'Aile' }, idx)).toBeNull()
  })

  it('kanal ülkesi: adında ülke geçen kanal o ülkeye, bölge geneli kanal elcinema ülkesinde', () => {
    expect(channelCountry('MBC Iraq', 'SA')).toBe('IQ')
    expect(channelCountry('MBC Egypt', 'SA')).toBe('EG')
    expect(channelCountry('Rotana Cinema Masr', 'SA')).toBe('EG')
    expect(channelCountry('MBC 4', 'SA')).toBe('SA')
    expect(channelCountry('Al Aoula Morocco', 'MA')).toBe('MA')
    expect(channelCountry('Oman', 'OM')).toBe('OM')
    expect(channelCountry('Romance TV', 'AE')).toBe('AE')
  })
})
