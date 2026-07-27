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
      <p
        className="legend__caption"
        title="TMDB'nin kendi popülerlik metriği (arama, oy ve trend sinyallerinin karışımı) × o ülkede yayında olma durumu. Gerçek izlenme/rating rakamı değildir — bir yakınsama (proxy) göstergesidir."
      >
        Kültürel Görünürlük Skoru (TMDB popülerliği × yayın erişimi) ⓘ
      </p>
    </div>
  )
}
