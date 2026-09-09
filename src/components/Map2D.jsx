import { useEffect, useMemo, useRef, useState } from 'react'
import { geoNaturalEarth1, geoPath } from 'd3-geo'
import { scoreToColor, proxyScoreToColor } from '../lib/scale.js'
import { fetchCountryGeoJSON, featureIso2, featureDisplayName } from '../lib/geo.js'
import { resolveIso2FromLabel } from '../lib/continents.js'
import turkishNames from '../data/country-centroids.json'

function displayName(feat) {
  return featureDisplayName(feat, turkishNames)
}

// Lowy Institute paleti: koyu mat lacivert taban (veri yoksa) — koyu okyanus zemininden
// (.map2d arka planı, bkz. styles.css) net ayrışsın diye hafifçe daha açık.
const NO_DATA_COLOR = '#131c31'
// Oyuncu veya dizi filtresi (highlightFilter) düz/tekli bir "bu ülkede yayında" işareti —
// palette'in zaten validated en canlı durağı, kıta vurgusuyla (STROKE_CONTINENT) aynı camgöbeği.
const HIGHLIGHT_FILTER_COLOR = '#22d3ee'
// TMDB/JustWatch'ta hiç sağlayıcı verisi olmayan, sadece Google Trends arama ilgisi TAHMİNİ
// (server/services/proxyScore.js) olan ülkeler — gerçek verinin camgöbeği skalasından KASITLI
// olarak ayrı bir renk ailesinde. Eskiden SABİT tek bir turuncuydu ve Afganistan'ın 100'ü ile
// Vietnam'ın 2'si aynı görünüyordu; artık arama hacmine göre dereceli (bkz. lib/scale.js
// proxyScoreToColor). Globe3D.jsx aynı fonksiyonu paylaşır.
const VIEWBOX_WIDTH = 960
const VIEWBOX_HEIGHT = 500
const DEFAULT_ZOOM = { scale: 1, tx: 0, ty: 0 }

// Lowy Institute tarzı düz/2D koroplet görünüm — Globe3D ile aynı GeoJSON'u ve
// aynı renk skalasını (scoreToColor) kullanır; tek fark projeksiyon (küre yerine düzlem).
// Sade tasarım: skor sadece dolgu rengiyle gösterilir, hover/seçim/oyuncu vurgusu
// (bkz. src/App.jsx actorHighlight) yalnızca kenar (stroke) rengiyle yapılır — ek bir
// nokta/pulse katmanı yok.
export default function Map2D({
  countries,
  onSelect,
  popup,
  focusTarget,
  actorHighlight,
  selectedIso2,
  seriesFilter,
  highlightFilter,
  continentHighlight,
  onResetView,
}) {
  const [geoFeatures, setGeoFeatures] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const containerRef = useRef(null)
  const svgRef = useRef(null)
  const zoomGroupRef = useRef(null)

  useEffect(() => {
    fetchCountryGeoJSON()
      .then(setGeoFeatures)
      .catch((err) => console.error('[Map2D] Ülke sınırı verisi alınamadı:', err.message))
  }, [])

  const byIso2 = useMemo(() => {
    if (!countries || countries.length === 0) return new Map()
    // Ölçek yalnızca gerçek TMDB verili ülkelerden hesaplanır — proxy ülkelerin sabit 0 skoru
    // dahil edilirse minScore her zaman 0'a çekilir ve gerçek ülkeler arası fark bozulur.
    const realScores = countries.filter((c) => c.dataSource !== 'proxy').map((c) => c.score)
    const minScore = realScores.length > 0 ? Math.min(...realScores) : 0
    const maxScore = realScores.length > 0 ? Math.max(...realScores) : 1
    const range = maxScore - minScore || 1
    const map = new Map()
    countries.forEach((c) => map.set(c.iso2, { ...c, t: (c.score - minScore) / range }))
    return map
  }, [countries])

  const { path, features, projection } = useMemo(() => {
    if (!geoFeatures) return { path: null, features: [], projection: null }
    const projection = geoNaturalEarth1().fitSize([VIEWBOX_WIDTH, VIEWBOX_HEIGHT], {
      type: 'FeatureCollection',
      features: geoFeatures,
    })
    return { path: geoPath(projection), features: geoFeatures, projection }
  }, [geoFeatures])

  // d3-geo'nun kendi flyTo'su yok — kıta odaklanması (bkz. src/App.jsx focusTarget state'i)
  // burada projeksiyon koordinatını viewBox merkezine taşıyan bir CSS transform (scale+
  // translate) olarak elle kuruluyor, .map2d__zoom-group'un transition'ı animasyonu sağlıyor.
  useEffect(() => {
    if (!focusTarget || !projection) return
    const [px, py] = projection([focusTarget.lng, focusTarget.lat])
    const scale = focusTarget.scale ?? 1.6
    setZoom({ scale, tx: VIEWBOX_WIDTH / 2 - px * scale, ty: VIEWBOX_HEIGHT / 2 - py * scale })
  }, [focusTarget, projection])

  const actorHighlightSet = useMemo(() => new Set((actorHighlight || []).map((h) => h.iso2)), [actorHighlight])

  // Madde 1 — dizi bazlı harita filtresi: gerçek, ülke bazlı Google Trends arama ilgisi
  // (0-100, bkz. src/App.jsx seriesFilter state'i) ile eşleştirilen ülkeler. Aggregate
  // `byIso2`'den bağımsız — filtre aktifken dolgu/tooltip bunu kullanır, ama tıklama
  // (onSelect) her zaman aggregate `byIso2`'yi kullanmaya devam eder (CountryPanel'in
  // ihtiyaç duyduğu tam ülke verisi sadece orada var).
  const seriesByIso2 = useMemo(() => {
    if (!seriesFilter) return null
    const map = new Map()
    for (const entry of seriesFilter.byCountry || []) {
      // Google Trends dünya genelinde ölçülebilir en ufak bir iz bırakan hemen her ülkeyi
      // döndürüyor (çoğu 0-1 arası) — bunları da gradyanın en koyu durağıyla boyamak haritayı
      // "gerçek ilgi olan yer" ile "hiç ilgi olmayan yer"i ayırt edilemez hâle getirip
      // bulanıklaştırıyordu. Gerçek bir ilgi ölçülmemiş (value<=0) ülkeler NO_DATA_COLOR'a
      // düşsün diye haritaya hiç eklenmiyor — kullanıcı geri bildirimi: "böyle hoş gözükmüyor".
      if (!entry.value || entry.value <= 0) continue
      const iso2 = resolveIso2FromLabel(entry.country)
      if (iso2) map.set(iso2, entry.value)
    }
    return map
  }, [seriesFilter])

  // Oyuncu/dizi bazlı harita filtresi (bkz. src/App.jsx highlightFilter) — bir skor
  // gradyanı değil, düz/tekli bir "bu ülkede yayında" işareti: kullanıcı sadece hangi
  // ülkelerin gerçekten yayında olduğunu görmek istedi, ülkeden ülkeye popülerlik
  // farkını değil.
  const highlightByIso2 = useMemo(() => {
    if (!highlightFilter) return null
    const entries = Array.from(highlightFilter.byIso2 instanceof Map ? highlightFilter.byIso2.entries() : [])
    const map = new Map()
    entries.forEach(([iso2, score]) => map.set(iso2, { score }))
    return map
  }, [highlightFilter])

  const handleMouseMove = (e) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  const handleResetView = () => {
    setZoom(DEFAULT_ZOOM)
    onResetView?.()
  }

  if (!path) {
    return <div className="status">Harita yükleniyor…</div>
  }

  return (
    <div className="map2d" ref={containerRef} onMouseMove={handleMouseMove}>
      <button className="globe__reset-btn" onClick={handleResetView}>
        🌐 Genel Görünüm
      </button>
      {/* Ülkeye tıklamak artık haritanın üzerinde bir bilgi kartı açmıyor — tüm detaylar
          sadece sağ çekmecede (CountryPanel.jsx) gösterilir; harita SADECE seçili ülkeyi
          kenar çizgisiyle (map2d__country--selected) işaretler. popup?.onClose burada hâlâ
          kullanılıyor: boş/deniz alanına tıklamak seçimi (ve çekmeceyi) kapatır — bu, App.jsx
          handleCloseSelection'a bağlı, görsel karta değil. */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        className="map2d__svg"
        onClick={() => popup?.onClose?.()}
      >
        <g
          ref={zoomGroupRef}
          className="map2d__zoom-group"
          style={{ transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})` }}
        >
          {features.map((f) => {
            const iso2 = featureIso2(f)
            const c = byIso2.get(iso2)
            const d = path(f)
            if (!d) return null
            const isHovered = hovered === f
            const isSelected = iso2 === selectedIso2
            const isHighlighted = actorHighlightSet.has(iso2)
            const isInContinent = continentHighlight?.has(iso2)
            // Öncelik sırası: oyuncu popülerlik ağı (altın) > seçili ülke (beyaz) > kıta
            // vurgusu (neon camgöbeği) > hover (beyaz) > varsayılan — çakışan stroke
            // renklerinin CSS kaskad sırasına göre değil, tek bir sınıfa göre belirlenmesi için.
            let variantClass = ''
            if (isHighlighted) variantClass = 'map2d__country--highlighted'
            else if (isSelected) variantClass = 'map2d__country--selected'
            else if (isInContinent) variantClass = 'map2d__country--continent'
            else if (isHovered) variantClass = 'map2d__country--hovered'
            const className = ['map2d__country', variantClass].filter(Boolean).join(' ')
            // Dolgu önceliği: oyuncu filtresi > dizi filtresi > genel görünürlük skoru —
            // App.jsx highlightFilter/seriesFilter'ı karşılıklı dışlayıcı tuttuğu için normalde
            // ikisi aynı anda dolu olmaz, ama öncelik sırası yine de tanımlı.
            const highlightEntry = highlightByIso2?.get(iso2)
            const seriesValue = seriesByIso2?.get(iso2)
            const fill = highlightByIso2
              ? highlightEntry
                ? HIGHLIGHT_FILTER_COLOR
                : NO_DATA_COLOR
              : seriesByIso2
                ? seriesValue != null
                  ? scoreToColor(seriesValue / 100)
                  : NO_DATA_COLOR
                : c
                  ? c.dataSource === 'proxy'
                    ? proxyScoreToColor((c.searchInterestScore ?? 0) / 100)
                    : scoreToColor(c.t)
                  : NO_DATA_COLOR
            return (
              <path
                key={iso2 || f.properties.ADM0_A3 || f.properties.NAME}
                d={d}
                fill={fill}
                className={className}
                onMouseEnter={() => setHovered(f)}
                onMouseLeave={() => setHovered(null)}
                onClick={(e) => {
                  // Ülkeye tıklama seçer — svg'nin arka plan tıklamasında pop-up'ı kapatan
                  // onClick'ine kadar kabarmasın (aksi halde seçildiği anda kapanırdı).
                  e.stopPropagation()
                  if (!c) return
                  onSelect?.({ ...c, name: displayName(f) })
                }}
              />
            )
          })}
        </g>
      </svg>
      {hovered && (
        <div className="map2d__tooltip" style={{ left: tooltipPos.x + 12, top: tooltipPos.y + 12 }}>
          {(() => {
            const name = displayName(hovered)
            const iso2 = featureIso2(hovered)
            if (highlightByIso2) {
              const entry = highlightByIso2.get(iso2)
              return (
                <>
                  <strong>{name}</strong>
                  <br />
                  {entry ? `Görünürlük skoru: ${entry.score.toFixed(1)}` : 'Veri yok'}
                </>
              )
            }
            if (seriesByIso2) {
              const value = seriesByIso2.get(iso2)
              return (
                <>
                  <strong>{name}</strong>
                  <br />
                  {value != null ? `Arama ilgisi: ${value}` : 'Veri yok'}
                </>
              )
            }
            const c = byIso2.get(iso2)
            if (!c) {
              return (
                <>
                  <strong>{name}</strong>
                  <br />
                  Veri yok
                </>
              )
            }
            if (c.dataSource === 'proxy') {
              return (
                <>
                  <strong>{name}</strong>
                  <br />
                  ⚡ Arama hacmi tahmini: {c.searchInterestScore} (yayın verisi yok)
                </>
              )
            }
            return (
              <>
                <strong>{name}</strong>
                <br />
                Görünürlük skoru: {c.score.toFixed(1)}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
