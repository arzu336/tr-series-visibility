import { generateFindings } from './reportFindings.js'

// Ülke brifingi (sözleşme ulke-brifingi-v1): buildCountryReport'un hesapladığı bölümlerden, karar verecek
// biri için düzenlenmiş tek ortak belge. Kurallar (kullanıcı kararları, 2026-10-05):
//   - Özet kartı başta: otomatik cümleler (kural tabanlı, öneri yok) + dört ana sayı ve yön okları.
//   - Beş başlık: ne izleniyor, ne kadar ilgi var, nasıl konuşuluyor, nerede erişilebilir, etkisi.
//   - Hesaplanamayan bölüm gövdede "veri yok" kutusu olarak görünmez; boş başlık atlanır. Ek (yöntem notları,
//     eksik veri listesi) 2026-10-06'da kaldırıldı: belge yalnızca bulguları taşır.
//   - Veri kaynaklarının ya da tek tek platform listelerinin adı geçmez (metinler burada yazılır; ham
//     bölüm gerekçeleri brifinge taşınmaz).

export const BRIEFING_CONTRACT = 'ulke-brifingi-v1'

export const BRIEFING_CHAPTERS = [
  { key: 'izleniyor', title: 'Ne izleniyor', sections: ['platformLists', 'topSeries'] },
  { key: 'ilgi', title: 'Ne kadar ilgi var', sections: ['wikiInterest', 'searchTrend'] },
  { key: 'gundem', title: 'Nasıl konuşuluyor', sections: ['pressTone'] },
  { key: 'erisim', title: 'Nerede erişilebilir', sections: ['trend', 'themes', 'gapAnalysis'] },
  { key: 'etki', title: 'Etkisi', sections: ['tourismSignal', 'foreignStudents'] },
]

export const BRIEFING_SECTION_TITLES = {
  platformLists: 'Türk dizileri sıralaması',
  topSeries: 'Öne çıkan diziler',
  wikiInterest: 'Okunma ilgisi',
  searchTrend: 'Arama ilgisi (son 12 ay)',
  pressTone: 'Basın tonu',
  trend: 'Yayın varlığındaki değişim',
  themes: 'Tema dağılımı',
  gapAnalysis: 'Benzer ülkelerde olup burada olmayan diziler',
  tourismSignal: 'Turizm ilgisi',
  foreignStudents: 'Türkiye’de okuyan öğrenciler',
}

const CAVEAT_TEXT = {
  topSeries: 'Arama payı bu ülke için henüz ölçülmediğinden sıralama diğer göstergelerle yapıldı.',
}

// Ek kaldırıldığı için okurun yanlış okumaması gereken tek uyarı bölümün altında kalır.
const ALWAYS_CAVEAT = {
  tourismSignal: 'Birlikte hareket nedensellik değildir.',
}

const LINEAR_TV_TEXT =
  'Bu ülkede çok sayıda Türk dizisi yerel adla dağıtılmış; izlenmenin önemli bölümü televizyonda olabilir ve ' +
  'çevrimiçi listeler bunu tam yansıtmaz.'

const SUMMARY_SENTENCES = 4

const ok = (s) => s?.status === 'hesaplandi'
const dir = (cur, prev) => (cur == null || prev == null ? null : cur > prev ? 'up' : cur < prev ? 'down' : 'same')
const fmtInt = (n) => Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 0 })

/** Özet kartı: dört ana sayı (yönleriyle) + kural tabanlı cümleler + varsa televizyon uyarısı. */
export function buildSummary(sections) {
  const { scores, ranking, platformLists, trend, wikiInterest } = sections
  const kpis = []

  const level = ok(scores) ? scores.data.level : null
  kpis.push({
    key: 'level',
    label: 'İzlenme düzeyi',
    value: level ?? '—',
    detail: ok(ranking) ? `${ranking.data.rank}. / ${ranking.data.of} ülke` : null,
    trend: null,
  })

  if (ok(platformLists)) {
    const n = platformLists.data.now.length
    const prev = platformLists.data.previousCount ?? null
    kpis.push({
      key: 'ranked',
      label: 'Bu hafta sıralamada',
      value: `${n} dizi`,
      detail: prev != null ? `geçen hafta ${prev}` : null,
      trend: dir(n, prev),
    })
  } else {
    kpis.push({ key: 'ranked', label: 'Bu hafta sıralamada', value: '—', detail: null, trend: null })
  }

  const access = ok(scores) ? scores.data.access : null
  const short = ok(trend) ? trend.data.shortTerm : null
  kpis.push({
    key: 'available',
    label: 'Yayında',
    value: access ? `${access.seriesCount} dizi` : '—',
    detail: access ? `${access.platformCount} platformda` : null,
    trend:
      short?.direction === 'yükseliyor'
        ? 'up'
        : short?.direction === 'düşüyor'
          ? 'down'
          : short?.direction === 'sabit'
            ? 'same'
            : null,
  })

  const reading = ok(wikiInterest) ? wikiInterest.data.primary : null
  // Yalnızca birden çok ülkenin konuştuğu bir dil varsa (ör. Arapça) okunma bu ülkeye ayrılamaz: sayı yok, neden yazılır.
  const sharedOnly =
    !reading && ok(wikiInterest) ? wikiInterest.data.languages.map((l) => l.languageName).join(', ') : null
  kpis.push({
    key: 'reading',
    label: 'Okunma ilgisi (aylık)',
    value: reading ? fmtInt(reading.last) : '—',
    detail: reading
      ? `${reading.languageName}${reading.changePct != null ? ` · geçen aya göre %${fmtInt(Math.abs(reading.changePct))} ${reading.changePct >= 0 ? 'artış' : 'düşüş'}` : ''}`
      : sharedOnly
        ? `ortak dil (${sharedOnly}); ülkeye ayrılamaz`
        : null,
    trend: reading ? dir(reading.last, reading.prev) : null,
  })

  const { items } = generateFindings(
    {
      ranking,
      trend,
      lists: platformLists,
      wiki: wikiInterest,
      imdb: sections.topSeries,
      themes: sections.themes,
      pressTone: sections.pressTone,
      students: sections.foreignStudents,
    },
    { max: SUMMARY_SENTENCES }
  )
  const linearTv = ok(scores) && (scores.data.warnings || []).some((w) => w.code === 'linear-tv')
  return { kpis, sentences: items, caveat: linearTv ? LINEAR_TV_TEXT : null }
}

/** Raporu brifinge çevirir. Gövdede yalnızca hesaplanan bölümler; boş başlık atlanır. */
export function buildBriefing(report) {
  const s = report.sections
  const chapters = []
  for (const ch of BRIEFING_CHAPTERS) {
    const sections = ch.sections
      .filter((k) => ok(s[k]))
      .map((k) => ({
        key: k,
        title: BRIEFING_SECTION_TITLES[k],
        data: s[k].data,
        caveat: (s[k].caveat ? CAVEAT_TEXT[k] : null) ?? ALWAYS_CAVEAT[k] ?? null,
      }))
    if (sections.length) chapters.push({ key: ch.key, title: ch.title, sections })
  }
  return {
    iso2: report.iso2,
    title: 'Ülke brifingi',
    generatedAt: report.generatedAt,
    week: ok(s.platformLists) ? (s.platformLists.data.window?.to ?? null) : null,
    isTracked: report.isTracked,
    summary: buildSummary(s),
    chapters,
    contract: BRIEFING_CONTRACT,
  }
}
