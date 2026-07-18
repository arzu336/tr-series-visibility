import Sparkline from './Sparkline.jsx'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w92'

function trendLabel(trend) {
  if (!trend || trend.direction === 'yetersiz-veri') {
    return { icon: '•', text: 'Yetersiz veri (takip yeni başladı)', className: 'trend--neutral' }
  }
  const pct = trend.changePct > 0 ? `+${trend.changePct}` : `${trend.changePct}`
  const suffix = `(${pct}%, son ${trend.windowDays} gün)`
  if (trend.direction === 'yükseliyor') {
    return { icon: '▲', text: `Yükseliyor ${suffix}`, className: 'trend--up' }
  }
  if (trend.direction === 'düşüyor') {
    return { icon: '▼', text: `Düşüyor ${suffix}`, className: 'trend--down' }
  }
  return { icon: '→', text: `Sabit ${suffix}`, className: 'trend--flat' }
}

function yearOf(dateStr) {
  return dateStr ? dateStr.slice(0, 4) : null
}

export default function CountryPanel({ country, onClose }) {
  if (!country) {
    return (
      <div className="panel panel--empty">
        <p>Detayları görmek için globdeki bir ülkeye tıklayın.</p>
      </div>
    )
  }

  const trend = trendLabel(country.trend)

  return (
    <div className="panel">
      <button className="panel__close" onClick={onClose} aria-label="Kapat">
        ×
      </button>
      <h2>{country.name}</h2>
      <dl className="panel__stats">
        <dt>Görünürlük skoru</dt>
        <dd>{country.score.toFixed(1)}</dd>
        <dt>En popüler dizi</dt>
        <dd>{country.topSeries ? country.topSeries.name : '—'}</dd>
        <dt>Yayındaki dizi sayısı</dt>
        <dd>{country.seriesCount}</dd>
        <dt>Baskın tema</dt>
        <dd>
          {country.dominantTheme}
          {country.isThemeUncertain && <span className="badge badge--uncertain"> (belirsiz)</span>}
        </dd>
        <dt>Trend yönü</dt>
        <dd className={trend.className}>
          {trend.icon} {trend.text}
        </dd>
      </dl>

      <h3>Görünürlük geçmişi</h3>
      <Sparkline history={country.history} />

      <h3>Yayındaki diziler</h3>
      <ul className="panel__series-list">
        {country.seriesList.map((s) => (
          <li key={s.name}>
            {s.posterPath ? (
              <img className="panel__series-poster" src={`${POSTER_BASE}${s.posterPath}`} alt="" />
            ) : (
              <span className="panel__series-poster panel__series-poster--empty" aria-hidden="true" />
            )}
            <span className="panel__series-info">
              <span className="panel__series-name">{s.name}</span>
              <span className="panel__series-meta">
                {yearOf(s.firstAirDate) || '—'} · {s.theme}
              </span>
            </span>
            <span className="panel__series-score">{s.popularity.toFixed(1)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
