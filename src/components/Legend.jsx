import { legendStops } from '../lib/scale.js'
import { VISIBILITY_SCORE_NOTE } from '../lib/methodologyNotes.js'

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
      {/* Denetim C.5: varsayılan ipucu "Popülerlik × yayın erişimi — proxy gösterge." idi;
          ne ölçtüğünü değil, ne olmadığını da söylemiyordu. Artık tek kaynaktan (lib/
          methodologyNotes.js) gelen açık çerçeve. */}
      <p className="legend__caption" title={caption || VISIBILITY_SCORE_NOTE}>
        {caption ? caption.split(' — ')[0] : 'Kültürel Görünürlük Skoru'} ⓘ
      </p>
    </div>
  )
}
