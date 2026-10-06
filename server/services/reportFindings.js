import { direktifIceriyorMu } from '../llm.js'

// Yönetici özeti için 3 bulgu — yalnızca kural, yalnızca rapordaki sayılar. LLM yok, öneri yok
// (proje kuralı: aksiyon önerisi yasak; her cümle direktif süzgecinden geçer). Veri eksikse bulgu
// sayısı düşer; asla uydurulmaz. Sıra (FINDING_ORDER): izleyiciye dair sinyaller önce — izlenme düzeyi →
// sıralama → okunma → izleyici oyu → basın → tema; katalog değişimini yansıtan yayın varlığı en sonda.

export const MAX_FINDINGS = 3
const FINDING_ORDER = ['ranking', 'lists', 'wiki', 'imdb', 'pressTone', 'students', 'themes', 'netflix', 'trend']
const MAX_LEN = 160

const fmt1 = (n) => Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 1 })
const pct = (n) => `%${Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`
const int = (n) => Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 0 })

function kes(metin) {
  return metin.length <= MAX_LEN ? metin : `${metin.slice(0, MAX_LEN - 1)}…`
}

export function candidateFindings({ ranking, trend, lists, wiki, netflix, imdb, themes, pressTone, students } = {}) {
  const out = []

  if (ranking?.status === 'hesaplandi') {
    const { rank, of, level } = ranking.data
    if (rank != null) {
      out.push({
        text: `İzlenme düzeyi "${level}": izlenme sinyali hesaplanan ${of} ülke arasında ${rank}. sırada.`,
        basis: 'ranking',
      })
    }
  }

  if (trend?.status === 'hesaplandi') {
    const t = trend.data.shortTerm
    if (t && t.direction !== 'yetersiz-veri' && t.changePct != null) {
      const yon = t.direction === 'yükseliyor' ? 'arttı' : 'azaldı'
      out.push({
        text:
          t.direction === 'sabit'
            ? `Yayın varlığı son ${t.windowDays} günde sabit kaldı (${pct(Math.abs(t.changePct))} değişim).`
            : `Yayın varlığı (katalog ağırlığı) son ${t.windowDays} günde ${pct(Math.abs(t.changePct))} ${yon}.`,
        basis: 'trend',
      })
    }
  }

  if (lists?.status === 'hesaplandi' && lists.data.now?.length > 0) {
    const now = lists.data.now
    const ilk = now.reduce((a, b) => (b.position < a.position ? b : a))
    out.push({
      text: `Bu hafta ${now.length} Türk dizisi sıralamada; ilk sırada ${ilk.name} (${ilk.weeks} haftadır listede).`,
      basis: 'lists',
    })
  }

  if (wiki?.status === 'hesaplandi' && wiki.data.primary?.changePct != null) {
    const p = wiki.data.primary
    const yon = p.changePct >= 0 ? 'arttı' : 'azaldı'
    out.push({
      text: `${p.languageName} okunma ilgisi geçen aya göre ${pct(Math.abs(p.changePct))} ${yon}${p.topName ? `; en çok okunan ${p.topName}` : ''}.`,
      basis: 'wiki',
    })
  }

  if (netflix?.status === 'hesaplandi' && netflix.data.rows?.length > 0) {
    const rows = netflix.data.rows
    const enIyi = rows.reduce((a, b) => (b.peakRank < a.peakRank ? b : a))
    out.push({
      text: `${rows.length} dizi Netflix Top 10'a girdi; en iyi sıra #${enIyi.peakRank} (${enIyi.name}, ${enIyi.weeksInTop10} hafta).`,
      basis: 'netflix',
    })
  }

  if (imdb?.status === 'hesaplandi') {
    const artan = (imdb.data.entries || []).filter((e) => e.imdb?.growth7?.votes > 0)
    if (artan.length > 0) {
      const enCok = artan.reduce((a, b) => (b.imdb.growth7.votes > a.imdb.growth7.votes ? b : a))
      const g = enCok.imdb.growth7
      out.push({
        text: `${enCok.name} son ${g.days} günde ${int(g.votes)} yeni izleyici oyu aldı (izleyici puanı ${fmt1(enCok.imdb.rating)}).`,
        basis: 'imdb',
      })
    }
  }

  if (students?.status === 'hesaplandi' && students.data.students > 0) {
    const s = students.data
    const degisim =
      s.changePct != null && s.baseYear
        ? `; ${s.baseYear}'e göre ${pct(Math.abs(s.changePct))} ${s.changePct >= 0 ? 'artış' : 'düşüş'}`
        : ''
    out.push({
      text: `${s.year}'te bu ülkeden Türkiye'de ${int(s.students)} öğrenci okuyordu${degisim}.`,
      basis: 'students',
    })
  }

  if (themes?.status === 'hesaplandi' && themes.data.items?.length > 0 && themes.data.items[0].theme !== 'diğer') {
    const [ilk] = themes.data.items
    out.push({ text: `En güçlü tema "${ilk.theme}" (yayındaki kataloğun ${pct(ilk.sharePct)}'i).`, basis: 'themes' })
  }

  if (pressTone?.status === 'hesaplandi' && pressTone.data.mediaTone?.status === 'hesaplandi') {
    const m = pressTone.data.mediaTone
    out.push({
      text: `Basın taramasında ortalama %${fmt1(m.value)} olumlu ton (${m.sampleSize} dizi/ülke çifti).`,
      basis: 'pressTone',
    })
  }

  return out
    .sort((a, b) => FINDING_ORDER.indexOf(a.basis) - FINDING_ORDER.indexOf(b.basis))
    .map((f) => ({ ...f, text: kes(f.text) }))
}

/** En fazla MAX_FINDINGS bulgu; direktif içeren cümle (kural gereği olmamalı) düşürülür. */
export function generateFindings(inputs, { max = MAX_FINDINGS } = {}) {
  const kabul = []
  let dropped = 0
  for (const f of candidateFindings(inputs)) {
    if (direktifIceriyorMu(f.text)) {
      dropped++
      continue
    }
    kabul.push(f)
    if (kabul.length === max) break
  }
  return { items: kabul, dropped }
}
