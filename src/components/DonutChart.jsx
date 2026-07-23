import { useId } from 'react'

const SIZE = 240
const CENTER = SIZE / 2
const R_OUTER = 104
const R_INNER = 68
const R_GUIDE_OUT = R_OUTER + 7
const R_GUIDE_IN = R_INNER - 7
const HOVER_LIFT = 7
const GAP_DEG = 1.1 // dilimler arası açısal boşluk (kenarlık yerine gerçek boşluk)
const OTHER_COLOR = '#4b5563'

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function ringSegmentPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
  const outerStart = polarToCartesian(cx, cy, rOuter, startAngle)
  const outerEnd = polarToCartesian(cx, cy, rOuter, endAngle)
  const innerStart = polarToCartesian(cx, cy, rInner, endAngle)
  const innerEnd = polarToCartesian(cx, cy, rInner, startAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
    'Z',
  ].join(' ')
}

// items: [{ id, label, value, valueLabel, pct, color, isOther? }]
// Hover durumu üst bileşende (ImpactReport) tutulur, böylece grafik ve yandaki
// sıralı liste aynı hoveredId'yi paylaşıp birbirine bağlı çalışır.
export default function DonutChart({
  items,
  hoveredId,
  onHoverChange,
  onSelect,
  centerPrimary,
  centerSecondary,
  centerTrend,
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const glowFilterId = `donut-glow-${uid}`

  const total = items.reduce((sum, i) => sum + i.value, 0)
  if (total <= 0) return null

  let angle = 0
  const slices = items.map((item) => {
    const startAngle = angle
    const fraction = item.value / total
    angle += fraction * 360
    const endAngle = angle
    return { ...item, startAngle, endAngle, mid: (startAngle + endAngle) / 2 }
  })

  const clickable = Boolean(onSelect)

  const handleSliceKeyDown = (event, slice) => {
    if (!clickable || slice.isOther) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(slice)
    }
  }

  return (
    <div
      className="donut"
      onMouseLeave={() => onHoverChange?.(null)}
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label="Parça-bütün dağılımı (donut grafik)">
        <defs>
          <filter id={glowFilterId} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="6" result="blur" />
          </filter>
        </defs>

        <circle cx={CENTER} cy={CENTER} r={R_GUIDE_OUT} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        <circle cx={CENTER} cy={CENTER} r={R_GUIDE_IN} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

        {slices.map((s) => {
          const span = s.endAngle - s.startAngle
          if (span <= 0) return null
          const inset = Math.min(GAP_DEG, span * 0.18)
          const a0 = s.startAngle + inset
          const a1 = s.endAngle - inset
          if (a1 <= a0) return null

          const isHovered = hoveredId === s.id
          const rad = ((s.mid - 90) * Math.PI) / 180
          const dx = Math.cos(rad) * HOVER_LIFT
          const dy = Math.sin(rad) * HOVER_LIFT
          const d = ringSegmentPath(CENTER, CENTER, R_OUTER, R_INNER, a0, a1)
          const fillOpacity = s.isOther ? 0.4 : isHovered ? 1 : 0.92

          return (
            <g
              key={s.id}
              className="donut__slice"
              style={{ transform: isHovered ? `translate(${dx}px, ${dy}px)` : undefined }}
              onMouseEnter={() => onHoverChange?.(s.id)}
              onFocus={() => onHoverChange?.(s.id)}
              onClick={() => clickable && !s.isOther && onSelect(s)}
              onKeyDown={(event) => handleSliceKeyDown(event, s)}
              tabIndex={clickable && !s.isOther ? 0 : undefined}
              role={clickable && !s.isOther ? 'button' : undefined}
            >
              {isHovered && !s.isOther && (
                <path
                  d={d}
                  fill={s.color}
                  opacity="0.75"
                  filter={`url(#${glowFilterId})`}
                  className="donut__glow"
                />
              )}
              <path
                d={d}
                fill={s.isOther ? OTHER_COLOR : s.color}
                fillOpacity={fillOpacity}
                className={`donut__path${clickable && !s.isOther ? ' donut__path--clickable' : ''}`}
              >
                <title>
                  {s.valueLabel} (%{s.pct}) — {s.label}
                </title>
              </path>
            </g>
          )
        })}

        <g pointerEvents="none">
          <text x={CENTER} y={CENTER - 14} textAnchor="middle" className="donut__center-primary">
            {centerPrimary}
          </text>
          <text x={CENTER} y={CENTER + 10} textAnchor="middle" className="donut__center-secondary">
            {centerSecondary}
          </text>
          {centerTrend && (
            <text
              x={CENTER}
              y={CENTER + 30}
              textAnchor="middle"
              className={`donut__center-trend trend--${centerTrend.tone}`}
            >
              {centerTrend.icon} {centerTrend.text}
            </text>
          )}
        </g>
      </svg>
    </div>
  )
}
