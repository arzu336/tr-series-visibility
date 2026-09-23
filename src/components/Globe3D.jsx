import { useEffect, useRef, useState } from 'react'
import Globe from 'globe.gl'
import * as THREE from 'three'
import {
  scoreToColor,
  proxyScoreToColor,
  brightenRgb,
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

const MIN_ALTITUDE = 0.006
const MAX_ALTITUDE = 0.22
const NO_DATA_COLOR = '#131c31'
const HIGHLIGHT_FILTER_COLOR = '#22d3ee'
const DEFAULT_VIEW = { lat: 15, lng: 20, altitude: 2.4 }
const FOCUS_ALTITUDE = 1.8
const STROKE_DEFAULT = '#1e293b'
const STROKE_HOVER = 'rgba(255, 255, 255, 0.9)'
const STROKE_SELECTED = '#ffffff'
const STROKE_HIGHLIGHT = '#f0ad4e'
const STROKE_CONTINENT = '#22d3ee'

export default function Globe3D({
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
  const containerRef = useRef(null)
  const globeRef = useRef(null)
  const hoveredRef = useRef(null)
  const selectedIso2Ref = useRef(null)
  const actorHighlightRef = useRef(new Set())
  const continentHighlightRef = useRef(null)
  const popupRef = useRef(null)
  const [geoFeatures, setGeoFeatures] = useState(null)

  useEffect(() => {
    fetchCountryGeoJSON()
      .then(setGeoFeatures)
      .catch((err) => console.error('[Globe3D] Ülke sınırı verisi alınamadı:', err.message))
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const world = Globe()(containerRef.current)
      .globeImageUrl('/map/earth-night.jpg')
      .bumpImageUrl('/map/earth-topology.png')
      .backgroundImageUrl('/map/night-sky.png')
      .showAtmosphere(true)
      .atmosphereColor('#7fb6ff')
      .atmosphereAltitude(0.18)
      .polygonsTransitionDuration(300)
      .onPolygonHover((f) => {
        hoveredRef.current = f
      })
      .onGlobeClick(() => popupRef.current?.onClose?.())

    world.controls().autoRotate = true
    world.controls().autoRotateSpeed = 0.5
    world.controls().minDistance = 105
    world.pointOfView(DEFAULT_VIEW, 0)

    world.scene().add(new THREE.AmbientLight(0xffffff, 0.7))
    const sunLight = new THREE.DirectionalLight(0xffffff, 1)
    sunLight.position.set(1, 1, 1)
    world.scene().add(sunLight)

    const container = containerRef.current
    const pause = () => {
      world.controls().autoRotate = false
    }
    const resume = () => {
      world.controls().autoRotate = true
    }
    container.addEventListener('pointerenter', pause)
    container.addEventListener('pointerleave', resume)

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) {
        world.width(width).height(height)
      }
    })
    resizeObserver.observe(container)

    globeRef.current = world

    return () => {
      resizeObserver.disconnect()
      container.removeEventListener('pointerenter', pause)
      container.removeEventListener('pointerleave', resume)

      try {
        world._destructor?.()
        const renderer = world.renderer?.()
        if (renderer) {
          renderer.dispose()
          renderer.forceContextLoss?.()
        }
      } catch (err) {
        console.warn('[Globe3D] Küre yıkımı sırasında hata:', err?.message)
      }

      container.innerHTML = ''
      globeRef.current = null
    }
  }, [])

  useEffect(() => {
    selectedIso2Ref.current = selectedIso2 || null
  }, [selectedIso2])

  useEffect(() => {
    actorHighlightRef.current = new Set((actorHighlight || []).map((h) => h.iso2))
  }, [actorHighlight])

  useEffect(() => {
    continentHighlightRef.current = continentHighlight || null
  }, [continentHighlight])

  useEffect(() => {
    const world = globeRef.current
    if (!world || !geoFeatures || !countries || countries.length === 0) return

    const { byIso2 } = buildMapScale(countries, metric)

    const matched = geoFeatures.filter((f) => byIso2.has(featureIso2(f))).length
    if (matched === 0) {
      console.warn('[Globe3D] Hiçbir ülke sınırı verisiyle eşleşmedi (ISO_A2 kontrol edilmeli)')
    }

    const seriesByIso2 = seriesFilter
      ? new Map(
          (seriesFilter.byCountry || [])
            .filter((entry) => entry.value > 0)
            .map((entry) => [resolveIso2FromLabel(entry.country), entry.value])
            .filter(([iso2]) => iso2)
        )
      : null

    const highlightByIso2 = highlightFilter
      ? new Map(
          Array.from(highlightFilter.byIso2 instanceof Map ? highlightFilter.byIso2.entries() : []).map(([iso2, score]) => [
            iso2,
            { score },
          ])
        )
      : null

    world
      .polygonsData(geoFeatures)
      .polygonCapColor((f) => {
        const iso2 = featureIso2(f)
        if (highlightByIso2) {
          const entry = highlightByIso2.get(iso2)
          return entry ? HIGHLIGHT_FILTER_COLOR : NO_DATA_COLOR
        }
        if (seriesByIso2) {
          const value = seriesByIso2.get(iso2)
          return value != null ? scoreToColor(value / 100) : NO_DATA_COLOR
        }
        const c = byIso2.get(iso2)
        if (!c) return NO_DATA_COLOR
        const base = c.isSourceCountry
          ? SOURCE_COUNTRY_COLOR
          : c.dataSource === 'proxy'
            ? proxyScoreToColor((c.searchInterestScore ?? 0) / 100)
            : c.isSmallSample
              ? SMALL_SAMPLE_COLOR
              : c.t == null
                ? NO_DATA_COLOR
                : scoreToColor(c.t)
        return f === hoveredRef.current ? brightenRgb(base, 0.22) : base
      })
      .polygonSideColor(() => 'rgba(20, 24, 38, 0.35)')
      .polygonStrokeColor((f) => {
        const iso2 = featureIso2(f)
        if (actorHighlightRef.current.has(iso2)) return STROKE_HIGHLIGHT
        if (iso2 === selectedIso2Ref.current) return STROKE_SELECTED
        if (continentHighlightRef.current?.has(iso2)) return STROKE_CONTINENT
        if (f === hoveredRef.current) return STROKE_HOVER
        return STROKE_DEFAULT
      })
      .polygonAltitude((f) => {
        const c = byIso2.get(featureIso2(f))
        if (!c) return 0.003
        if (c.dataSource === 'proxy') return MIN_ALTITUDE
        if (c.t == null) return MIN_ALTITUDE
        return MIN_ALTITUDE + c.t * (MAX_ALTITUDE - MIN_ALTITUDE)
      })
      .polygonLabel((f) => {
        const name = displayName(f)
        const iso2 = featureIso2(f)
        if (highlightByIso2) {
          const entry = highlightByIso2.get(iso2)
          return `<div style="font: 13px system-ui; padding: 4px 2px;"><strong>${name}</strong><br/>${entry ? `Görünürlük skoru: ${entry.score.toFixed(1)}` : 'Veri yok'}</div>`
        }
        if (seriesByIso2) {
          const value = seriesByIso2.get(iso2)
          return `<div style="font: 13px system-ui; padding: 4px 2px;"><strong>${name}</strong><br/>${value != null ? `Arama ilgisi: ${value}` : 'Veri yok'}</div>`
        }
        const c = byIso2.get(iso2)
        if (!c) {
          return `<div style="font: 13px system-ui; padding: 4px 2px;"><strong>${name}</strong><br/>Veri yok</div>`
        }
        if (c.dataSource === 'proxy') {
          return `<div style="font: 13px system-ui; padding: 4px 2px;"><strong>${name}</strong><br/>⚡ Arama hacmi tahmini: ${c.searchInterestScore} (yayın verisi yok)</div>`
        }
        return `
          <div style="font: 13px system-ui; padding: 4px 2px;">
            <strong>${name}</strong><br/>
            Görünürlük skoru: ${c.score.toFixed(1)}
          </div>
        `
      })
      .onPolygonClick((f) => {
        const c = byIso2.get(featureIso2(f))
        if (!c) return
        const geo = turkishNames[featureIso2(f)]
        if (geo) {
          world.pointOfView({ lat: geo.lat, lng: geo.lng, altitude: FOCUS_ALTITUDE }, 1000)
        }
        onSelect?.({ ...c, name: displayName(f) })
      })
  }, [countries, geoFeatures, onSelect, actorHighlight, selectedIso2, seriesFilter, highlightFilter, continentHighlight, metric])

  useEffect(() => {
    popupRef.current = popup
  }, [popup])

  useEffect(() => {
    const world = globeRef.current
    if (!world || !focusTarget) return
    world.pointOfView({ lat: focusTarget.lat, lng: focusTarget.lng, altitude: focusTarget.altitude ?? FOCUS_ALTITUDE }, 1200)
  }, [focusTarget])

  const handleReset = () => {
    globeRef.current?.pointOfView(DEFAULT_VIEW, 800)
    onResetView?.()
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <button className="globe__reset-btn" onClick={handleReset}>
        🌐 Genel Görünüm
      </button>
    </div>
  )
}
