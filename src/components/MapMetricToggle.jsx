import { MAP_METRICS } from '../lib/scale.js'
import { PER_CAPITA_SCORE_NOTE, TOTAL_SCORE_NOTE } from '../lib/methodologyNotes.js'

export default function MapMetricToggle({ value, onChange }) {
  return (
    <div className="map-metric-toggle" role="group" aria-label="Harita metriği">
      <button
        className={
          value === MAP_METRICS.PER_CAPITA
            ? 'map-metric-toggle__btn map-metric-toggle__btn--active'
            : 'map-metric-toggle__btn'
        }
        onClick={() => onChange(MAP_METRICS.PER_CAPITA)}
        title={PER_CAPITA_SCORE_NOTE}
        aria-pressed={value === MAP_METRICS.PER_CAPITA}
      >
        Kişi Başına
      </button>
      <button
        className={
          value === MAP_METRICS.TOTAL
            ? 'map-metric-toggle__btn map-metric-toggle__btn--active'
            : 'map-metric-toggle__btn'
        }
        onClick={() => onChange(MAP_METRICS.TOTAL)}
        title={TOTAL_SCORE_NOTE}
        aria-pressed={value === MAP_METRICS.TOTAL}
      >
        Toplam
      </button>
    </div>
  )
}
