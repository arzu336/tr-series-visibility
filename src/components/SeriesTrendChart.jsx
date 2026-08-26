import { useState } from 'react'

const WIDTH = 640
const HEIGHT = 200
const PAD_X = 30
const PAD_TOP = 16
const PAD_BOTTOM = 28
const LINE_COLOR = '#EE3135'
const AREA_COLOR = 'rgba(238, 49, 53, 0.12)'

const MONTH_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

// SerpAPI'nin google_trends timeseries'i timestamp'i UNIX SANİYE olarak döner (ms değil) — bkz.
// serpApiCache.js.
function formatDate(tsSeconds) {
  const d = new Date(tsSeconds * 1000)
  return `${MONTH_SHORT[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`
}

// Küresel Zaman Serisi Grafiği — seçili dizinin son 12 aydaki HAFTALIK arama hacmini (0-100,
// Google Trends'in kendi bağıl ölçeği, geo verilmediği için dünya geneli) çizer. PeriodChart.jsx
// ile aynı kalıp (tekil seri, hover crosshair + tooltip) — burada zaman ekseni takvim haftası,
// PeriodChart'taki gibi ay/yıl periyodu değil.
export default function SeriesTrendChart({ timeline }) {
  const [hoverIdx, setHoverIdx] = useState(null)

  if (!timeline || timeline.length < 2) {
    return <p className="dashboard__empty">Bu dizi için küresel zaman serisi verisi bulunamadı.</p>
  }

  const innerWidth = WIDTH - PAD_X * 2
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM
  const n = timeline.length

  const points = timeline.map((p, i) => ({
    x: PAD_X + (i / (n - 1)) * innerWidth,
    y: PAD_TOP + innerHeight - (p.value / 100) * innerHeight,
    timestamp: p.timestamp,
    value: p.value,
  }))

  const linePath = points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${points[n - 1].x.toFixed(1)},${HEIGHT - PAD_BOTTOM} L${points[0].x.toFixed(1)},${HEIGHT - PAD_BOTTOM} Z`
  const hovered = hoverIdx != null ? points[hoverIdx] : null

  function handleMove(e) {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * WIDTH
    let nearest = 0
    let nearestDist = Infinity
    points.forEach((pt, i) => {
      const d = Math.abs(pt.x - px)
      if (d < nearestDist) {
        nearestDist = d
        nearest = i
      }
    })
    setHoverIdx(nearest)
  }

  return (
    <div>
      <svg
        className="period-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Küresel 12 aylık haftalık arama hacmi"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <path d={areaPath} fill={AREA_COLOR} stroke="none" />
        <path d={linePath} fill="none" stroke={LINE_COLOR} strokeWidth="2" />
        {hovered && (
          <>
            <line x1={hovered.x} x2={hovered.x} y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
            <circle cx={hovered.x} cy={hovered.y} r="3.5" fill={LINE_COLOR} />
          </>
        )}
        {points.map((pt, i) =>
          i % Math.ceil(n / 10) === 0 || i === n - 1 ? (
            <text key={`label-${pt.timestamp}`} x={pt.x} y={HEIGHT - 8} textAnchor="middle" className="period-chart__axis-label">
              {formatDate(pt.timestamp)}
            </text>
          ) : null
        )}
      </svg>
      {hovered && (
        <div className="period-chart__tooltip">
          <strong>{formatDate(hovered.timestamp)}</strong>
          <br />
          Arama ilgisi: {hovered.value}
        </div>
      )}
    </div>
  )
}
