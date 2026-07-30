import { useEffect, useRef, useState } from 'react'
import Globe from 'globe.gl'
import * as THREE from 'three'
import { scoreToColor, brightenRgb } from '../lib/scale.js'
import { fetchCountryGeoJSON } from '../lib/geo.js'
import { resolveIso2FromLabel } from '../lib/continents.js'
import { trendLabel } from '../lib/trend.js'
import turkishNames from '../data/country-centroids.json'

function displayName(feat) {
  return turkishNames[feat.properties.ISO_A2]?.name || feat.properties.NAME
}

const MIN_ALTITUDE = 0.006
const MAX_ALTITUDE = 0.22
// Lowy Institute paleti: koyu mat lacivert taban (veri yoksa).
const NO_DATA_COLOR = '#131c31'
// Oyuncu filtresi (actorFilter) düz/tekli bir "bu ülkede yayında" işareti — Map2D.jsx'teki
// aynı sabitle eşleşir (kıta vurgusuyla aynı camgöbeği).
const ACTOR_FILTER_COLOR = '#22d3ee'
const DEFAULT_VIEW = { lat: 15, lng: 20, altitude: 2.4 }
// Tekil ülke odaklanması — önceki 1.1 aşırı yakınlaşıyordu, ülke ve komşularının rahatça
// görülebildiği daha gevşek bir mesafeye çekildi.
const FOCUS_ALTITUDE = 1.8
const POSTER_BASE = 'https://image.tmdb.org/t/p/w154'

function formatVotes(n) {
  if (n == null) return null
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`
  return String(n)
}
// İnce, zarif ülke sınırları (Map2D ile aynı renk) — hover/seçim/highlight bunun üzerine
// sadece kenar rengi/kalınlığı olarak eklenir, ayrı bir katman yok.
const STROKE_DEFAULT = '#1e293b'
const STROKE_HOVER = 'rgba(255, 255, 255, 0.9)'
const STROKE_SELECTED = '#ffffff'
const STROKE_HIGHLIGHT = '#f0ad4e'
const STROKE_CONTINENT = '#22d3ee'

// Lowy Institute tarzı Dark Glassmorphism harita içi detay kartı — globe.gl'in htmlElement
// API'si React'ten bağımsız çalıştığı için DOM'u burada elle inşa ediyoruz. Aynı görünüm
// Map2D.jsx'te MapPopupCard.jsx (gerçek React bileşeni) olarak tekrarlanır — ikisi de aynı
// .map-popup-card sınıflarını paylaşır. Sadece hızlı bakış içindir (dizi + skor + tema +
// trend + IMDb); kadro ve diğer ayrıntılar artık sadece sağ paneldedir (bkz.
// CountryPanel.jsx) — burada sadece statik bir ipucu satırı var.
function buildPopupElement(d) {
  const el = document.createElement('div')
  el.className = 'map-popup-card'
  // globe.gl'in htmlElement katmanı (CSS3DRenderer overlay'i) varsayılan olarak
  // pointer-events:none taşır (tıklamalar altındaki WebGL canvas'a/orbit-controls'a
  // geçsin diye) — .map-popup-card'a styles.css'te pointer-events:auto verilmesiyle bu
  // kart ve içindeki butonlar tekrar tıklanabilir olur. stopPropagation ekstra güvenlik:
  // kart içi bir tıklamanın document'a kadar kabarıp başka bir dinleyiciyi tetiklememesi için.
  el.addEventListener('click', (e) => e.stopPropagation())

  const posterHtml = d.series.posterPath
    ? `<img class="map-popup-card__poster" src="${POSTER_BASE}${d.series.posterPath}" alt="" />`
    : `<span class="map-popup-card__poster map-popup-card__poster--empty" aria-hidden="true"></span>`

  const imdbReady = d.imdbStatus === 'ready' && d.imdb?.rating != null
  const imdbBadgeHtml = imdbReady
    ? `<div class="map-popup-card__imdb-badge"><span class="map-popup-card__imdb-badge-star">⭐</span><span class="map-popup-card__imdb-badge-value">${d.imdb.rating.toFixed(1)}</span></div>`
    : ''
  const votesOrPendingHtml =
    imdbReady && d.imdb.votes != null
      ? `<div class="map-popup-card__votes">(${formatVotes(d.imdb.votes)} Oy)</div>`
      : d.imdbStatus !== 'ready'
        ? `<div class="map-popup-card__pending">IMDb verisi güncelleniyor…</div>`
        : ''

  const trendInfo = trendLabel(d.trend)

  el.innerHTML = `
    <button class="map-popup-card__close" aria-label="Kapat">✕</button>
    <div class="map-popup-card__top">
      <div class="map-popup-card__poster-wrap">
        ${posterHtml}
        ${imdbBadgeHtml}
      </div>
      <div class="map-popup-card__body">
        <div class="map-popup-card__name">${d.series.name}</div>
        ${votesOrPendingHtml}
      </div>
    </div>
    <div class="map-popup-card__pills">
      ${d.dominantTheme ? `<span class="map-popup-card__pill">${d.dominantTheme}</span>` : ''}
      <span class="map-popup-card__pill">Skor ${d.score != null ? d.score.toFixed(1) : '—'}</span>
      <span class="map-popup-card__pill map-popup-card__pill--${trendInfo.className}">${trendInfo.icon} ${trendInfo.pct != null ? `${trendInfo.pct}%` : 'Yeni'}</span>
    </div>
    <p class="map-popup-card__hint">Kadro ve ayrıntılar için sağ paneli inceleyin →</p>
  `

  el.querySelector('.map-popup-card__close')?.addEventListener('click', () => d.onClose?.())

  return el
}

export default function Globe3D({
  countries,
  onSelect,
  popup,
  focusTarget,
  actorHighlight,
  selectedIso2,
  seriesFilter,
  actorFilter,
  continentHighlight,
  onResetView,
}) {
  const containerRef = useRef(null)
  const globeRef = useRef(null)
  const hoveredRef = useRef(null)
  const selectedIso2Ref = useRef(null)
  const actorHighlightRef = useRef(new Set())
  const continentHighlightRef = useRef(null)
  // onGlobeClick mount-only effect'te (aşağıda, [] dep) bir kez kuruluyor — güncel popup'ı
  // (ve onClose'unu) closure'da taze tutmak için hover/selectedIso2 ile aynı ref deseni.
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
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-night.jpg')
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
      .showAtmosphere(true)
      .atmosphereColor('#7fb6ff')
      .atmosphereAltitude(0.18)
      .polygonsTransitionDuration(300)
      .htmlElementsData([])
      .htmlLat((d) => d.lat)
      .htmlLng((d) => d.lng)
      .htmlAltitude(0.02)
      .htmlElement(buildPopupElement)
      // Sade hover vurgusu — globe.gl'in kendi dokümante edilen deseni: hoveredRef bir
      // useRef olduğu için polygonStrokeColor accessor'ı her çağrıldığında güncel değeri
      // okur, ayrı bir re-render/efekt tetiklemeye gerek kalmaz.
      .onPolygonHover((f) => {
        hoveredRef.current = f
      })
      // Ülke poligonu dışına (okyanus/boş küre yüzeyi) tıklama — açık pop-up'ı kapatır.
      // onPolygonClick ülke isabetlerinde ayrıca ve öncelikli tetiklenir, bu ikisi çakışmaz.
      .onGlobeClick(() => popupRef.current?.onClose?.())

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

    // globe.gl kendi container'ının boyut değişimini izlemiyor (kurulu sürümde
    // ResizeObserver/window-resize dinleyicisi yok) — sol panel açılıp kapandığında
    // veya daraltılıp genişletildiğinde küre eski boyutunda kalıp yanlış ortalanmış
    // görünüyordu. Container'ı elle izleyip .width()/.height() accessor'larını
    // güncelliyoruz; bu şikayetin kök nedeni tam olarak buydu.
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
      container.innerHTML = ''
      globeRef.current = null
    }
  }, [])

  // selectedIso2/actorHighlight prop'ları sık değişmez ama polygon accessor'ları
  // (aşağıdaki efekt) her ikisini de closure ile yakaladığı için bu ref'ler üzerinden
  // güncel tutuluyor — hover ile aynı desen.
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

    // Madde 1 — dizi bazlı harita filtresi: gerçek, ülke bazlı Google Trends arama ilgisi
    // (bkz. src/App.jsx seriesFilter state'i). Dolgu/tooltip bunu kullanır; tıklama her
    // zaman aggregate byIso2'yi kullanmaya devam eder (CountryPanel bunu bekliyor).
    const seriesByIso2 = seriesFilter
      ? new Map(
          (seriesFilter.byCountry || [])
            .map((entry) => [resolveIso2FromLabel(entry.country), entry.value])
            .filter(([iso2]) => iso2)
        )
      : null

    // Oyuncu bazlı harita filtresi (bkz. src/App.jsx actorFilter) — bir skor gradyanı değil,
    // düz/tekli bir "bu ülkede yayında" işareti (bkz. Map2D.jsx'teki aynı sadeleştirme).
    const actorByIso2 = actorFilter
      ? new Map(
          Array.from(actorFilter.byIso2 instanceof Map ? actorFilter.byIso2.entries() : []).map(([iso2, score]) => [
            iso2,
            { score },
          ])
        )
      : null

    world
      .polygonsData(geoFeatures)
      .polygonCapColor((f) => {
        const iso2 = f.properties.ISO_A2
        if (actorByIso2) {
          const entry = actorByIso2.get(iso2)
          return entry ? ACTOR_FILTER_COLOR : NO_DATA_COLOR
        }
        if (seriesByIso2) {
          const value = seriesByIso2.get(iso2)
          return value != null ? scoreToColor(value / 100) : NO_DATA_COLOR
        }
        const c = byIso2.get(iso2)
        if (!c) return NO_DATA_COLOR
        const base = scoreToColor(c.t)
        // "Ülke rengi hafifçe parlasın" — three-globe'un WebGL materyali CSS filter kabul
        // etmiyor, bu yüzden hover'da rengi beyaza doğru hafifçe iten brightenRgb kullanılır
        // (bkz. lib/scale.js) — Map2D'deki CSS brightness() filtresinin karşılığı.
        return f === hoveredRef.current ? brightenRgb(base, 0.22) : base
      })
      .polygonSideColor(() => 'rgba(20, 24, 38, 0.35)')
      .polygonStrokeColor((f) => {
        const iso2 = f.properties.ISO_A2
        // Öncelik sırası: oyuncu popülerlik ağı > seçili ülke > kıta vurgusu > hover > varsayılan.
        if (actorHighlightRef.current.has(iso2)) return STROKE_HIGHLIGHT
        if (iso2 === selectedIso2Ref.current) return STROKE_SELECTED
        if (continentHighlightRef.current?.has(iso2)) return STROKE_CONTINENT
        if (f === hoveredRef.current) return STROKE_HOVER
        return STROKE_DEFAULT
      })
      .polygonAltitude((f) => {
        const c = byIso2.get(f.properties.ISO_A2)
        return c ? MIN_ALTITUDE + c.t * (MAX_ALTITUDE - MIN_ALTITUDE) : 0.003
      })
      .polygonLabel((f) => {
        const name = displayName(f)
        const iso2 = f.properties.ISO_A2
        if (actorByIso2) {
          const entry = actorByIso2.get(iso2)
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
        return `
          <div style="font: 13px system-ui; padding: 4px 2px;">
            <strong>${name}</strong><br/>
            Görünürlük skoru: ${c.score.toFixed(1)}
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
  }, [countries, geoFeatures, onSelect, actorHighlight, selectedIso2, seriesFilter, actorFilter, continentHighlight])

  useEffect(() => {
    popupRef.current = popup
    const world = globeRef.current
    if (!world) return
    world.htmlElementsData(popup && popup.lat != null && popup.lng != null ? [popup] : [])
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
