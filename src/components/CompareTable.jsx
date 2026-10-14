import countryNames from '../data/country-centroids.json'

// Kıyaslama tablosu (2026-10-14): satır = gösterge, sütun = dizi. Her hücrede değer ve dizilerin en yükseğine göre
// çubuk; en yüksek değer işaretlenir. Yalnızca kayıtlı veri; göstergesi olmayan dizi "—".

const fmt = (n) => {
  if (n == null) return '—'
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} milyar`
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} milyon`
  return n.toLocaleString('tr-TR', { maximumFractionDigits: 1 })
}
const nameOf = (iso2) => countryNames[iso2]?.name || iso2

/** Göstergeler: { key, label, value(item) → sayı|null, text(item) → gösterilecek metin, detail?(item), lowerIsBetter? } */
const METRICS = [
  {
    key: 'listCountries',
    label: 'Listeye girdiği ülke',
    value: (i) => i.lists.countries,
    text: (i) => (i.lists.countries ? `${i.lists.countries} ülke` : '—'),
    detail: (i) => (i.lists.platforms ? `${i.lists.platforms} platform` : null),
  },
  {
    key: 'countryWeeks',
    label: 'Listede kalma (ülke-hafta)',
    value: (i) => i.lists.countryWeeks,
    text: (i) => (i.lists.countryWeeks ? fmt(i.lists.countryWeeks) : '—'),
  },
  {
    key: 'bestRank',
    label: 'En iyi sıra',
    value: (i) => (i.lists.bestRank != null ? 11 - i.lists.bestRank : null),
    text: (i) => (i.lists.bestRank != null ? `${i.lists.bestRank}.` : '—'),
  },
  {
    key: 'available',
    label: 'Yayında olduğu ülke',
    value: (i) => i.availability.countries,
    text: (i) => (i.availability.countries ? `${i.availability.countries} ülke` : '—'),
  },
  {
    key: 'reading',
    label: 'Yabancı dillerde okunma (12 ay)',
    value: (i) => i.reading.total,
    text: (i) => (i.reading.total ? fmt(i.reading.total) : '—'),
    detail: (i) => i.reading.languages.map((l) => `${l.name} ${fmt(l.views)}`).join(' · ') || null,
  },
  {
    key: 'youtube',
    label: 'YouTube izlenme (resmî kanallar)',
    value: (i) => i.youtube?.views ?? null,
    text: (i) => (i.youtube ? fmt(i.youtube.views) : '—'),
    detail: (i) =>
      i.youtube
        ? [
            i.youtube.growth30 > 0 ? `son 30 gün +${fmt(i.youtube.growth30)}` : null,
            ...i.youtube.byLang.map((l) => `${l.name} ${fmt(l.views)}`),
          ]
            .filter(Boolean)
            .join(' · ')
        : null,
  },
  {
    key: 'online',
    label: 'Ülke video sitelerinde izlenme',
    value: (i) => i.online.reduce((n, o) => n + o.views, 0) || null,
    text: (i) => (i.online.length ? fmt(i.online.reduce((n, o) => n + o.views, 0)) : '—'),
    detail: (i) => i.online.map((o) => `${nameOf(o.iso2)} ${fmt(o.views)}`).join(' · ') || null,
  },
  {
    key: 'press',
    label: 'Basında haber (taranan ülkeler)',
    value: (i) => i.press.news || null,
    text: (i) => (i.press.news ? `${fmt(i.press.news)} haber` : i.press.countriesScanned ? 'haber yok' : '—'),
    detail: (i) =>
      i.press.countriesWithNews
        ? `${i.press.countriesWithNews} ülke${i.press.positivePct != null ? ` · olumlu %${i.press.positivePct}` : ''}`
        : null,
  },
  {
    key: 'rating',
    label: 'İzleyici puanı',
    value: (i) => i.imdb?.rating ?? null,
    text: (i) => (i.imdb ? i.imdb.rating.toFixed(1) : '—'),
    detail: (i) =>
      i.imdb ? `${fmt(i.imdb.votes)} oy${i.imdb.votes30 > 0 ? ` · son 30 gün +${fmt(i.imdb.votes30)}` : ''}` : null,
  },
]

export default function CompareTable({ items, colors = [] }) {
  if (!items?.length) return null
  return (
    <div className="compare-table-wrap">
      <table className="dashboard__table compare-table">
        <thead>
          <tr>
            <th scope="col">Gösterge</th>
            {items.map((it, i) => (
              <th key={it.id} scope="col" style={{ '--chip-color': colors[i] }}>
                <span className="chip__dot" /> {it.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => {
            const values = items.map((it) => m.value(it))
            const nums = values.filter((v) => v != null)
            const max = nums.length ? Math.max(...nums) : null
            return (
              <tr key={m.key}>
                <th scope="row">{m.label}</th>
                {items.map((it, i) => {
                  const v = values[i]
                  const lead = v != null && v === max && nums.length > 1
                  return (
                    <td key={it.id} className={lead ? 'compare-table__lead' : undefined}>
                      <div className="compare-table__value">{m.text(it)}</div>
                      {max > 0 && v != null && (
                        <div className="compare-table__track">
                          <div
                            className="compare-table__bar"
                            style={{ width: `${(v / max) * 100}%`, background: colors[i] }}
                          />
                        </div>
                      )}
                      {m.detail?.(it) && <div className="compare-table__detail">{m.detail(it)}</div>}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="dashboard__hint">Liste ve okunma sayıları yurt dışı içindir; Türkiye dahil değildir.</p>
    </div>
  )
}
