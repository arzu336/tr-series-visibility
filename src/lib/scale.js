// Lowy Institute tarzı tek-tonlu (tek hue) camgöbeği/turkuaz sıralı (sequential) palet —
// koyu lacivert harita zemininde düşükten yükseğe okunaklı bir gradyan. dataviz skill'in
// validate_palette.js'i ile doğrulandı (--ordinal --mode dark --surface #0a0f1d): lightness
// monotone, tek hue (yayılım 18°), karanlık zeminde düşük uç için yeterli kontrast (3.57:1).
// Kullanıcının istediği #06b6d4/#22d3ee/#a5f3fc aynen korundu; sadece düşük uç (#1e3a8a,
// mavi tonu farklı bir hue idi ve zeminle yeterince kontrast etmiyordu) aynı camgöbeği
// ailesinden iki durakla (#0e7490, #0891b2) değiştirildi.
const STOPS = ['#0e7490', '#0891b2', '#06b6d4', '#22d3ee', '#a5f3fc']

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

// Globe3D (WebGL) hover'da CSS filter kullanamıyor — "hafif parlama" efektini burada,
// rengi beyaza doğru hafifçe iten bir lerp ile üretiyoruz. Map2D bunun yerine CSS
// `filter: brightness()` kullanıyor (bkz. styles.css .map2d__country--hovered).
export function brightenRgb(rgbString, amount = 0.25) {
  const match = rgbString.match(/\d+/g)
  if (!match) return rgbString
  const [r, g, b] = match.map(Number)
  const lift = (channel) => Math.round(lerp(channel, 255, amount))
  return `rgb(${lift(r)}, ${lift(g)}, ${lift(b)})`
}
