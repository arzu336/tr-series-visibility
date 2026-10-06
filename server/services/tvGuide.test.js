import { describe, it, expect, beforeEach } from 'vitest'
import db from '../db.js'
import {
  cleanProgramTitle,
  buildTvMatcher,
  extractAirings,
  runTvGuideIfNeeded,
  getCountryTv,
  getSeriesTv,
  tvGuideStatus,
  setTitleMapping,
  trustedChannelsOf,
} from './tvGuide.js'
import { parseCsv, importDistributionCsv, getCountrySales } from './distributionSales.js'

const series = [
  { id: 17635, name: 'Aşk-ı Memnu' },
  { id: 2, name: 'Güller ve Günahlar' },
  { id: 3, name: 'Elif' },
]
const localized = [
  { seriesId: 17635, title: 'Amor Proibido' },
  { seriesId: 2, title: 'Sins and Roses' },
  { seriesId: 3, title: 'Amour interdit' }, // iki diziye giden ortak çeviri → belirsiz, atılır
  { seriesId: 17635, title: 'Amour interdit' },
]

beforeEach(() => {
  for (const t of ['tv_airings', 'tv_titles', 'distribution_sales']) db.prepare(`DELETE FROM ${t}`).run()
  db.prepare("DELETE FROM meta WHERE key = 'tvGuideLastDate'").run()
})

describe('rehber başlığı → dizi', () => {
  const match = buildTvMatcher(series, localized)

  it('yerel ad, Türkçe ad ve Türkçe harfsiz yazım tam eşitlikle; sezon eki atılır', () => {
    expect(cleanProgramTitle('Amor Proibido S2 E14')).toBe('Amor Proibido')
    expect(cleanProgramTitle('Le Clan - Saison 3')).toBe('Le Clan')
    expect(match('Amor Proibido')).toBe(17635)
    expect(match('Amor Proibido S2')).toBe(17635)
    expect(match('Sins And Roses')).toBe(2)
    expect(match('Guller ve Gunahlar')).toBe(2)
  })

  it('IMDb’de başka yapımla paylaşılan yabancı ad yalnızca güvenilir kanalda; Türkçe ad her zaman', () => {
    const m = buildTvMatcher(series, localized, new Map(), new Set(['amorproibido', 'askimemnu']))
    expect(m('Amor Proibido')).toBeNull()
    expect(m('Amor Proibido', { allowAmbiguous: true })).toBe(17635)
    expect(m('Aşk-ı Memnu')).toBe(17635) // Türkçe ad belirsizlik kuralına girmez
    const yanit = {
      Channels: [
        { Name: 'Novelas+', Programmes: [{ Title: 'Sins And Roses' }] },
        { Name: 'Canal+', Programmes: [{ Title: 'Amor Proibido' }] },
      ],
    }
    const guvenilir = trustedChannelsOf([yanit], m)
    expect([...guvenilir]).toEqual(['Novelas+'])
    const kenya = { Channels: [{ Name: 'Novelas+', Programmes: [{ Title: 'Amor Proibido' }] }, yanit.Channels[1]] }
    expect(extractAirings(kenya, m, guvenilir).airings.map((a) => a.channel)).toEqual(['Novelas+'])
  })

  it('belirsiz çeviri ve kısmi benzerlik eşleşmez; elle eşleme önce gelir', () => {
    expect(match('Amour interdit')).toBeNull()
    expect(match('Amor Proibido: Bastidores')).toBeNull()
    expect(match('Elif')).toBe(3)
    const manuel = buildTvMatcher(series, localized, new Map([['Pecados E Rosas', 2]]))
    expect(manuel('Pecados E Rosas')).toBe(2)
  })
})

const yanit = {
  Channels: [
    {
      Name: 'Novelas+',
      Programmes: [
        { Title: 'Amor Proibido' },
        { Title: 'Amor Proibido' },
        { Title: 'Pecados E Rosas' },
        { Title: 'A Fazenda' },
      ],
    },
    { Name: 'SuperSport', Programmes: [{ Title: 'Premier League' }] },
  ],
}

describe('toplama', () => {
  it('kanal başına yayın sayısı; yalnızca Türk dizisi yayınlayan kanalın başlıkları saklanır', () => {
    const { airings, titlesByChannel } = extractAirings(yanit, buildTvMatcher(series, localized))
    expect(airings).toEqual([{ channel: 'Novelas+', seriesId: 17635, slots: 2, title: 'Amor Proibido' }])
    expect([...titlesByChannel.keys()]).toEqual(['Novelas+'])
    expect(titlesByChannel.get('Novelas+').find((t) => t.title === 'Pecados E Rosas').seriesId).toBeNull()
  })

  it('günde bir kez; ülke ve dizi okumaları; eşleşmeyen başlık elle bağlanınca sonraki toplamada yazılır', async () => {
    const now = new Date('2026-10-06T08:00:00Z')
    const calls = []
    const fetchFn = async (url) => {
      calls.push(url)
      return { ok: true, json: async () => yanit }
    }
    const opts = { fetchFn, now, series, localized, gapMs: 0, countries: ['ken', 'nga'] }
    const r = await runTvGuideIfNeeded(opts)
    expect(r).toMatchObject({ countries: 2, airings: 2, series: 1, errors: [] })
    expect(calls[0]).toMatch(/GetProgrammes\?d=2026-10-06&country=ken/)
    expect(await runTvGuideIfNeeded(opts)).toBeNull()

    expect(getCountryTv('KE', { now })).toEqual([
      { seriesId: 17635, localTitle: 'Amor Proibido', slots: 2, last: '2026-10-06', channels: ['Novelas+'] },
    ])
    expect(
      getSeriesTv(17635, { now })
        .map((x) => x.iso2)
        .sort()
    ).toEqual(['KE', 'NG'])
    const st = tvGuideStatus()
    expect(st).toMatchObject({ lastDate: '2026-10-06', countries: 2, series: 1 })
    expect(st.unmatched.find((u) => u.title === 'Pecados E Rosas')).toMatchObject({ channel: 'Novelas+', countries: 2 })

    expect(setTitleMapping('dstv', 'Novelas+', 'Pecados E Rosas', 2)).toBe(true)
    await runTvGuideIfNeeded({ ...opts, force: true })
    expect(getSeriesTv(2, { now })).toHaveLength(2)
    expect(tvGuideStatus().unmatched.some((u) => u.title === 'Pecados E Rosas')).toBe(false)
  })

  it('bir ülkenin hatası diğerlerini durdurmaz', async () => {
    const fetchFn = async (url) =>
      url.includes('ken') ? { ok: false, status: 503 } : { ok: true, json: async () => yanit }
    const r = await runTvGuideIfNeeded({
      fetchFn,
      now: new Date('2026-10-07T08:00:00Z'),
      series,
      localized,
      gapMs: 0,
      countries: ['ken', 'nga'],
    })
    expect(r).toMatchObject({ countries: 1, errors: ['KE: HTTP 503'] })
  })
})

describe('dağıtımcı satış tablosu', () => {
  it('noktalı virgül ve tırnaklı alanlar', () => {
    expect(parseCsv('dizi;ulke\n"Aşk-ı Memnu; özel";KE')).toEqual([
      ['dizi', 'ulke'],
      ['Aşk-ı Memnu; özel', 'KE'],
    ])
  })

  it('dizi adla ya da kimlikle, ülke adla ya da kodla; hatalı satırlar nedeniyle atlanır; yeni dosya eskisinin yerini alır', () => {
    const csv = [
      'dizi,ulke,alici,baslangic,bitis',
      'Aşk-ı Memnu,Kenya,Citizen TV,2024-01-01,2024-12-31',
      '2,NG,StarTimes Novela,2025-03,',
      'Bilinmeyen Dizi,KE,X,,',
      'Elif,Atlantis,Y,,',
      'Elif,GH,,,',
      'Elif,GH,TV3,01.02.2024,',
    ].join('\n')
    const r = importDistributionCsv(csv, 'Ornek Dagitim', { series, englishTitlesOf: () => [] })
    expect(r.imported).toBe(2)
    expect(r.skipped.map((s) => s.line)).toEqual([4, 5, 6, 7])
    expect(getCountrySales('KE')).toEqual([
      { seriesId: 17635, buyer: 'Citizen TV', distributor: 'Ornek Dagitim', start: '2024-01-01', end: '2024-12-31' },
    ])
    importDistributionCsv('dizi,ulke,alici\nElif,KE,KTN', 'Ornek Dagitim', { series, englishTitlesOf: () => [] })
    expect(getCountrySales('KE').map((s) => s.buyer)).toEqual(['KTN'])
    expect(() => importDistributionCsv('dizi,ulke\nElif,KE', 'X', { series })).toThrow(/Eksik sütun: alici/)
  })
})
