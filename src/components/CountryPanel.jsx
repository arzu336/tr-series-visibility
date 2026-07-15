export default function CountryPanel({ country, onClose }) {
  if (!country) {
    return (
      <div className="panel panel--empty">
        <p>Detayları görmek için globdeki bir sütuna tıklayın.</p>
      </div>
    )
  }

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
      </dl>
      <h3>Yayındaki diziler</h3>
      <ul className="panel__series-list">
        {country.seriesList.map((s) => (
          <li key={s.name}>
            <span>{s.name}</span>
            <span className="panel__series-score">{s.popularity.toFixed(1)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
