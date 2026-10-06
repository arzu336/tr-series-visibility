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

export function brightenRgb(rgbString, amount = 0.25) {
  const match = rgbString.match(/\d+/g)
  if (!match) return rgbString
  const [r, g, b] = match.map(Number)
  const lift = (channel) => Math.round(lerp(channel, 255, amount))
  return `rgb(${lift(r)}, ${lift(g)}, ${lift(b)})`
}

export const SOURCE_COUNTRY_ISO2 = 'TR'

export const SOURCE_COUNTRY_COLOR = '#7c5cbf'

export const SMALL_SAMPLE_COLOR = '#3d4c66'

export const MAP_METRICS = {
  PER_CAPITA: 'perCapita',
  TOTAL: 'total',
}

export function metricValueOf(country, metric) {
  return metric === MAP_METRICS.TOTAL ? country.score : country.scorePerCapita
}

/** sorted içinde v'den KESİNLİKLE küçük eleman sayısı. */
function countLess(sorted, v) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** sorted içinde v'den küçük VEYA eşit eleman sayısı. */
function countLessOrEqual(sorted, v) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] <= v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Ülke listesinden yüzdelik dilim ölçeği kurar.
 *
 * Ölçek alanına yalnızca GERÇEK veri girer: proxy ülkeler (skorları sabit 0) ve kaynak ülke
 * dışarıda kalır. Değeri olmayan ülke (ör. kişi başına metrikte demografi verisi bulunmayan
 * 9 ülke) için `toT` NULL döner — çağıran onu "veri yok" olarak çizer, 0 gibi değil.
 *
 * @returns {{ toT: (value:number|null)=>number|null, size: number, min: number|null, max: number|null }}
 */
export function buildPercentileScale(values) {
  const sorted = values.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b)
  const n = sorted.length

  const toT = (value) => {
    if (value == null || !Number.isFinite(value) || n === 0) return null
    if (n === 1) return 1
    const less = countLess(sorted, value)
    const equal = countLessOrEqual(sorted, value) - less
    const midRank = equal > 0 ? less + (equal - 1) / 2 : less - 0.5
    return Math.max(0, Math.min(1, midRank / (n - 1)))
  }

  return { toT, size: n, min: n > 0 ? sorted[0] : null, max: n > 0 ? sorted[n - 1] : null }
}

/**
 * Harita bileşenlerinin tek giriş noktası. Ülke listesini alır, her ülke için 0-1 arası `t`
 * (veya veri yoksa null) taşıyan bir Map döndürür.
 */
export function buildMapScale(countries, metric = MAP_METRICS.PER_CAPITA) {
  const perCapita = metric === MAP_METRICS.PER_CAPITA
  const inDomain = (c) =>
    c.dataSource !== 'proxy' && c.iso2 !== SOURCE_COUNTRY_ISO2 && !(perCapita && c.perCapitaReliable === false)

  const scale = buildPercentileScale((countries || []).filter(inDomain).map((c) => metricValueOf(c, metric)))

  const byIso2 = new Map()
  for (const c of countries || []) {
    const isSource = c.iso2 === SOURCE_COUNTRY_ISO2
    const isSmallSample = perCapita && !isSource && c.perCapitaReliable === false
    byIso2.set(c.iso2, {
      ...c,
      t: isSource || isSmallSample ? null : scale.toT(metricValueOf(c, metric)),
      isSourceCountry: isSource,
      isSmallSample,
    })
  }

  return { byIso2, scale }
}

// ---------------------------------------------------------------------------------------------
// İzlenme düzeyi haritası (varsayılan renk). Ülke rengi watchSignal.level'dan gelir: beş seviye
// (yüzdelik beşlikleri), sinyal yetersiz olan ülke ayrı gri, kaynak ülke ölçek dışı mor.
export const WATCH_LEVELS = ['Çok düşük', 'Düşük', 'Orta', 'Yüksek', 'Çok yüksek']
export const WATCH_LEVEL_COLORS = {
  'Çok düşük': STOPS[0],
  Düşük: STOPS[1],
  Orta: STOPS[2],
  Yüksek: STOPS[3],
  'Çok yüksek': STOPS[4],
}
export const NO_SIGNAL_COLOR = '#131c31'

export function watchLevelColor(level) {
  return WATCH_LEVEL_COLORS[level] ?? NO_SIGNAL_COLOR
}

/** Tek kaynağa dayalı tahmin: düzey rengi gri zemine doğru soldurulur (2D haritada üstüne tarama da çizilir). */
export function provisionalColor(level) {
  const [r1, g1, b1] = hexToRgb(WATCH_LEVEL_COLORS[level] ?? NO_SIGNAL_COLOR)
  const [r2, g2, b2] = hexToRgb(NO_SIGNAL_COLOR)
  const t = 0.55
  return `rgb(${Math.round(lerp(r1, r2, t))}, ${Math.round(lerp(g1, g2, t))}, ${Math.round(lerp(b1, b2, t))})`
}

export const SOURCE_LABELS = {
  netflix: 'Netflix Top 10',
  wiki: 'ansiklopedi okunması',
  search: 'arama ilgisi',
  press: 'basın',
}

/** İpucu satırı: gerçek düzey, tek kaynağa dayalı tahmin ya da sinyal yetersiz. */
export function watchLevelText(w) {
  if (w?.level) return `İzlenme düzeyi: ${w.level}`
  if (w?.provisional)
    return `Tahmini düzey: ${w.provisional.level} (yalnızca ${SOURCE_LABELS[w.provisional.source] ?? w.provisional.source})`
  return 'İzlenme düzeyi: sinyal yetersiz'
}

/**
 * Harita bileşenlerinin giriş noktası: ülke → { color, level, index, isSourceCountry, hasSignal }.
 * Sinyali olmayan ülke gri kalır (0 değil "yok"); proxy (yayın verisi olmayan) ülkeler de sinyalleri
 * varsa seviyelerine göre boyanır — etiket "yayın verisi yok" panelde yazılır.
 */
export function buildWatchMap(countries) {
  const byIso2 = new Map()
  for (const c of countries || []) {
    const isSource = c.iso2 === SOURCE_COUNTRY_ISO2
    const level = c.watchSignal?.level ?? null
    const provisional = level == null ? (c.watchSignal?.provisional ?? null) : null
    byIso2.set(c.iso2, {
      ...c,
      isSourceCountry: isSource,
      level,
      index: c.watchSignal?.index ?? null,
      hasSignal: level != null,
      provisionalLevel: provisional?.level ?? null,
      color: isSource
        ? SOURCE_COUNTRY_COLOR
        : provisional
          ? provisionalColor(provisional.level)
          : watchLevelColor(level),
    })
  }
  return { byIso2 }
}
