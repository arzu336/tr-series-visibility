import { useEffect, useRef, useState } from 'react'
import Globe from 'globe.gl'
import * as THREE from 'three'
import { scoreToColor, brightenRgb } from '../lib/scale.js'
import { fetchCountryGeoJSON, featureIso2 } from '../lib/geo.js'
import { resolveIso2FromLabel } from '../lib/continents.js'
import turkishNames from '../data/country-centroids.json'

function displayName(feat) {
  return turkishNames[featureIso2(feat)]?.name || feat.properties.NAME
}

const MIN_ALTITUDE = 0.006
const MAX_ALTITUDE = 0.22
// Lowy Institute paleti: koyu mat lacivert taban (veri yoksa).
const NO_DATA_COLOR = '#131c31'
// Oyuncu veya dizi filtresi (highlightFilter) düz/tekli bir "bu ülkede yayında" işareti —
// Map2D.jsx'teki aynı sabitle eşleşir (kıta vurgusuyla aynı camgöbeği).
const HIGHLIGHT_FILTER_COLOR = '#22d3ee'
// TMDB/JustWatch'ta hiç sağlayıcı verisi olmayan, sadece Google Trends arama ilgisi TAHMİNİ
// (server/services/proxyScore.js) olan ülkeler — gerçek verinin sıralı camgöbeği skalasından
// (scoreToColor) KASITLI olarak ayrı, sabit bir amber tonu: skorları hep 0 olduğu için gerçek
// skalaya girselerdi en soğuk durakla karışır, kullanıcı "gerçekten çok düşük" ile "gerçek veri
// yok, bu bir tahmin"i ayırt edemezdi. Map2D.jsx'teki aynı sabitle eşleşir.
const PROXY_DATA_COLOR = '#b45309'
const DEFAULT_VIEW = { lat: 15, lng: 20, altitude: 2.4 }
// Tekil ülke odaklanması — önceki 1.1 aşırı yakınlaşıyordu, ülke ve komşularının rahatça
// görülebildiği daha gevşek bir mesafeye çekildi.
const FOCUS_ALTITUDE = 1.8
// İnce, zarif ülke sınırları (Map2D ile aynı renk) — hover/seçim/highlight bunun üzerine
// sadece kenar rengi/kalınlığı olarak eklenir, ayrı bir katman yok.
const STROKE_DEFAULT = '#1e293b'
const STROKE_HOVER = 'rgba(255, 255, 255, 0.9)'
const STROKE_SELECTED = '#ffffff'
const STROKE_HIGHLIGHT = '#f0ad4e'
const STROKE_CONTINENT = '#22d3ee'

// Küre üzerinde bir ülkeye tıklamak eskiden burada da (Map2D.jsx'te olduğu gibi) bir
// glassmorphism bilgi kartı açıyordu — özellikle mobilde haritanın büyük bölümünü kaplayıp
// ikinci bir "dizi bilgisi" yüzeyi yaratıyordu. Kullanıcı talebiyle kaldırıldı: tüm dizi/ülke
// detayları artık YALNIZCA sağ çekmecede (CountryPanel.jsx). `popup` prop'u hâlâ geliyor
// ama sadece boş alana tıklamada seçimi kapatmak (`popup.onClose`, bkz. onGlobeClick) için
// kullanılıyor — görsel bir kart üretmiyor.
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
      // Dokular eskiden unpkg.com'dan çalışma zamanında çekiliyordu — internet çıkışı olmayan
      // kurumsal ağda küre dokusuz/siyah kalıyordu (denetim B-06). Artık public/map/ altında.
      .globeImageUrl('/map/earth-night.jpg')
      .bumpImageUrl('/map/earth-topology.png')
      .backgroundImageUrl('/map/night-sky.png')
      .showAtmosphere(true)
      .atmosphereColor('#7fb6ff')
      .atmosphereAltitude(0.18)
      .polygonsTransitionDuration(300)
      // Sade hover vurgusu — globe.gl'in kendi dokümante edilen deseni: hoveredRef bir
      // useRef olduğu için polygonStrokeColor accessor'ı her çağrıldığında güncel değeri
      // okur, ayrı bir re-render/efekt tetiklemeye gerek kalmaz.
      .onPolygonHover((f) => {
        hoveredRef.current = f
      })
      // Ülke poligonu dışına (okyanus/boş küre yüzeyi) tıklama — seçili ülkeyi (ve sağ
      // çekmeceyi) kapatır. onPolygonClick ülke isabetlerinde ayrıca ve öncelikli
      // tetiklenir, bu ikisi çakışmaz.
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

      // Denetim bulgusu B-17: burası eskiden SADECE container.innerHTML = '' yapıyordu. Canvas
      // DOM'dan çıkıyor ama WebGL context'i ve globe.gl'in requestAnimationFrame döngüsü ayakta
      // kalıyordu; 2D/3D arasında her geçiş bir context daha sızdırıyor, tarayıcının sert sınırına
      // (Chrome ~16 eşzamanlı context) gelince en eskiler zorla düşürülüyor ve küre kararıyordu.
      //
      // globe.gl 2.46.1'in _destructor()'ı animasyonu durdurup tüm katman verilerini boşaltır AMA
      // context'i BIRAKMAZ — kurulu bundle'da ne `renderer.dispose` ne `forceContextLoss` geçiyor
      // (doğrulandı). Bu yüzden ikisini de elle çağırmak gerekiyor; sıra önemli: önce döngüyü
      // durdur, sonra GPU kaynaklarını bırak, en son DOM'u boşalt.
      try {
        world._destructor?.()
        const renderer = world.renderer?.()
        if (renderer) {
          renderer.dispose()
          renderer.forceContextLoss?.()
        }
      } catch (err) {
        // Yıkım sırasındaki bir hata unmount'u kırmamalı — bileşen her hâlükârda gitmeli.
        console.warn('[Globe3D] Küre yıkımı sırasında hata:', err?.message)
      }

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

    // Ölçek (min/max) yalnızca gerçek TMDB verili ülkelerden hesaplanır — proxy ülkelerin
    // sabit 0 skoru dahil edilirse minScore her zaman 0'a çekilir ve GERÇEK ülkelerin
    // arasındaki fark de bozulur (bkz. PROXY_DATA_COLOR tanımındaki not).
    const realScores = countries.filter((c) => c.dataSource !== 'proxy').map((c) => c.score)
    const minScore = realScores.length > 0 ? Math.min(...realScores) : 0
    const maxScore = realScores.length > 0 ? Math.max(...realScores) : 1
    const range = maxScore - minScore || 1

    const byIso2 = new Map()
    countries.forEach((c) => {
      const t = (c.score - minScore) / range
      byIso2.set(c.iso2, { ...c, t })
    })

    const matched = geoFeatures.filter((f) => byIso2.has(featureIso2(f))).length
    if (matched === 0) {
      console.warn('[Globe3D] Hiçbir ülke sınırı verisiyle eşleşmedi (ISO_A2 kontrol edilmeli)')
    }

    // Madde 1 — dizi bazlı harita filtresi: gerçek, ülke bazlı Google Trends arama ilgisi
    // (bkz. src/App.jsx seriesFilter state'i). Dolgu/tooltip bunu kullanır; tıklama her
    // zaman aggregate byIso2'yi kullanmaya devam eder (CountryPanel bunu bekliyor).
    // Map2D.jsx'teki aynı düzeltme: gerçek bir ilgi ölçülmemiş (value<=0) ülkeler haritaya hiç
    // eklenmiyor, aksi halde Google Trends'in döndürdüğü onlarca 0-1 aralıklı "iz" gradyanın en
    // koyu durağıyla boyanıp haritayı bulanıklaştırıyordu.
    const seriesByIso2 = seriesFilter
      ? new Map(
          (seriesFilter.byCountry || [])
            .filter((entry) => entry.value > 0)
            .map((entry) => [resolveIso2FromLabel(entry.country), entry.value])
            .filter(([iso2]) => iso2)
        )
      : null

    // Oyuncu/dizi bazlı harita filtresi (bkz. src/App.jsx highlightFilter) — bir skor
    // gradyanı değil, düz/tekli bir "bu ülkede yayında" işareti (bkz. Map2D.jsx'teki aynı
    // sadeleştirme).
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
        const base = c.dataSource === 'proxy' ? PROXY_DATA_COLOR : scoreToColor(c.t)
        // "Ülke rengi hafifçe parlasın" — three-globe'un WebGL materyali CSS filter kabul
        // etmiyor, bu yüzden hover'da rengi beyaza doğru hafifçe iten brightenRgb kullanılır
        // (bkz. lib/scale.js) — Map2D'deki CSS brightness() filtresinin karşılığı.
        return f === hoveredRef.current ? brightenRgb(base, 0.22) : base
      })
      .polygonSideColor(() => 'rgba(20, 24, 38, 0.35)')
      .polygonStrokeColor((f) => {
        const iso2 = featureIso2(f)
        // Öncelik sırası: oyuncu popülerlik ağı > seçili ülke > kıta vurgusu > hover > varsayılan.
        if (actorHighlightRef.current.has(iso2)) return STROKE_HIGHLIGHT
        if (iso2 === selectedIso2Ref.current) return STROKE_SELECTED
        if (continentHighlightRef.current?.has(iso2)) return STROKE_CONTINENT
        if (f === hoveredRef.current) return STROKE_HOVER
        return STROKE_DEFAULT
      })
      .polygonAltitude((f) => {
        const c = byIso2.get(featureIso2(f))
        if (!c) return 0.003
        // Proxy ülkelerin skoru sabit 0 → gerçek min/max'a göre t negatif çıkabilir, bu da
        // ülkeyi küre yüzeyinin altına gömerdi. Sabit, en düşük gerçek yükseklikte kalırlar.
        if (c.dataSource === 'proxy') return MIN_ALTITUDE
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
  }, [countries, geoFeatures, onSelect, actorHighlight, selectedIso2, seriesFilter, highlightFilter, continentHighlight])

  useEffect(() => {
    // Harita üzerinde artık bir bilgi kartı render edilmiyor (bkz. dosya başındaki not) —
    // popupRef sadece onGlobeClick'in güncel onClose callback'ine erişebilmesi için tutuluyor.
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
