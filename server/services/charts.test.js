import { describe, it, expect } from 'vitest'
import {
  chartForPeriod,
  topInWindow,
  yearAgo,
  timeline,
  globalTopForWeek,
  addDays,
  isRecap,
  buildCountryLists,
  buildOwnRanking,
  mergeAcrossPlatforms,
  weekEndOf,
  collapseSeasons,
  seriesListings,
} from './charts.js'

const row = (period_date, rank, series_id, title_raw, extra = {}) => ({
  provider: 'netflix_tudum',
  country_iso2: 'BR',
  period_type: 'week',
  period_date,
  segment: 'TV',
  rank,
  series_id,
  title_raw,
  program_kind: series_id != null ? 'series' : 'unknown',
  fetched_at: '2026-09-30',
  ...extra,
})
const names = new Map([
  [1, 'Adım Farah'],
  [2, 'Enfes Bir Akşam'],
  [3, 'Seni Tanıyorum'],
])
const nameOf = (id, raw) => names.get(id) ?? raw

const rows = [
  row('2026-09-13', 4, 1, 'My Name Is Farah'),
  row('2026-09-20', 6, 1, 'My Name Is Farah'),
  row('2026-09-20', 4, 3, 'Not a Stranger'),
  row('2026-09-27', 5, 1, 'My Name Is Farah'),
  row('2026-09-27', 1, 3, 'Not a Stranger'),
  row('2026-09-27', 9, null, 'Bir Küçük Gün Işığı'),
  row('2025-11-02', 1, 2, 'Old Money'),
  row('2025-10-05', 3, 2, 'Old Money'),
]

describe('chartForPeriod — sıra, kaç haftadır listede, ↑↓/yeni', () => {
  it('önceki haftaya göre yön ve kümülatif hafta sayısı', () => {
    const list = chartForPeriod(rows, '2026-09-27', { prevPeriodDate: '2026-09-20', nameOf })
    expect(list.map((x) => [x.rank, x.name, x.weeksInList, x.trend])).toEqual([
      [1, 'Seni Tanıyorum', 2, '↑3'],
      [5, 'Adım Farah', 3, '↑1'],
      [9, 'Bir Küçük Gün Işığı', 1, 'yeni'],
    ])
    expect(list[2].seriesId).toBeNull()
    expect(list[2].kind).toBe('unknown')
  })
  it('önceki dönem verilmezse yön yok değil "yeni" olur; boş dönem boş liste', () => {
    expect(chartForPeriod(rows, '2026-09-13', { nameOf })[0].trend).toBe('yeni')
    expect(chartForPeriod(rows, '2020-01-05', { nameOf })).toEqual([])
  })
})

describe('topInWindow — pencere içinde en çok hafta, sonra en iyi sıra', () => {
  it('sıralama ve alanlar', () => {
    const top = topInWindow(rows, '2025-10-01', '2026-09-27', { nameOf })
    expect(top.map((t) => [t.name, t.periods, t.bestRank])).toEqual([
      ['Adım Farah', 3, 4],
      ['Enfes Bir Akşam', 2, 1],
      ['Seni Tanıyorum', 2, 1],
      ['Bir Küçük Gün Işığı', 1, 9],
    ])
    expect(top[1].lastDate).toBe('2025-11-02')
  })
  it('pencere dışı satırlar sayılmaz', () => {
    expect(topInWindow(rows, '2026-09-27', '2026-09-27', { nameOf })).toHaveLength(3)
  })
})

describe('yearAgo — tam hafta → ±4 hafta penceresi → en son giriş', () => {
  it('tam aynı hafta doluysa exact', () => {
    const r = [...rows, row('2025-09-28', 7, 2, 'Old Money')]
    expect(yearAgo(r, '2026-09-27', { nameOf })).toMatchObject({ mode: 'exact', periodDate: '2025-09-28' })
  })
  it('boşsa ±28 gün içinde en yakın dolu hafta ve pencere belirtilir', () => {
    const r = yearAgo(rows, '2026-09-27', { nameOf })
    expect(r.mode).toBe('window')
    expect(r.periodDate).toBe('2025-10-05')
    expect(r.window).toEqual({ from: addDays('2025-09-28', -28), to: addDays('2025-09-28', 28) })
    expect(r.entries[0].name).toBe('Enfes Bir Akşam')
  })
  it('o da boşsa hedef tarihe en yakın kayıt (cari dönem hariç)', () => {
    const r = yearAgo(
      rows.filter((x) => x.period_date !== '2025-10-05'),
      '2026-09-27',
      { nameOf }
    )
    expect(r.mode).toBe('last')
    expect(r.periodDate).toBe('2025-11-02')
  })
  it('hiç kayıt yoksa null', () => {
    expect(yearAgo([], '2026-09-27', { nameOf })).toBeNull()
  })
})

describe('timeline / globalTopForWeek', () => {
  it('aylık ve yıllık dizi sayısı, giriş sayısı, en iyi sıra', () => {
    const m = timeline(rows, 'monthly')
    expect(m.find((t) => t.period === '2026-09')).toEqual({
      period: '2026-09',
      seriesCount: 3,
      entries: 6,
      bestRank: 1,
    })
    expect(timeline(rows, 'yearly').map((t) => t.period)).toEqual(['2025', '2026'])
  })
  it('küresel zirve: en çok ülkede listede, ilk 3 sayısı', () => {
    const multi = [
      ...rows,
      row('2026-09-27', 2, 3, 'Not a Stranger', { country_iso2: 'DE' }),
      row('2026-09-27', 3, 3, 'Not a Stranger', { country_iso2: 'ES' }),
      row('2026-09-27', 8, 1, 'My Name Is Farah', { country_iso2: 'PT' }),
    ]
    const g = globalTopForWeek(multi, '2026-09-27', { nameOf })
    expect(g[0]).toMatchObject({ name: 'Seni Tanıyorum', countries: 3, top3: 3, bestRank: 1 })
    expect(g[1]).toMatchObject({ name: 'Adım Farah', countries: 2, top3: 0 })
  })
})

describe('özet yayını', () => {
  const row = (rank, title_raw, series_id = 317883) => ({
    provider: 'reytingtv',
    country_iso2: 'TR',
    period_date: '2026-08-23',
    segment: 'Total',
    rank,
    title_raw,
    series_id,
    program_kind: 'series',
  })

  it('isRecap: Türkçe harf sınırı ve ASCII yazım; eşleşmeyen satır özet sayılmaz', () => {
    expect(isRecap(row(2, 'DAHA 17 (ÖZET)'))).toBe(true)
    expect(isRecap(row(2, 'MASTERCHEF TURKIYE OZET TV8'))).toBe(true)
    expect(isRecap(row(1, 'DAHA 17'))).toBe(false)
    expect(isRecap(row(1, 'ÖZETİN PEŞİNDE'))).toBe(false)
    expect(isRecap(row(1, 'X (ÖZET)', null))).toBe(false)
  })

  it('aynı gün dizi ve özeti ayrı satır kalır; özetin adı "(özet)" eki alır, listede-gün sayısı karışmaz', () => {
    const rows = [row(1, 'DAHA 17'), row(2, 'DAHA 17 (ÖZET)'), { ...row(3, 'DAHA 17'), period_date: '2026-08-16' }]
    const list = chartForPeriod(rows, '2026-08-23', { nameOf: () => 'Daha 17' })
    expect(list.map((e) => e.name)).toEqual(['Daha 17', 'Daha 17 (özet)'])
    expect(list.map((e) => e.weeksInList)).toEqual([2, 1])
  })
})

describe('mergeAcrossPlatforms — aynı dizi birden çok platformda', () => {
  it('tek satır, en iyi sıra; platformlar en iyi sıradan başlayarak; en uzun hafta sayısı', () => {
    const it = (rank, platform, weeksInList, extra = {}) => ({
      rank,
      seriesId: 9,
      name: 'Eşref Rüya',
      titleRaw: 'Esref Ruya',
      weeksInList,
      trend: 'yeni',
      platform,
      ...extra,
    })
    const merged = mergeAcrossPlatforms([
      it(10, 'Shahid', 1),
      it(7, 'Prime Video', 2),
      it(3, 'Netflix', 1, { seriesId: 5, name: 'Başka' }),
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ name: 'Başka', platform: 'Netflix' })
    expect(merged[1]).toMatchObject({
      rank: 7,
      platforms: ['Prime Video', 'Shahid'],
      platform: 'Prime Video · Shahid',
      weeksInList: 2,
    })
  })
})

describe('buildCountryLists — tüm platformlar birlikte', () => {
  const flix = (period_date, segment, rank, series_id, title_raw) =>
    row(period_date, rank, series_id, title_raw, { provider: 'flixpatrol', period_type: 'day', segment })
  const netflixRows = [row('2026-09-20', 6, 1, 'My Name Is Farah'), row('2026-09-27', 5, 1, 'My Name Is Farah')]
  const flixRows = [
    flix('2026-09-23', 'disney', 7, 3, 'Seni Tanıyorum'),
    flix('2026-09-30', 'disney', 2, 3, 'Seni Tanıyorum'),
    flix('2026-09-30', 'disney', 1, null, 'Loki'), // katalog dışı: listeye girmez
    flix('2026-09-30', 'shahid', 4, 1, 'Adım Farah'),
    flix('2026-08-01', 'hbo-max', 3, 2, 'Enfes Bir Akşam'), // bayat: "şu an"a girmez, 52 haftaya girer
  ]
  const sonuc = buildCountryLists({
    netflixRows,
    flixRows,
    latestWeek: '2026-09-27',
    prevWeek: '2026-09-20',
    today: '2026-09-30',
    nameOf,
  })

  it('şu an: her platformun güncel listesi, gerçek sıra ve platform adıyla; yabancı ve bayat satır yok', () => {
    // Adım Farah hem Shahid (4.) hem Netflix (5.) listesinde: tek satır, en iyi sıra, iki platform birlikte
    expect(sonuc.now.map((i) => [i.rank, i.name, i.platform, i.trend])).toEqual([
      [2, 'Seni Tanıyorum', 'Disney+', '↑5'],
      [4, 'Adım Farah', 'Shahid · Netflix', 'yeni'],
    ])
  })

  it('en çok izlenenler: farklı hafta sayısı (aynı hafta iki platform tek sayılır) ve platform listesi', () => {
    expect(sonuc.top.map((t) => [t.name, t.periods, t.bestRank, t.platforms])).toEqual([
      ['Adım Farah', 3, 4, ['Netflix', 'Shahid']],
      ['Seni Tanıyorum', 2, 2, ['Disney+']],
      ['Enfes Bir Akşam', 1, 3, ['HBO Max']],
    ])
    expect(sonuc.window.to).toBe('2026-09-30')
  })

  it('veri yoksa boş listeler ve pencere yok', () => {
    expect(buildCountryLists({})).toEqual({ now: [], top: [], window: null })
  })

  it('weekEndOf haftanın Pazar gününü verir', () => {
    expect(weekEndOf('2026-09-30')).toBe('2026-10-04') // Çarşamba
    expect(weekEndOf('2026-09-27')).toBe('2026-09-27') // Pazar
  })
})

describe('collapseSeasons — aynı dönemde aynı dizinin sezonları tek satır', () => {
  const sezonlar = [
    row('2026-09-27', 3, 3, 'Graveyard'),
    row('2026-09-27', 10, 3, 'Graveyard'),
    row('2026-09-20', 5, 3, 'Graveyard'),
    row('2026-09-20', 8, 3, 'Graveyard'),
    row('2026-09-27', 6, 1, 'My Name Is Farah'),
  ]

  it('en iyi sıra kalır; farklı dönemler ve farklı diziler korunur', () => {
    const tek = collapseSeasons(sezonlar)
    expect(tek.map((r) => [r.period_date, r.series_id, r.rank])).toEqual([
      ['2026-09-27', 3, 3],
      ['2026-09-20', 3, 5],
      ['2026-09-27', 1, 6],
    ])
  })

  it('şu an listesi diziyi bir kez gösterir ve hafta sayısı sezonlarla şişmez', () => {
    const liste = chartForPeriod(collapseSeasons(sezonlar), '2026-09-27', { prevPeriodDate: '2026-09-20', nameOf })
    expect(liste.map((i) => [i.rank, i.name, i.weeksInList, i.trend])).toEqual([
      [3, 'Seni Tanıyorum', 2, '↑2'],
      [6, 'Adım Farah', 1, 'yeni'],
    ])
  })

  it('özet yayını ve farklı platform ayrı kalır; tekrar yoksa aynı dizi döner', () => {
    const ozet = [
      row('2026-08-23', 1, 5, 'DAHA 17', { provider: 'reytingtv', segment: 'Total' }),
      row('2026-08-23', 2, 5, 'DAHA 17 (ÖZET)', { provider: 'reytingtv', segment: 'Total' }),
      row('2026-09-30', 4, 5, 'Torn Apart', { provider: 'flixpatrol', segment: 'shahid' }),
      row('2026-09-30', 9, 5, 'Torn Apart', { provider: 'flixpatrol', segment: 'disney' }),
    ]
    expect(collapseSeasons(ozet)).toBe(ozet)
  })
})

describe('trend — tekrar giriş', () => {
  it('daha önce listede olup önceki dönemde olmayan dizi "tekrar", hiç olmayan "yeni"', () => {
    const satirlar = [
      row('2026-09-06', 4, 1, 'My Name Is Farah'),
      row('2026-09-13', 2, 3, 'Not a Stranger'),
      row('2026-09-20', 7, 1, 'My Name Is Farah'),
      row('2026-09-20', 5, 2, 'Another Night'),
    ]
    const liste = chartForPeriod(satirlar, '2026-09-20', { prevPeriodDate: '2026-09-13', nameOf })
    expect(liste.map((i) => [i.name, i.trend])).toEqual([
      ['Enfes Bir Akşam', 'yeni'],
      ['Adım Farah', 'tekrar'],
    ])
  })
})

describe('seriesListings — dizinin tüm listeleri, ülke × platform', () => {
  it('Netflix, FlixPatrol platformları ve Türkiye TV; hafta tekil, en son girilen önce', () => {
    const flix = (d, iso2, segment, rank) =>
      row(d, rank, 3, 'Far Away', { provider: 'flixpatrol', country_iso2: iso2, segment })
    const sonuc = seriesListings({
      netflixRows: [
        row('2026-09-20', 6, 3, 'Far Away', { country_iso2: 'SA' }),
        row('2026-09-27', 2, 3, 'Far Away', { country_iso2: 'SA' }),
      ],
      flixRows: [
        flix('2026-09-30', 'SA', 'shahid', 4),
        flix('2026-10-01', 'SA', 'shahid', 3),
        flix('2026-09-30', 'IQ', 'shahid', 5),
      ],
      tvRows: [row('2026-08-23', 1, 3, 'UZAK ŞEHİR', { provider: 'reytingtv', country_iso2: 'TR', segment: 'Total' })],
    })
    expect(sonuc.map((l) => [l.iso2, l.platform, l.weeks, l.bestRank, l.lastDate])).toEqual([
      ['SA', 'Shahid', 1, 3, '2026-10-01'],
      ['IQ', 'Shahid', 1, 5, '2026-09-30'],
      ['SA', 'Netflix', 2, 2, '2026-09-27'],
      ['TR', 'TV', 1, 1, '2026-08-23'],
    ])
  })
})

describe('buildOwnRanking — platformun kendi haftalık sıralaması', () => {
  const nf = (date, rank, id, name) => ({
    provider: 'netflix_tudum',
    segment: 'TV',
    period_date: date,
    rank,
    series_id: id,
    title_raw: name,
    program_kind: 'series',
  })
  const fx = (date, seg, rank, id, name) => ({
    provider: 'flixpatrol',
    segment: seg,
    period_date: date,
    rank,
    series_id: id,
    title_raw: name,
    program_kind: 'series',
  })
  const to = '2026-10-05'
  const sonuc = buildOwnRanking({
    netflixRows: [nf('2026-09-27', 1, 1, 'Seni Tanıyorum'), nf('2026-09-20', 3, 1, 'Seni Tanıyorum')],
    flixRows: [
      fx('2026-10-04', 'shahid', 3, 2, 'Uzak Şehir'),
      fx('2026-10-03', 'amazon-prime', 3, 3, 'Eşref Rüya'),
      fx('2026-10-04', 'shahid', 7, 3, 'Eşref Rüya'), // iki listede → eşit sırada önce
      fx('2026-09-27', 'shahid', 1, 2, 'Uzak Şehir'), // önceki hafta 1.
      { ...fx('2026-10-04', 'shahid', 2, 9, 'Haber'), program_kind: 'other' }, // dizi değil
    ],
    to,
  })

  it("Netflix'in yayımlanan listesi bu haftaya sayılır; en iyi sıra, eşitlikte çok listede olan önce", () => {
    expect(sonuc.current.map((x) => [x.position, x.name])).toEqual([
      [1, 'Seni Tanıyorum'],
      [2, 'Eşref Rüya'],
      [3, 'Uzak Şehir'],
    ])
  })

  it('değişim önceki haftaya göre; önceki hafta yoksa etiket yok; hafta sayısı ve en iyi sıra', () => {
    const byName = Object.fromEntries(sonuc.current.map((x) => [x.name, x]))
    expect(byName['Uzak Şehir'].trend).toBe('↓2') // geçen hafta 1., bu hafta 3.
    expect(byName['Seni Tanıyorum'].trend).toBe('↑1') // geçen hafta 2. (Uzak Şehir'in ardından), bu hafta 1.
    expect(byName['Eşref Rüya'].trend).toBeNull()
    expect(byName['Seni Tanıyorum'].weeks).toBe(2)
    expect(sonuc.top[0]).toMatchObject({ name: 'Seni Tanıyorum', weeks: 2, bestPosition: 1 })
    expect(sonuc.seriesCount).toBe(3)
    expect(JSON.stringify(sonuc)).not.toMatch(/shahid|amazon|netflix|Haber/i)
  })

  it('geçen hafta iki kaynağı da kapsıyorsa karşılaştırma haftalık', () => {
    expect(sonuc).toMatchObject({ trendBasis: 'week', trendSince: null, previousCount: 2 })
  })

  it('geçen hafta günlük listeleri kapsamıyorsa değişim hafta içi: ilk günün sırasından son güne', () => {
    const r = buildOwnRanking({
      netflixRows: [nf('2026-09-27', 1, 1, 'Seni Tanıyorum'), nf('2026-09-20', 1, 1, 'Seni Tanıyorum')],
      flixRows: [
        fx('2026-09-30', 'shahid', 2, 2, 'Uzak Şehir'),
        fx('2026-09-30', 'shahid', 3, 3, 'Eşref Rüya'),
        fx('2026-10-05', 'shahid', 4, 2, 'Uzak Şehir'),
        fx('2026-10-05', 'shahid', 1, 3, 'Eşref Rüya'),
      ],
      to,
    })
    expect(r).toMatchObject({ trendBasis: 'days', trendSince: '2026-09-30', previousCount: null })
    const byName = Object.fromEntries(r.current.map((x) => [x.name, x.trend]))
    expect(byName['Eşref Rüya']).toBe('↑1') // 30 Eylül'de 2., 5 Ekim'de 1.
    expect(byName['Uzak Şehir']).toBe('↓1')
    expect(byName['Seni Tanıyorum']).toBeNull() // günlük listede yok
  })

  it('kayıt yoksa null', () => {
    expect(buildOwnRanking({ netflixRows: [], flixRows: [], to })).toBeNull()
    expect(buildOwnRanking({ netflixRows: [nf('2026-09-27', 1, 1, 'X')], flixRows: [], to: null })).toBeNull()
  })
})
