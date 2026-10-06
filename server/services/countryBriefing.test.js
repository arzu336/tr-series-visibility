import { describe, it, expect } from 'vitest'
import { buildBriefing, buildSummary, BRIEFING_CHAPTERS, BRIEFING_SECTION_TITLES } from './countryBriefing.js'

const ok = (data, extra = {}) => ({ status: 'hesaplandi', data, ...extra })
const yok = (reason) => ({ status: 'hesaplanamaz', reason })

const SECTIONS = {
  scores: ok({
    level: 'yüksek',
    access: { seriesCount: 40, platformCount: 5 },
    warnings: [{ code: 'linear-tv', text: "Netflix Top 10'da zayıf" }],
  }),
  ranking: ok({ rank: 7, of: 110, level: 'yüksek' }),
  trend: ok({ shortTerm: { direction: 'düşüyor', changePct: -8, windowDays: 7 }, monthly: [] }),
  platformLists: ok({
    now: [
      { name: 'Uzak Şehir', position: 1, weeks: 3, trend: '↑1' },
      { name: 'Eşref Rüya', position: 2, weeks: 1, trend: null },
    ],
    top: [],
    seriesCount: 4,
    previousCount: 3,
    window: { from: '2025-10-06', to: '2026-10-04', weeks: 52 },
  }),
  topSeries: ok({ entries: [] }, { caveat: 'arama payı faktörü önbellekte olmadığı için dışlandı (SerpApi)' }),
  wikiInterest: ok({
    languages: [],
    primary: { lang: 'bg', languageName: 'Bulgarca', last: 1200, prev: 1000, changePct: 20, topName: 'Uzak Şehir' },
  }),
  searchTrend: yok('Google Trends zaman serisi sorgulanmamış'),
  pressTone: yok('GDELT taraması yok'),
  availability: ok({ series: [] }),
  themes: ok({ items: [{ theme: 'aşk', sharePct: 30 }] }),
  gapAnalysis: yok('Dünya Bankası verisi yok'),
  tourismSignal: yok('YİGM Sınır İstatistikleri Bülteni ayrı vermiyor'),
  netflixHistory: ok({ rows: [] }),
}
const REPORT = { iso2: 'BG', generatedAt: '2026-10-05T10:00:00Z', isTracked: true, sections: SECTIONS }

describe('buildSummary — özet kartı', () => {
  it('dört ana sayı ve yönleri; cümleler izleyici sinyalleriyle başlar; televizyon uyarısı kaynak adsız', () => {
    const s = buildSummary(SECTIONS)
    expect(s.kpis).toEqual([
      { key: 'level', label: 'İzlenme düzeyi', value: 'yüksek', detail: '7. / 110 ülke', trend: null },
      { key: 'ranked', label: 'Bu hafta sıralamada', value: '2 dizi', detail: 'geçen hafta 3', trend: 'down' },
      { key: 'available', label: 'Yayında', value: '40 dizi', detail: '5 platformda', trend: 'down' },
      {
        key: 'reading',
        label: 'Okunma ilgisi (aylık)',
        value: '1.200',
        detail: 'Bulgarca · geçen aya göre %20 artış',
        trend: 'up',
      },
    ])
    expect(s.sentences.map((x) => x.basis)).toEqual(['ranking', 'lists', 'wiki', 'themes'])
    expect(s.caveat).toMatch(/yerel adla dağıtılmış/)
    expect(s.caveat).not.toMatch(/Netflix/)
  })
})

describe('buildBriefing — başlıklar ve ek', () => {
  const b = buildBriefing(REPORT)

  it('beş başlık sabit sırada; boş başlık atlanır; Netflix geçmişi brifinge girmez', () => {
    expect(BRIEFING_CHAPTERS.map((c) => c.title)).toEqual([
      'Ne izleniyor',
      'Ne kadar ilgi var',
      'Nasıl konuşuluyor',
      'Nerede erişilebilir',
      'Etkisi',
    ])
    expect(b.chapters.map((c) => c.key)).toEqual(['izleniyor', 'ilgi', 'erisim'])
    expect(b.chapters[0].sections.map((x) => x.key)).toEqual(['platformLists', 'topSeries'])
    expect(JSON.stringify(b.chapters)).not.toContain('netflixHistory')
    expect(b.week).toBe('2026-10-04')
    expect(b.contract).toBe('ulke-brifingi-v1')
  })

  it('hesaplanamayan bölüm belgede yok, ek de yok; uyarılar kaynak adsız', () => {
    const keys = b.chapters.flatMap((c) => c.sections.map((x) => x.key))
    for (const k of ['searchTrend', 'pressTone', 'gapAnalysis', 'tourismSignal', 'foreignStudents', 'availability'])
      expect(keys).not.toContain(k)
    expect(b.appendix).toBeUndefined()
    expect(b.chapters[0].sections[1].caveat).toMatch(/Arama payı bu ülke için henüz ölçülmediğinden/)
    const brand =
      /GDELT|Google|Share of Search|TMDB|JustWatch|Wikipedia|Vikipedi|YİGM|Duolingo|SerpA[pP][iI]|IMDb|FlixPatrol|Dünya Bankası|World Bank|Netflix/
    expect(JSON.stringify({ ...b, chapters: [] })).not.toMatch(brand)
  })

  it('her bölümün başlığı var; yayın platformları bölümü brifingde yok', () => {
    const keys = BRIEFING_CHAPTERS.flatMap((c) => c.sections)
    for (const k of keys) expect(BRIEFING_SECTION_TITLES[k], k).toBeTruthy()
    expect(keys).not.toContain('availability')
  })
})

describe('okunma göstergesi — yalnızca ortak dil', () => {
  it('sayı yok, nedeni yazılır', () => {
    const s = buildSummary({
      wikiInterest: ok({ languages: [{ lang: 'ar', languageName: 'Arapça', regional: true }], primary: null }),
    })
    expect(s.kpis.find((k) => k.key === 'reading')).toMatchObject({
      value: '—',
      detail: 'ortak dil (Arapça); ülkeye ayrılamaz',
      trend: null,
    })
  })
})
