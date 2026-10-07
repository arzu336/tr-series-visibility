import { EMPTY } from '../lib/emptyStates.js'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w92'

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
      {periodLabel ? ` · ${periodLabel}` : ''}
      {source.fetchedAt ? ` · güncelleme ${fmtDateTr(source.fetchedAt, { withTime: true })}` : ''}
    </p>
  )
}

// Spotify listelerindeki gibi: yükselen yeşil ▲, düşen kırmızı ▼ (kaç sıra olduğu yalnızca ipucunda),
// aynı kalan gri çizgi. Raporlarda (`withCount`) sıra farkı okun yanına yazılır: baskıda ipucu görünmez. Listeye giren ya da geri giren dizide işaret yok: "YENİ"/"TEKRAR" rozetleri dizinin
// yeni çıktığı ya da tekrar yayını olduğu izlenimi verdiği için kaldırıldı (kullanıcı kararı, 2026-10-06).
const TREND_LABELS = {
  '=': 'sıra değişmedi',
}

export function TrendBadge({ trend, withCount = false }) {
  if (!trend || trend === 'yeni' || trend === 'tekrar') return null
  const up = trend.startsWith('↑')
  const down = trend.startsWith('↓')
  const label = up
    ? `${trend.slice(1)} sıra yükseldi`
    : down
      ? `${trend.slice(1)} sıra düştü`
      : (TREND_LABELS[trend] ?? trend)
  let cls = 'chart-list__trend'
  let content = trend
  if (up) {
    cls += ' chart-list__trend--up'
    content = withCount ? `▲ ${trend.slice(1)}` : '▲'
  } else if (down) {
    cls += ' chart-list__trend--down'
    content = withCount ? `▼ ${trend.slice(1)}` : '▼'
  } else if (trend === '=') {
    cls += ' chart-list__trend--same'
    content = '–'
  }
  return (
    <span className={cls} title={label} aria-label={label}>
      {content}
    </span>
  )
}

/**
 * items: [{ rank, name, kind, weeksInList|periods, trend?, bestRank?, lastDate?, meta?, posterPath? }]
 * showPosters: satır başında dizi afişi (yoksa boş yer tutucu)
 * periodWord: 'hafta' | 'gün'
 */
export default function ChartList({
  items,
  periodWord = 'hafta',
  emptyText = EMPTY.chartEmpty,
  onSelect,
  compact = false,
  showKind = false,
  showPosters = false,
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
            {showPosters &&
              (it.posterPath ? (
                <img className="chart-list__poster" src={`${POSTER_BASE}${it.posterPath}`} alt="" loading="lazy" />
              ) : (
                <span className="chart-list__poster chart-list__poster--empty" aria-hidden="true" />
              ))}
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
                {[
                  periods != null ? `${periods} ${periodWord}${it.trend ? '' : ' listede'}` : null,
                  it.bestRank != null ? `en iyi #${it.bestRank}` : null,
                  it.lastDate ? `son ${fmtDateTr(it.lastDate)}` : null,
                  it.meta || null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
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
