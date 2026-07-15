import { legendStops } from '../lib/scale.js'

export default function Legend() {
  return (
    <div className="legend">
      <span className="legend__label">Düşük</span>
      <div className="legend__bar">
        {legendStops.map((color) => (
          <span key={color} style={{ background: color }} />
        ))}
      </div>
      <span className="legend__label">Yüksek</span>
      <p className="legend__caption">Kültürel Görünürlük Skoru (TMDB popülerlik × yayın erişimi)</p>
    </div>
  )
}
