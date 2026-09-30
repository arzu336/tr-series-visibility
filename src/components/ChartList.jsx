import { EMPTY } from '../lib/emptyStates.js'

// Tek liste bileşeni: hangi sağlayıcıdan gelirse gelsin aynı görünüm — sıra, ad, kaç haftadır/gündür
// listede, ↑↓/yeni. Altında kaynak ve son güncelleme (ChartSource). Uydurma yok: boş liste boş yazar.

export function fmtDateTr(iso, { withTime = false } = {}) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const opts = { day: 'numeric', month: 'short', year: 'numeric' }
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('tr-TR', opts)
}

export function ChartSource({ source, periodLabel }) {
  if (!source) return null
  return (
    <p className="chart-source">
      Kaynak: {source.label}
      {source.platform ? ` · ${source.platform}` : ''}
      {periodLabel ? ` · ${periodLabel}` : ''}
      {source.fetchedAt ? ` · güncelleme ${fmtDateTr(source.fetchedAt, { withTime: true })}` : ''}
    </p>
  )
}

function TrendBadge({ trend }) {
  if (!trend) return null
  const cls =
    trend === 'yeni'
      ? 'chart-list__trend chart-list__trend--new'
      : trend.startsWith('↑')
        ? 'chart-list__trend chart-list__trend--up'
        : trend.startsWith('↓')
          ? 'chart-list__trend chart-list__trend--down'
          : 'chart-list__trend'
  return (
    <span
      className={cls}
      aria-label={trend === 'yeni' ? 'listeye yeni girdi' : trend === '=' ? 'sıra değişmedi' : `sıra değişimi ${trend}`}
    >
      {trend}
    </span>
  )
}

/**
 * items: [{ rank, name, kind, weeksInList|periods, trend?, bestRank?, lastDate?, meta? }]
 * periodWord: 'hafta' | 'gün'
 */
export default function ChartList({
  items,
  periodWord = 'hafta',
  emptyText = EMPTY.chartEmpty,
  onSelect,
  compact = false,
  showKind = false,
}) {
  if (!items || items.length === 0) return <p className="dashboard__empty">{emptyText}</p>
  return (
    <ol className={compact ? 'chart-list chart-list--compact' : 'chart-list'}>
      {items.map((it, i) => {
        const key = `${it.seriesId ?? it.titleRaw ?? it.name}-${it.rank ?? i}-${it.platform ?? ''}`
        const periods = it.weeksInList ?? it.periods
        const inner = (
          <>
            <span className="chart-list__rank">{it.rank ?? i + 1}</span>
            <span className="chart-list__body">
              <span className="chart-list__name">
                {it.name}
                {showKind && it.kind && it.kind !== 'series' && (
                  <span
                    className="chart-list__kind"
                    title={it.kind === 'other' ? 'dizi değil (haber, yarışma, spor…)' : 'katalog dışı program'}
                  >
                    {it.kind === 'other' ? 'dizi değil' : 'katalog dışı'}
                  </span>
                )}
              </span>
              <span className="chart-list__meta">
                {periods != null ? `${periods} ${periodWord}${it.trend ? '' : ' listede'}` : ''}
                {it.bestRank != null ? ` · en iyi #${it.bestRank}` : ''}
                {it.lastDate ? ` · son ${fmtDateTr(it.lastDate)}` : ''}
                {it.meta ? ` · ${it.meta}` : ''}
              </span>
            </span>
            <TrendBadge trend={it.trend} />
          </>
        )
        return (
          <li key={key} className="chart-list__item">
            {onSelect && it.seriesId != null ? (
              <button
                type="button"
                className="chart-list__row chart-list__row--btn"
                onClick={() => onSelect(it.seriesId, it)}
                aria-label={`${it.name} — ayrıntı`}
              >
                {inner}
              </button>
            ) : (
              <div className="chart-list__row">{inner}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
