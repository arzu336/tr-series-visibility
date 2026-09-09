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

// --- Tahmin (proxy) katmanı için AYRI sıralı palet -------------------------------------------
// Sorun: proxy ülkeler tek bir sabit turuncuyla (#b45309) boyanıyordu, yani Afganistan'ın 100'ü
// ile Vietnam'ın 2'si BİREBİR aynı rengi alıyordu — renk büyüklük hakkında hiçbir şey söylemiyor,
// ayrıca doygun turuncu koyu zeminde camgöbeği skalasından çok daha fazla göze çarptığı için
// haritanın en yüksek sesle konuşan rengi EN ZAYIF kanıta ait oluyordu (görsel hiyerarşi ters).
//
// Çözüm: aynı renk ailesinde kalan (yani "bu bir tahmin" mesajı korunan) ama arama hacmine göre
// DERECELİ bir rampa. Koyu zeminde yön bilinçli olarak sönük→parlak: karanlık bir zeminde daha
// koyu bir ton geriye çekilir ve "veri yok" gibi okunur, o yüzden düşük değer sönük, yüksek değer
// parlak. Böylece 17 proxy ülkenin çoğu bugünden daha sessiz kalır, yalnızca gerçekten güçlü
// sinyaller öne çıkar.
//
// dataviz skill'in validate_palette.js'i ile doğrulandı (--ordinal --mode dark --surface #0a0f1d):
// lightness monotone, komşu adımların tamamı ΔL ≥ 0.06, tek hue (yayılım 1°) ve en sönük durak
// zeminden ayrışıyor (2.30:1 — ilk denediğim daha koyu rampa 1.88:1 ile BURADA ELENDİ, çünkü
// zeminle karışıp "veri yok" ile ayırt edilemez hâle geliyordu).
const PROXY_STOPS = ['#6e4514', '#8a5511', '#a6660d', '#c2780b']

/** t: 0-1 arası normalize edilmiş arama hacmi (searchInterestScore / 100). */
export function proxyScoreToColor(t) {
  const clamped = Math.max(0, Math.min(1, t))
  const scaled = clamped * (PROXY_STOPS.length - 1)
  const idx = Math.min(PROXY_STOPS.length - 2, Math.floor(scaled))
  const localT = scaled - idx
  const [r1, g1, b1] = hexToRgb(PROXY_STOPS[idx])
  const [r2, g2, b2] = hexToRgb(PROXY_STOPS[idx + 1])
  return `rgb(${Math.round(lerp(r1, r2, localT))}, ${Math.round(lerp(g1, g2, localT))}, ${Math.round(lerp(b1, b2, localT))})`
}

export const proxyLegendStops = PROXY_STOPS

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
