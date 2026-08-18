import { useState } from 'react'

const WIDTH = 480
const HEIGHT = 160
const PAD_X = 28
const PAD_TOP = 16
const PAD_BOTTOM = 28
const LINE_COLOR = '#22d3ee'
const AREA_COLOR = 'rgba(34, 211, 238, 0.14)'

const MONTH_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

function formatPeriodLabel(period, range) {
  if (range === 'yearly') return period
  const [year, month] = period.split('-')
  const idx = Number(month) - 1
  return `${MONTH_SHORT[idx] || month} ${year.slice(2)}`
}

// Ay/Yıl periyodu grafiği — server/period-history.js'in ürettiği kronolojik seriyi çizer.
// dataviz skill'in "trend over time → line" kuralına göre: tek seri, tek hue, kronolojik sıra
// (değere göre sıralanmış bir bar listesi DEĞİL — bkz. app'teki diğer sıralı .benchmark-card
// listeleri, onlar rank gösteriyor, bu zaman gösteriyor). Hover'da crosshair + tooltip;
// isCurrent/isPartial periyotlar dürüstçe "devam ediyor" / "kısmi" etiketiyle işaretlenir.
export default function PeriodChart({ periods, valueKey, range, onRangeChange, unitLabel = '' }) {
  const [hoverIdx, setHoverIdx] = useState(null)

  if (!periods || periods.length === 0) {
    return (
      <div>
        <RangeToggle range={range} onRangeChange={onRangeChange} />
        <p className="dashboard__empty">Veri birikiyor — henüz bir periyot tamamlanmadı.</p>
      </div>
    )
  }

  if (periods.length < 2) {
    return (
      <div>
        <RangeToggle range={range} onRangeChange={onRangeChange} />
        <p className="dashboard__empty">
          Yetersiz veri — bir eğilim gösterebilmek için en az iki periyot gerekiyor, şu an {periods.length} var.
        </p>
      </div>
    )
  }

  const values = periods.map((p) => p[valueKey])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range_ = max - min || 1
  const innerWidth = WIDTH - PAD_X * 2
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM

  const points = periods.map((p, i) => {
    const x = PAD_X + (periods.length === 1 ? innerWidth / 2 : (i / (periods.length - 1)) * innerWidth)
    const y = PAD_TOP + innerHeight - ((p[valueKey] - min) / range_) * innerHeight
    return { x, y, period: p }
  })

  const linePath = points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${HEIGHT - PAD_BOTTOM} L${points[0].x.toFixed(1)},${HEIGHT - PAD_BOTTOM} Z`

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
      <RangeToggle range={range} onRangeChange={onRangeChange} />
      <svg
        className="period-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Periyoda göre görünürlük eğilimi"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <path d={areaPath} fill={AREA_COLOR} stroke="none" />
        <path d={linePath} fill="none" stroke={LINE_COLOR} strokeWidth="2" />
        {points.map((pt, i) => (
          <circle
            key={pt.period.period}
            cx={pt.x}
            cy={pt.y}
            r={i === points.length - 1 ? 4 : 2.5}
            fill={LINE_COLOR}
          />
        ))}
        {points.map((pt, i) =>
          i % Math.ceil(points.length / 8) === 0 || i === points.length - 1 ? (
            <text
              key={`label-${pt.period.period}`}
              x={pt.x}
              y={HEIGHT - 8}
              textAnchor="middle"
              className="period-chart__axis-label"
            >
              {formatPeriodLabel(pt.period.period, range)}
            </text>
          ) : null
        )}
        {hovered && (
          <line
            x1={hovered.x}
            x2={hovered.x}
            y1={PAD_TOP}
            y2={HEIGHT - PAD_BOTTOM}
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="1"
          />
        )}
      </svg>
      {hovered && (
        <div className="period-chart__tooltip">
          <strong>{formatPeriodLabel(hovered.period.period, range)}</strong>
          {hovered.period.isCurrent && <span className="period-chart__tooltip-tag"> · devam ediyor</span>}
          {hovered.period.isPartial && (
            <span className="period-chart__tooltip-tag"> · kısmi ({hovered.period.monthsCovered} ay)</span>
          )}
          <br />
          {hovered.period[valueKey].toLocaleString('tr-TR')} {unitLabel}
        </div>
      )}
    </div>
  )
}

function RangeToggle({ range, onRangeChange }) {
  if (!onRangeChange) return null
  return (
    <div className="period-toggle" role="group" aria-label="Periyot aralığı">
      <button
        className={range === 'monthly' ? 'period-toggle__btn period-toggle__btn--active' : 'period-toggle__btn'}
        onClick={() => onRangeChange('monthly')}
      >
        Aylık
      </button>
      <button
        className={range === 'yearly' ? 'period-toggle__btn period-toggle__btn--active' : 'period-toggle__btn'}
        onClick={() => onRangeChange('yearly')}
      >
        Yıllık
      </button>
    </div>
  )
}
