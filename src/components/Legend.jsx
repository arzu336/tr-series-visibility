import { WATCH_LEVELS, WATCH_LEVEL_COLORS, NO_SIGNAL_COLOR, provisionalColor } from '../lib/scale.js'
// Sade lejant (2026-10-06): beş düzey tek renk çubuğu (düşük → yüksek), altında yalnızca "tahmini" ve "veri yok".
// Açıklama notları kullanıcı isteğiyle kaldırıldı (2026-10-14).

export default function Legend() {
  return (
    <div className="legend">
      <p className="legend__title">İzlenme düzeyi</p>
      <div className="legend__bar" role="img" aria-label={`İzlenme düzeyi renkleri: ${WATCH_LEVELS.join(', ')}`}>
        {WATCH_LEVELS.map((level) => (
          <span key={level} style={{ background: WATCH_LEVEL_COLORS[level] }} title={level} />
        ))}
      </div>
      <div className="legend__ends">
        <span>Düşük</span>
        <span>Yüksek</span>
      </div>
      <div className="legend__extras">
        <span>
          <span
            className="legend__dot"
            style={{
              background: `repeating-linear-gradient(45deg, ${WATCH_LEVEL_COLORS.Orta} 0 2px, ${provisionalColor('Orta')} 2px 4px)`,
            }}
          />
          Tahmini
        </span>
        <span>
          <span className="legend__dot" style={{ background: NO_SIGNAL_COLOR }} />
          Veri yok
        </span>
      </div>
    </div>
  )
}
