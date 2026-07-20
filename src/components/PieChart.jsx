import { useState } from 'react'

const SIZE = 200
const RADIUS = 82
const CENTER = SIZE / 2
const STROKE_COLOR = '#0a0e18'
const HOVER_OFFSET = 6
const LABEL_MIN_PCT = 6

// Doğrulanmış kategorik palet (dataviz skill, --mode dark, koyu tema yüzeyimize göre
// kontrol edildi) — sabit sırayla atanır, asla döngüyle üretilmez. "Diğer" dilimi
// gerçek bir kimlik değil, kalan toplamı temsil ettiği için nötr griye alınır.
const SLOT_COLORS = ['#3987e5', '#008300', '#d55181', '#c98500', '#199e70']
const OTHER_COLOR = '#6b7280'

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle)
  const end = polarToCartesian(cx, cy, r, startAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`
}

function round1(n) {
  return Math.round(n * 10) / 10
}

// items: [{ label, value, valueLabel, isOther? }] — en büyükten küçüğe, "Diğer" en sonda beklenir.
// onSliceClick(item) verilirse dilimler ve legend satırları tıklanabilir/hover'lı olur.
export default function PieChart({ items, onSliceClick }) {
  const [hovered, setHovered] = useState(null)

  const total = items.reduce((sum, i) => sum + i.value, 0)
  if (total <= 0) return null

  let angle = 0
  const slices = items.map((item, idx) => {
    const startAngle = angle
    const fraction = item.value / total
    angle += fraction * 360
    const endAngle = angle
    const color = item.isOther ? OTHER_COLOR : SLOT_COLORS[idx % SLOT_COLORS.length]
    return {
      ...item,
      color,
      pct: round1(fraction * 100),
      startAngle,
      endAngle,
      mid: (startAngle + endAngle) / 2,
    }
  })

  const clickable = Boolean(onSliceClick)

  return (
    <div className="pie-chart">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label="Parça-bütün dağılımı">
        {slices.map((s) => {
          if (s.endAngle <= s.startAngle) return null
          const isHovered = hovered === s.label
          const rad = ((s.mid - 90) * Math.PI) / 180
          const dx = Math.cos(rad) * HOVER_OFFSET
          const dy = Math.sin(rad) * HOVER_OFFSET
          const labelPos = polarToCartesian(CENTER, CENTER, RADIUS * 0.65, s.mid)

          return (
            <g
              key={s.label}
              className="pie-chart__slice"
              style={{ transform: isHovered ? `translate(${dx}px, ${dy}px)` : undefined }}
              onMouseEnter={() => setHovered(s.label)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => clickable && !s.isOther && onSliceClick(s)}
            >
              <path
                d={arcPath(CENTER, CENTER, RADIUS, s.startAngle, s.endAngle)}
                fill={s.color}
                stroke={STROKE_COLOR}
                strokeWidth="2"
                className={`pie-chart__path${isHovered ? ' pie-chart__path--hover' : ''}${
                  clickable && !s.isOther ? ' pie-chart__path--clickable' : ''
                }`}
              >
                <title>
                  {s.label}: {s.valueLabel} (%{s.pct})
                </title>
              </path>
              {s.pct >= LABEL_MIN_PCT && (
                <text x={labelPos.x} y={labelPos.y} textAnchor="middle" dominantBaseline="middle" className="pie-chart__slice-label">
                  %{s.pct}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <ul className="pie-chart__legend">
        {slices.map((s) => (
          <li
            key={s.label}
            className={clickable && !s.isOther ? 'pie-chart__legend-item--clickable' : undefined}
            onMouseEnter={() => setHovered(s.label)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => clickable && !s.isOther && onSliceClick(s)}
          >
            <span className="pie-chart__swatch" style={{ background: s.color }} />
            <span className="pie-chart__legend-label">{s.label}</span>
            <span className="pie-chart__legend-value">%{s.pct}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
