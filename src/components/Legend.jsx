import { WATCH_LEVELS, WATCH_LEVEL_COLORS, NO_SIGNAL_COLOR, provisionalColor } from '../lib/scale.js'
import { WATCH_LEVEL_NOTE, MAP_SCALE_NOTE } from '../lib/methodologyNotes.js'

// Sade lejant (2026-10-06): beş düzey tek renk çubuğu (düşük → yüksek), altında yalnızca "tahmini" ve "veri yok".
// Ayrıntılar (yöntem, Türkiye'nin ölçek dışı olması, tahminin neye dayandığı) başlığın ipucunda.
const DETAY = [
  'Renk çubuğu soldan sağa: çok düşük, düşük, orta, yüksek, çok yüksek.',
  'Taralı: ülkede yalnızca bir izlenme kaynağı var; renk o kaynağa dayalı tahmindir, sıralamaya girmez.',
  "Koyu: izlenme kaynağı ölçülemedi — 'izlenmiyor' demek değildir.",
  'Türkiye (mor) kaynak ülkedir, ölçeğe dahil edilmez.',
].join('\n')

export default function Legend({ caption }) {
  if (caption) {
    return (
      <div className="legend">
        <p className="legend__caption" title={caption}>
          {caption.split(' — ')[0]} ⓘ
        </p>
      </div>
    )
  }
  return (
    <div className="legend">
      <p className="legend__title" title={`${DETAY}\n\n${WATCH_LEVEL_NOTE}\n\n${MAP_SCALE_NOTE}`}>
        İzlenme düzeyi ⓘ
      </p>
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
