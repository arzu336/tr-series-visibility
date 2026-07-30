import { legendStops } from '../lib/scale.js'

// caption verilmezse (madde 1 — dizi bazlı harita filtresi aktif değilken) varsayılan TMDB
// açıklaması gösterilir; seriesFilter aktifken App.jsx buraya gerçek anlamı (Google Trends
// arama ilgisi) yansıtan bir açıklama geçer — aynı renk skalası farklı bir metriğe
// uygulandığında kullanıcı bunun ne olduğunu yanlış anlamasın diye.
export default function Legend({ caption }) {
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
        title={
          caption ||
          "TMDB'nin kendi popülerlik metriği (arama, oy ve trend sinyallerinin karışımı) × o ülkede yayında olma durumu. Gerçek izlenme/rating rakamı değildir — bir yakınsama (proxy) göstergesidir."
        }
      >
        {caption ? caption.split(' — ')[0] : 'Kültürel Görünürlük Skoru (TMDB popülerliği × yayın erişimi)'} ⓘ
      </p>
    </div>
  )
}
