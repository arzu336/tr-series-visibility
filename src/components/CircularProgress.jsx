const SIZE = 44
const STROKE = 4
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

// Göreli yüzdelik payı (bkz. src/lib/scoreShare.js) basit bir dairesel gösterge olarak
// çizer — canlı bir kütüphane yerine tek bir stroke-dasharray hilesiyle, mevcut proje
// stiliyle (küçük, bağımlılıksız inline bileşenler) tutarlı.
export default function CircularProgress({ pct, color = '#f0ad4e', label }) {
  const clamped = Math.max(0, Math.min(100, pct))
  const offset = CIRCUMFERENCE * (1 - clamped / 100)

  return (
    <div className="circular-progress" title={label}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      <span className="circular-progress__value">%{clamped}</span>
    </div>
  )
}
