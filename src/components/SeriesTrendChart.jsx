import { useState } from 'react'
import { formatTrendsDate } from '../lib/formatDate.js'

const WIDTH = 640
const HEIGHT = 200
const PAD_X = 30
const PAD_TOP = 28
const PAD_BOTTOM = 28
const LINE_COLOR = '#EE3135'
const AREA_COLOR = 'rgba(238, 49, 53, 0.12)'
const PEAK_COLOR = '#D2A94D'
const MAX_AXIS_LABELS = 10 // "18 Eki" tarihleri yeterince kısa — sıkışmadan gösterilebilecek en fazla etiket sayısı

// Küresel Zaman Serisi Grafiği — seçili dizinin son 12 aydaki HAFTALIK arama hacmini (0-100,
// Google Trends'in kendi bağıl ölçeği, geo verilmediği için dünya geneli) çizer. PeriodChart.jsx
// ile aynı kalıp (tekil seri, hover crosshair + tooltip) — burada zaman ekseni takvim haftası,
// PeriodChart'taki gibi ay/yıl periyodu değil. Zirve noktası otomatik etiketlenir (kullanıcı
// talebi) — serideki GERÇEKTEN en yüksek değere sahip nokta (Math.max ile, sabit bir eşik değil;
// Google Trends'in kendi tanımı gereği bu değer genelde 100 çıkar ama kod bunu VARSAYMAZ, her
// noktayı kıyaslayıp bulur), takvim tarihiyle etiketlenir (yıl yok — grafik zaten "son 12 ay"
// penceresini gösteriyor, aria-label'da belirtiliyor).
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

  const peakIdx = points.reduce((best, pt, i) => (pt.value > points[best].value ? i : best), 0)
  const peak = points[peakIdx]
  const peakLabel = `Dönem Zirvesi: ${formatTrendsDate(peak.timestamp)} — ${peak.value} Puan`
  const peakLabelWidth = peakLabel.length * 5.6 + 16
  const peakLabelX = Math.min(Math.max(peak.x, PAD_X + peakLabelWidth / 2), WIDTH - PAD_X - peakLabelWidth / 2)
  const peakLabelY = Math.max(peak.y - 12, 12)

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

        <g pointerEvents="none">
          <rect
            x={peakLabelX - peakLabelWidth / 2}
            y={peakLabelY - 13}
            width={peakLabelWidth}
            height="18"
            rx="4"
            fill="rgba(16,25,28,0.82)"
            stroke={PEAK_COLOR}
            strokeWidth="1"
          />
          <text x={peakLabelX} y={peakLabelY} textAnchor="middle" className="period-chart__peak-label">
            {peakLabel}
          </text>
        </g>
        <circle cx={peak.x} cy={peak.y} r="3.5" fill={PEAK_COLOR} stroke="rgba(16,25,28,0.6)" strokeWidth="1" />

        {hovered && (
          <>
            <line x1={hovered.x} x2={hovered.x} y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
            <circle cx={hovered.x} cy={hovered.y} r="3.5" fill={LINE_COLOR} />
          </>
        )}
        {points.map((pt, i) =>
          i % Math.ceil(n / MAX_AXIS_LABELS) === 0 || i === n - 1 ? (
            <text key={`label-${pt.timestamp}`} x={pt.x} y={HEIGHT - 8} textAnchor="middle" className="period-chart__axis-label">
              {formatTrendsDate(pt.timestamp)}
            </text>
          ) : null
        )}
      </svg>
      {hovered && (
        <div className="period-chart__tooltip">
          <strong>{formatTrendsDate(hovered.timestamp)}</strong>
          <br />
          Arama ilgisi: {hovered.value}
        </div>
      )}
    </div>
  )
}
