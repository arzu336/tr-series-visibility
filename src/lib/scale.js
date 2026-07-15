// ColorBrewer "YlOrRd" sıralı (sequential) paleti — düşük-yüksek skor için erişilebilir gradyan.
const STOPS = ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026']

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

export function scoreToColor(t) {
  const clamped = Math.max(0, Math.min(1, t))
  const scaled = clamped * (STOPS.length - 1)
  const idx = Math.min(STOPS.length - 2, Math.floor(scaled))
  const localT = scaled - idx
  const [r1, g1, b1] = hexToRgb(STOPS[idx])
  const [r2, g2, b2] = hexToRgb(STOPS[idx + 1])
  const r = Math.round(lerp(r1, r2, localT))
  const g = Math.round(lerp(g1, g2, localT))
  const b = Math.round(lerp(b1, b2, localT))
  return `rgb(${r}, ${g}, ${b})`
}

export const legendStops = STOPS
