import { useEffect, useRef } from 'react'
import Globe from 'globe.gl'
import * as THREE from 'three'
import centroids from '../data/country-centroids.json'
import { scoreToColor } from '../lib/scale.js'

const MIN_HEIGHT = 2
const MAX_HEIGHT = 32
const BAR_RADIUS = 0.55

export default function Globe3D({ countries, onSelect }) {
  const containerRef = useRef(null)
  const globeRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return
    const world = Globe()(containerRef.current)
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-night.jpg')
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
      .showAtmosphere(true)
      .atmosphereColor('#7fb6ff')
      .atmosphereAltitude(0.18)

    world.controls().autoRotate = true
    world.controls().autoRotateSpeed = 0.5

    globeRef.current = world

    return () => {
      const container = containerRef.current
      if (container) container.innerHTML = ''
      globeRef.current = null
    }
  }, [])

  useEffect(() => {
    const world = globeRef.current
    if (!world || !countries || countries.length === 0) return

    const scores = countries.map((c) => c.score)
    const minScore = Math.min(...scores)
    const maxScore = Math.max(...scores)
    const range = maxScore - minScore || 1

    const missing = []
    const objectsData = countries
      .map((c) => {
        const geo = centroids[c.iso2]
        if (!geo) {
          missing.push(c.iso2)
          return null
        }
        const t = (c.score - minScore) / range
        return { ...c, name: geo.name, lat: geo.lat, lng: geo.lng, t }
      })
      .filter(Boolean)

    if (missing.length > 0) {
      console.warn('[Globe3D] Centroid verisi bulunamayan ülke kodları:', missing.join(', '))
    }

    world
      .objectsData(objectsData)
      .objectLat('lat')
      .objectLng('lng')
      .objectAltitude(0.006)
      .objectThreeObject((d) => {
        const height = MIN_HEIGHT + d.t * (MAX_HEIGHT - MIN_HEIGHT)
        const geometry = new THREE.CylinderGeometry(BAR_RADIUS, BAR_RADIUS, height, 16)
        geometry.translate(0, height / 2, 0)
        const material = new THREE.MeshLambertMaterial({
          color: scoreToColor(d.t),
          transparent: true,
          opacity: 0.92,
        })
        return new THREE.Mesh(geometry, material)
      })
      .objectLabel((d) => `
        <div style="font: 13px system-ui; padding: 4px 2px;">
          <strong>${d.name}</strong><br/>
          Görünürlük skoru: ${d.score.toFixed(1)}<br/>
          En popüler dizi: ${d.topSeries ? d.topSeries.name : '—'}
        </div>
      `)
      .onObjectClick((d) => onSelect?.(d))
  }, [countries, onSelect])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
