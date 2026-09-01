import { useState } from 'react'
import { formatTrendsDate } from '../lib/formatDate.js'

const WIDTH = 680
const HEIGHT = 220
const PAD_X = 30
const PAD_TOP = 20
const PAD_BOTTOM = 28

// Kıyaslama Modu'nun çoklu çizgi grafiği — SeriesTrendChart.jsx'in tek-seri kalıbının (hover
// crosshair, tooltip) çok-seri hâli. Her dizinin KENDİ zaman serisi ayrı ayrı çekildiği için
// (farklı önbellek yaşları yüzünden hafta ızgaraları birebir örtüşmeyebilir) diziler ORTAK bir
// takvim/zaman eksenine (min-max timestamp aralığı) konumlanır — indekse göre değil, gerçek
// tarihe göre — bu yüzden nokta sayıları farklı olsa da doğru hizalanırlar.
// series: [{ name, color, timeline: [{timestamp, value}] }]
export default function MultiSeriesTrendChart({ series }) {
  const [hoverX, setHoverX] = useState(null)

  const withData = series.filter((s) => s.timeline?.length > 1)
  if (withData.length === 0) {
    return <p className="dashboard__empty">Seçilen diziler için küresel zaman serisi verisi bulunamadı.</p>
  }

  const allTimestamps = withData.flatMap((s) => s.timeline.map((p) => p.timestamp))
  const minTs = Math.min(...allTimestamps)
  const maxTs = Math.max(...allTimestamps)
  const tsRange = maxTs - minTs || 1
  const innerWidth = WIDTH - PAD_X * 2
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM

  const xOf = (ts) => PAD_X + ((ts - minTs) / tsRange) * innerWidth
  const yOf = (value) => PAD_TOP + innerHeight - (value / 100) * innerHeight

  const seriesPoints = withData.map((s) => ({
    ...s,
    points: s.timeline.map((p) => ({ x: xOf(p.timestamp), y: yOf(p.value), timestamp: p.timestamp, value: p.value })),
  }))

  // Ortak dikey çizgi + tooltip: fare X konumuna göre HER dizi KENDİ en yakın noktasını bağımsız
  // bulur (aynı hafta ızgarasında olduklarını varsaymaz) — kullanıcı talebi: "o haftaki TÜM
  // dizilerin puanlarını gösteren ortak bir tooltip".
  const hovered =
    hoverX == null
      ? null
      : seriesPoints.map((s) => {
          let nearest = s.points[0]
          let nearestDist = Infinity
          for (const pt of s.points) {
            const d = Math.abs(pt.x - hoverX)
            if (d < nearestDist) {
              nearestDist = d
              nearest = pt
            }
          }
          return { name: s.name, color: s.color, point: nearest }
        })

  function handleMove(e) {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    setHoverX(((e.clientX - rect.left) / rect.width) * WIDTH)
  }

  const axisTicks = 6
  const axisTimestamps = Array.from({ length: axisTicks }, (_, i) => minTs + (tsRange * i) / (axisTicks - 1))

  return (
    <div>
      <div className="lag-chart__legend">
        {withData.map((s) => (
          <span key={s.name} className="lag-chart__legend-item">
            <span className="lag-chart__swatch" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <svg
        className="period-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Seçilen dizilerin küresel arama ilgisi karşılaştırması"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverX(null)}
      >
        {seriesPoints.map((s) => {
          const linePath = s.points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ')
          return <path key={s.name} d={linePath} fill="none" stroke={s.color} strokeWidth="2.25" />
        })}

        {hovered && (
          <>
            <line
              x1={hoverX}
              x2={hoverX}
              y1={PAD_TOP}
              y2={HEIGHT - PAD_BOTTOM}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="1"
            />
            {hovered.map((h) => (
              <circle key={h.name} cx={h.point.x} cy={h.point.y} r="3.5" fill={h.color} stroke="rgba(16,25,28,0.6)" strokeWidth="1" />
            ))}
          </>
        )}

        {axisTimestamps.map((ts, i) => (
          <text key={i} x={xOf(ts)} y={HEIGHT - 8} textAnchor="middle" className="period-chart__axis-label">
            {formatTrendsDate(ts)}
          </text>
        ))}
      </svg>
      {hovered && (
        <div className="period-chart__tooltip">
          <strong>{formatTrendsDate(hovered[0].point.timestamp)}</strong>
          <br />
          {hovered.map((h, i) => (
            <span key={h.name}>
              <span style={{ color: h.color, fontWeight: 600 }}>{h.name}</span>: {h.point.value}
              {i < hovered.length - 1 ? '  ·  ' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
