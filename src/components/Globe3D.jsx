import { useEffect, useRef, useState } from 'react'
import Globe from 'globe.gl'
import * as THREE from 'three'
import { scoreToColor } from '../lib/scale.js'
import turkishNames from '../data/country-centroids.json'

function displayName(feat) {
  return turkishNames[feat.properties.ISO_A2]?.name || feat.properties.NAME
}

const COUNTRIES_GEOJSON_URL =
  'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson'

const MIN_ALTITUDE = 0.006
const MAX_ALTITUDE = 0.22
const NO_DATA_COLOR = 'rgba(60, 68, 88, 0.55)'
const DEFAULT_VIEW = { lat: 15, lng: 20, altitude: 2.4 }
const FOCUS_ALTITUDE = 0.5

export default function Globe3D({ countries, onSelect }) {
  const containerRef = useRef(null)
  const globeRef = useRef(null)
  const [geoFeatures, setGeoFeatures] = useState(null)

  useEffect(() => {
    fetch(COUNTRIES_GEOJSON_URL)
      .then((res) => res.json())
      .then((data) => setGeoFeatures(data.features))
      .catch((err) => console.error('[Globe3D] Ülke sınırı verisi alınamadı:', err.message))
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const world = Globe()(containerRef.current)
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-night.jpg')
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
      .showAtmosphere(true)
      .atmosphereColor('#7fb6ff')
      .atmosphereAltitude(0.18)
      .polygonsTransitionDuration(300)

    world.controls().autoRotate = true
    world.controls().autoRotateSpeed = 0.5
    world.controls().minDistance = 105
    world.pointOfView(DEFAULT_VIEW, 0)

    // Ülke kabartmalarına gerçek gölgelendirme/derinlik kazandırmak için ışık ekle
    // (ışık olmadan düz/2D görünür).
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

    globeRef.current = world

    return () => {
      container.removeEventListener('pointerenter', pause)
      container.removeEventListener('pointerleave', resume)
      container.innerHTML = ''
      globeRef.current = null
    }
  }, [])

  useEffect(() => {
    const world = globeRef.current
    if (!world || !geoFeatures || !countries || countries.length === 0) return

    const scores = countries.map((c) => c.score)
    const minScore = Math.min(...scores)
    const maxScore = Math.max(...scores)
    const range = maxScore - minScore || 1

    const byIso2 = new Map()
    countries.forEach((c) => {
      const t = (c.score - minScore) / range
      byIso2.set(c.iso2, { ...c, t })
    })

    const matched = geoFeatures.filter((f) => byIso2.has(f.properties.ISO_A2)).length
    if (matched === 0) {
      console.warn('[Globe3D] Hiçbir ülke sınırı verisiyle eşleşmedi (ISO_A2 kontrol edilmeli)')
    }

    world
      .polygonsData(geoFeatures)
      .polygonCapColor((f) => {
        const c = byIso2.get(f.properties.ISO_A2)
        return c ? scoreToColor(c.t) : NO_DATA_COLOR
      })
      .polygonSideColor(() => 'rgba(20, 24, 38, 0.35)')
      .polygonStrokeColor(() => 'rgba(10, 14, 24, 0.6)')
      .polygonAltitude((f) => {
        const c = byIso2.get(f.properties.ISO_A2)
        return c ? MIN_ALTITUDE + c.t * (MAX_ALTITUDE - MIN_ALTITUDE) : 0.003
      })
      .polygonLabel((f) => {
        const c = byIso2.get(f.properties.ISO_A2)
        const name = displayName(f)
        if (!c) {
          return `<div style="font: 13px system-ui; padding: 4px 2px;"><strong>${name}</strong><br/>Veri yok</div>`
        }
        return `
          <div style="font: 13px system-ui; padding: 4px 2px;">
            <strong>${name}</strong><br/>
            Görünürlük skoru: ${c.score.toFixed(1)}<br/>
            En popüler dizi: ${c.topSeries ? c.topSeries.name : '—'}
          </div>
        `
      })
      .onPolygonClick((f) => {
        const c = byIso2.get(f.properties.ISO_A2)
        if (!c) return
        const geo = turkishNames[f.properties.ISO_A2]
        if (geo) {
          world.pointOfView({ lat: geo.lat, lng: geo.lng, altitude: FOCUS_ALTITUDE }, 1000)
        }
        onSelect?.({ ...c, name: displayName(f) })
      })
  }, [countries, geoFeatures, onSelect])

  const handleReset = () => {
    globeRef.current?.pointOfView(DEFAULT_VIEW, 800)
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <button className="globe__reset-btn" onClick={handleReset}>
        Genel Görünüm
      </button>
    </div>
  )
}
