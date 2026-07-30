import { useEffect, useMemo, useRef, useState } from 'react'
import { geoNaturalEarth1, geoPath } from 'd3-geo'
import { scoreToColor } from '../lib/scale.js'
import { fetchCountryGeoJSON } from '../lib/geo.js'
import { resolveIso2FromLabel } from '../lib/continents.js'
import turkishNames from '../data/country-centroids.json'
import MapPopupCard from './MapPopupCard.jsx'

function displayName(feat) {
  return turkishNames[feat.properties.ISO_A2]?.name || feat.properties.NAME
}

// Lowy Institute paleti: koyu mat lacivert taban (veri yoksa) — koyu okyanus zemininden
// (.map2d arka planı, bkz. styles.css) net ayrışsın diye hafifçe daha açık.
const NO_DATA_COLOR = '#131c31'
const VIEWBOX_WIDTH = 960
const VIEWBOX_HEIGHT = 500
// Glassmorphism kartın kapanık (kadro listesi açılmamış) haldeki yaklaşık boyutu — kutu
// buna göre konumlanır. Kadro açılınca içerik bunun ALTINA doğru taşar; foreignObject
// overflow:visible olduğu için kırpılmaz, sadece kutunun altına doğru büyür.
const POPUP_WIDTH = 250
const POPUP_HEIGHT = 175
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
  continentHighlight,
  onResetView,
}) {
  const [geoFeatures, setGeoFeatures] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const containerRef = useRef(null)

  useEffect(() => {
    fetchCountryGeoJSON()
      .then(setGeoFeatures)
      .catch((err) => console.error('[Map2D] Ülke sınırı verisi alınamadı:', err.message))
  }, [])

  const byIso2 = useMemo(() => {
    if (!countries || countries.length === 0) return new Map()
    const scores = countries.map((c) => c.score)
    const minScore = Math.min(...scores)
    const maxScore = Math.max(...scores)
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
      const iso2 = resolveIso2FromLabel(entry.country)
      if (iso2) map.set(iso2, entry.value)
    }
    return map
  }, [seriesFilter])

  const popupPos =
    popup && projection && popup.lat != null && popup.lng != null ? projection([popup.lng, popup.lat]) : null

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
      <svg viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} className="map2d__svg">
        <g
          className="map2d__zoom-group"
          style={{ transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})` }}
        >
          {features.map((f) => {
            const iso2 = f.properties.ISO_A2
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
            const seriesValue = seriesByIso2?.get(iso2)
            const fill = seriesByIso2
              ? seriesValue != null
                ? scoreToColor(seriesValue / 100)
                : NO_DATA_COLOR
              : c
                ? scoreToColor(c.t)
                : NO_DATA_COLOR
            return (
              <path
                key={iso2 || f.properties.NAME}
                d={d}
                fill={fill}
                className={className}
                onMouseEnter={() => setHovered(f)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  if (!c) return
                  onSelect?.({ ...c, name: displayName(f) })
                }}
              />
            )
          })}

          {popupPos && (
            <foreignObject
              x={popupPos[0] - POPUP_WIDTH / 2}
              y={popupPos[1] - POPUP_HEIGHT - 14}
              width={POPUP_WIDTH}
              height={POPUP_HEIGHT}
              style={{ overflow: 'visible' }}
            >
              <div xmlns="http://www.w3.org/1999/xhtml">
                <MapPopupCard popup={popup} />
              </div>
            </foreignObject>
          )}
        </g>
      </svg>
      {hovered && (
        <div className="map2d__tooltip" style={{ left: tooltipPos.x + 12, top: tooltipPos.y + 12 }}>
          {(() => {
            const name = displayName(hovered)
            const iso2 = hovered.properties.ISO_A2
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
