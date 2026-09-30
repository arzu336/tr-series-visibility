import { WATCH_LEVELS, WATCH_LEVEL_COLORS, NO_SIGNAL_COLOR, SOURCE_COUNTRY_COLOR } from '../lib/scale.js'
import { WATCH_LEVEL_NOTE, MAP_SCALE_NOTE } from '../lib/methodologyNotes.js'

// Harita rengi = izlenme düzeyi (beş seviye). Sinyali yetersiz ülke gri; kaynak ülke ölçek dışı.
export default function Legend({ caption }) {
  const showLayers = !caption
  const note = `${WATCH_LEVEL_NOTE}\n\n${MAP_SCALE_NOTE}`

  return (
    <div className="legend">
      {caption ? (
        <p className="legend__caption" title={caption}>
          {caption.split(' — ')[0]} ⓘ
        </p>
      ) : (
        <>
          <div className="legend__levels" role="list" aria-label="İzlenme düzeyi renkleri">
            {WATCH_LEVELS.map((level) => (
              <div key={level} className="legend__level" role="listitem">
                <span className="legend__swatch" style={{ background: WATCH_LEVEL_COLORS[level] }} />
                <span className="legend__level-label">{level}</span>
              </div>
            ))}
          </div>
          <p className="legend__caption" title={note}>
            İzlenme düzeyi ⓘ
          </p>
        </>
      )}

      {showLayers && (
        <div className="legend__layers">
          <div className="legend__layer">
            <span className="legend__swatch" style={{ background: SOURCE_COUNTRY_COLOR }} />
            <span
              className="legend__layer-label"
              title="Türkiye dizilerin kaynak ülkesi, bir ihracat pazarı değil; ölçeğe dahil edilmez. Ülke paneli Türkiye TV listesini gösterir."
            >
              Kaynak ülke — ölçek dışı ⓘ
            </span>
          </div>
          <div className="legend__layer">
            <span className="legend__swatch" style={{ background: NO_SIGNAL_COLOR }} />
            <span
              className="legend__layer-label"
              title="Bu ülke için en az iki izlenme kaynağı (Netflix Top 10, Wikipedia okunması, arama ilgisi) yok. Gri 'izlenmiyor' demek değildir; ülke paneli eldeki diğer gerçekleri (yayındaki diziler, komşu pazar) gösterir."
            >
              Sinyal yetersiz ⓘ
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
