const WIDTH = 320
const HEIGHT = 220
const PAD_L = 34
const PAD_B = 26
const PAD_T = 14
const PAD_R = 14

function niceDomain(values) {
  const min = Math.min(0, ...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return [min - span * 0.12, max + span * 0.12]
}

export default function ScatterChart({ data, xLabel, yLabel, accentColor = '#f03b20' }) {
  const xs = data.map((d) => d.x)
  const ys = data.map((d) => d.y)
  const [xMin, xMax] = niceDomain(xs)
  const [yMin, yMax] = niceDomain(ys)

  const plotW = WIDTH - PAD_L - PAD_R
  const plotH = HEIGHT - PAD_T - PAD_B

  const scaleX = (v) => PAD_L + ((v - xMin) / (xMax - xMin)) * plotW
  const scaleY = (v) => PAD_T + plotH - ((v - yMin) / (yMax - yMin)) * plotH

  const xTicks = [xMin, (xMin + xMax) / 2, xMax]
  const yTicks = [yMin, (yMin + yMax) / 2, yMax]

  const showZeroX = xMin < 0 && xMax > 0
  const showZeroY = yMin < 0 && yMax > 0

  return (
    <svg
      className="scatter-chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      role="img"
      aria-label={`${yLabel} ile ${xLabel} arasındaki ilişkiyi gösteren serpme grafik`}
    >
      {/* gridlines */}
      {yTicks.map((t) => (
        <line
          key={`gy-${t}`}
          x1={PAD_L}
          x2={WIDTH - PAD_R}
          y1={scaleY(t)}
          y2={scaleY(t)}
          className="scatter-chart__grid"
        />
      ))}

      {/* zero reference lines, if in range */}
      {showZeroX && <line x1={scaleX(0)} x2={scaleX(0)} y1={PAD_T} y2={PAD_T + plotH} className="scatter-chart__zero" />}
      {showZeroY && <line x1={PAD_L} x2={WIDTH - PAD_R} y1={scaleY(0)} y2={scaleY(0)} className="scatter-chart__zero" />}

      {/* axis labels (ticks) */}
      {xTicks.map((t) => (
        <text key={`xt-${t}`} x={scaleX(t)} y={HEIGHT - PAD_B + 15} className="scatter-chart__tick" textAnchor="middle">
          {t > 0 ? '+' : ''}
          {t.toFixed(0)}%
        </text>
      ))}
      {yTicks.map((t) => (
        <text key={`yt-${t}`} x={PAD_L - 6} y={scaleY(t) + 3} className="scatter-chart__tick" textAnchor="end">
          {t > 0 ? '+' : ''}
          {t.toFixed(0)}%
        </text>
      ))}

      {/* axis titles */}
      <text x={PAD_L + plotW / 2} y={HEIGHT - 2} className="scatter-chart__axis-title" textAnchor="middle">
        {xLabel}
      </text>
      <text
        x={-(PAD_T + plotH / 2)}
        y={11}
        className="scatter-chart__axis-title"
        textAnchor="middle"
        transform="rotate(-90)"
      >
        {yLabel}
      </text>

      {/* points */}
      {data.map((d) => (
        <g key={d.label}>
          <circle
            cx={scaleX(d.x)}
            cy={scaleY(d.y)}
            r="5"
            fill={accentColor}
            stroke="#0a0e18"
            strokeWidth="1.5"
          >
            <title>
              {d.label}: {yLabel} {d.y > 0 ? '+' : ''}
              {d.y}%, {xLabel} {d.x > 0 ? '+' : ''}
              {d.x}%
            </title>
          </circle>
          {(() => {
            const px = scaleX(d.x)
            const nearRightEdge = px > WIDTH - PAD_R - 60
            return (
              <text
                x={nearRightEdge ? px - 8 : px + 8}
                y={scaleY(d.y) + 3}
                textAnchor={nearRightEdge ? 'end' : 'start'}
                className="scatter-chart__label"
              >
                {d.label}
              </text>
            )
          })()}
        </g>
      ))}
    </svg>
  )
}
