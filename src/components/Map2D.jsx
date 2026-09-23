import { useEffect, useMemo, useRef, useState } from 'react'
import { geoNaturalEarth1, geoPath } from 'd3-geo'
import {
  scoreToColor,
  proxyScoreToColor,
  buildMapScale,
  SOURCE_COUNTRY_COLOR,
  SMALL_SAMPLE_COLOR,
  MAP_METRICS,
} from '../lib/scale.js'
import { fetchCountryGeoJSON, featureIso2, featureDisplayName } from '../lib/geo.js'
import { resolveIso2FromLabel } from '../lib/continents.js'
import turkishNames from '../data/country-centroids.json'

function displayName(feat) {
  return featureDisplayName(feat, turkishNames)
}

const NO_DATA_COLOR = '#131c31'
const HIGHLIGHT_FILTER_COLOR = '#22d3ee'
const VIEWBOX_WIDTH = 960
const VIEWBOX_HEIGHT = 500
const DEFAULT_ZOOM = { scale: 1, tx: 0, ty: 0 }

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
  metric = MAP_METRICS.PER_CAPITA,
}) {
  const [geoFeatures, setGeoFeatures] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const containerRef = useRef(null)
  const svgRef = useRef(null)
  const zoomGroupRef = useRef(null)
  // Tooltip konumu React state'i DEĞİL: her mouse hareketinde tüm haritayı (177 path) yeniden
  // render etmek yerine tooltip elemanının stili doğrudan güncellenir.
  const tooltipRef = useRef(null)
  const lastMouse = useRef({ x: 0, y: 0 })

  useEffect(() => {
    fetchCountryGeoJSON()
      .then(setGeoFeatures)
      .catch((err) => console.error('[Map2D] Ülke sınırı verisi alınamadı:', err.message))
  }, [])

  const byIso2 = useMemo(() => {
    if (!countries || countries.length === 0) return new Map()
    return buildMapScale(countries, metric).byIso2
  }, [countries, metric])

  // Projeksiyon ve her ülkenin SVG path dizgisi yalnızca GeoJSON değişince hesaplanır — bunlar
  // pahalı ve hover/zoom/seçimden bağımsız.
  const { projection, renderable } = useMemo(() => {
    if (!geoFeatures) return { projection: null, renderable: null }
    const projection = geoNaturalEarth1().fitSize([VIEWBOX_WIDTH, VIEWBOX_HEIGHT], {
      type: 'FeatureCollection',
      features: geoFeatures,
    })
    const path = geoPath(projection)
    const renderable = geoFeatures
      .map((f) => ({ feature: f, iso2: featureIso2(f), d: path(f), key: featureIso2(f) || f.properties.ADM0_A3 || f.properties.NAME }))
      .filter((r) => r.d)
    return { projection, renderable }
  }, [geoFeatures])

  useEffect(() => {
    if (!focusTarget || !projection) return
    const [px, py] = projection([focusTarget.lng, focusTarget.lat])
    const scale = focusTarget.scale ?? 1.6
    setZoom({ scale, tx: VIEWBOX_WIDTH / 2 - px * scale, ty: VIEWBOX_HEIGHT / 2 - py * scale })
  }, [focusTarget, projection])

  const actorHighlightSet = useMemo(() => new Set((actorHighlight || []).map((h) => h.iso2)), [actorHighlight])

  const seriesByIso2 = useMemo(() => {
    if (!seriesFilter) return null
    const map = new Map()
    for (const entry of seriesFilter.byCountry || []) {
      if (!entry.value || entry.value <= 0) continue
      const iso2 = resolveIso2FromLabel(entry.country)
      if (iso2) map.set(iso2, entry.value)
    }
    return map
  }, [seriesFilter])

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
    lastMouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    const el = tooltipRef.current
    if (el) {
      el.style.left = `${lastMouse.current.x + 12}px`
      el.style.top = `${lastMouse.current.y + 12}px`
    }
  }

  const handleResetView = () => {
    setZoom(DEFAULT_ZOOM)
    onResetView?.()
  }

  if (!renderable) {
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
          {renderable.map(({ feature: f, iso2, d, key }) => {
            const c = byIso2.get(iso2)
            const isHovered = hovered === f
            const isSelected = iso2 === selectedIso2
            const isHighlighted = actorHighlightSet.has(iso2)
            const isInContinent = continentHighlight?.has(iso2)
            let variantClass = ''
            if (isHighlighted) variantClass = 'map2d__country--highlighted'
            else if (isSelected) variantClass = 'map2d__country--selected'
            else if (isInContinent) variantClass = 'map2d__country--continent'
            else if (isHovered) variantClass = 'map2d__country--hovered'
            const className = ['map2d__country', variantClass].filter(Boolean).join(' ')
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
                  ? c.isSourceCountry
                    ? SOURCE_COUNTRY_COLOR
                    : c.dataSource === 'proxy'
                      ? proxyScoreToColor((c.searchInterestScore ?? 0) / 100)
                      : c.isSmallSample
                        ? SMALL_SAMPLE_COLOR
                        : c.t == null
                          ? NO_DATA_COLOR
                          : scoreToColor(c.t)
                  : NO_DATA_COLOR
            return (
              <path
                key={key}
                d={d}
                fill={fill}
                className={className}
                onMouseEnter={() => setHovered(f)}
                onMouseLeave={() => setHovered(null)}
                onClick={(e) => {
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
        <div ref={tooltipRef} className="map2d__tooltip" style={{ left: lastMouse.current.x + 12, top: lastMouse.current.y + 12 }}>
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
