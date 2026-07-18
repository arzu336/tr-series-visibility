const WIDTH = 160
const HEIGHT = 40
const PAD = 4

export default function Sparkline({ history }) {
  if (!history || history.length < 2) {
    return <p className="sparkline__empty">Geçmiş birikiyor — birkaç gün sonra burada bir eğri görünecek.</p>
  }

  const scores = history.map((h) => h.score)
  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const range = max - min || 1

  const points = history.map((h, i) => {
    const x = PAD + (i / (history.length - 1)) * (WIDTH - PAD * 2)
    const y = HEIGHT - PAD - ((h.score - min) / range) * (HEIGHT - PAD * 2)
    return [x, y]
  })

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lastX, lastY] = points[points.length - 1]
  const rising = scores[scores.length - 1] >= scores[0]

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label="Görünürlük skoru geçmişi"
    >
      <path d={path} fill="none" stroke={rising ? '#5cb85c' : '#f0574a'} strokeWidth="1.75" />
      <circle cx={lastX} cy={lastY} r="2.2" fill={rising ? '#5cb85c' : '#f0574a'} />
    </svg>
  )
}
