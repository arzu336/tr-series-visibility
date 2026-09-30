import { direktifIceriyorMu } from '../llm.js'

// Yönetici özeti için 3 bulgu — yalnızca kural, yalnızca rapordaki sayılar. LLM yok, öneri yok
// (proje kuralı: aksiyon önerisi yasak; her cümle direktif süzgecinden geçer). Veri eksikse bulgu
// sayısı düşer; asla uydurulmaz. Sıra: sıralama → trend → Netflix → tema → basın.

export const MAX_FINDINGS = 3
const MAX_LEN = 160

const fmt1 = (n) => Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 1 })
const pct = (n) => `%${Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`

function kes(metin) {
  return metin.length <= MAX_LEN ? metin : `${metin.slice(0, MAX_LEN - 1)}…`
}

export function candidateFindings({ ranking, trend, netflix, themes, pressTone } = {}) {
  const out = []

  if (ranking?.status === 'hesaplandi') {
    const { perCapitaRank, perCapitaOf, totalRank, totalOf } = ranking.data
    if (perCapitaRank != null) {
      out.push({
        text: `Kişi başına görünürlükte ${perCapitaOf} ülke arasında ${perCapitaRank}. sırada; toplam skorda ${totalOf} ülke arasında ${totalRank}. sırada.`,
        basis: 'ranking',
      })
    } else if (totalRank != null) {
      out.push({
        text: `Toplam görünürlükte ${totalOf} ülke arasında ${totalRank}. sırada (kişi başına oran küçük payda nedeniyle sıralanmadı).`,
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
            ? `Görünürlük skoru son ${t.windowDays} günde sabit kaldı (${pct(Math.abs(t.changePct))} değişim).`
            : `Görünürlük skoru son ${t.windowDays} günde ${pct(Math.abs(t.changePct))} ${yon}.`,
        basis: 'trend',
      })
    }
  }

  if (netflix?.status === 'hesaplandi' && netflix.data.rows?.length > 0) {
    const rows = netflix.data.rows
    const enIyi = rows.reduce((a, b) => (b.peakRank < a.peakRank ? b : a))
    out.push({
      text: `${rows.length} dizi Netflix Top 10'a girdi; en iyi sıra #${enIyi.peakRank} (${enIyi.name}, ${enIyi.weeksInTop10} hafta).`,
      basis: 'netflix',
    })
  }

  if (themes?.status === 'hesaplandi' && themes.data.items?.length > 0) {
    const [ilk] = themes.data.items
    out.push({ text: `En güçlü tema "${ilk.theme}" (görünürlüğün ${pct(ilk.sharePct)}'i).`, basis: 'themes' })
  }

  if (pressTone?.status === 'hesaplandi' && pressTone.data.mediaTone?.status === 'hesaplandi') {
    const m = pressTone.data.mediaTone
    out.push({
      text: `Basın taramasında ortalama %${fmt1(m.value)} olumlu ton (${m.sampleSize} dizi/ülke çifti).`,
      basis: 'pressTone',
    })
  }

  return out.map((f) => ({ ...f, text: kes(f.text) }))
}

/** En fazla MAX_FINDINGS bulgu; direktif içeren cümle (kural gereği olmamalı) düşürülür. */
export function generateFindings(inputs) {
  const kabul = []
  let dropped = 0
  for (const f of candidateFindings(inputs)) {
    if (direktifIceriyorMu(f.text)) {
      dropped++
      continue
    }
    kabul.push(f)
    if (kabul.length === MAX_FINDINGS) break
  }
  return { items: kabul, dropped }
}
