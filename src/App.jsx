import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import CountryPanel from './components/CountryPanel.jsx'
import Legend from './components/Legend.jsx'
import Login from './components/Login.jsx'
import ChangePasswordModal from './components/ChangePasswordModal.jsx'
import ContinentSidebar from './components/ContinentSidebar.jsx'
import MapViewToggle from './components/MapViewToggle.jsx'

const Globe3D = lazy(() => import('./components/Globe3D.jsx'))
const Map2D = lazy(() => import('./components/Map2D.jsx'))
const AnalystDashboard = lazy(() => import('./components/AnalystDashboard.jsx'))
const TrendsExplorer = lazy(() => import('./components/TrendsExplorer.jsx'))
const ImpactReport = lazy(() => import('./components/ImpactReport.jsx'))
const AdminUsersPanel = lazy(() => import('./components/AdminUsersPanel.jsx'))
const PENDING_APPROVALS_POLL_MS = 60000
const MAP_VIEW_STORAGE_KEY = 'gp_map_view'
import { fetchVisibility, fetchAuthStatus, logout, fetchAdminUsers, fetchImdbData } from './lib/api.js'
import { continentCentroid } from './lib/continents.js'
import countryNames from './data/country-centroids.json'
const SIDEBAR_COLLAPSED_KEY = 'gp_sidebar_collapsed'
const PANEL_COLLAPSED_KEY = 'gp_panel_collapsed'

export default function App() {
  const [authStatus, setAuthStatus] = useState('checking') // checking | in | out
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)
  const [countries, setCountries] = useState([])
  const [meta, setMeta] = useState(null)
  const [selected, setSelected] = useState(null)
  const [imdbData, setImdbData] = useState(null)
  const [imdbStatus, setImdbStatus] = useState('idle') // idle | loading | ready | unavailable
  const [selectedActorId, setSelectedActorId] = useState(null)
  const [focusTarget, setFocusTarget] = useState(null)
  const [actorHighlight, setActorHighlight] = useState(null)
  // Kıta seçiminde ülke sınırlarını neon çizgiyle vurgulamak için (bkz. handleFocusContinent) —
  // mevcut focusTarget (yumuşak flyTo/zoom) yerine geçmez, üstüne eklenir.
  const [continentHighlight, setContinentHighlight] = useState(null) // Set<iso2> | null
  // Dizi bazlı harita filtresi (madde 1) — dolduğunda harita genel skor yerine SADECE bu
  // dizinin gerçek, ülke bazlı Google Trends arama ilgisine göre renklenir.
  const [seriesFilter, setSeriesFilter] = useState(null) // { seriesName, byCountry } | null
  // Oyuncu VEYA dizi bazlı düz/tekli harita vurgusu — "Bu Oyuncunun/Dizinin Tüm
  // Projelerini/Ülkelerini Haritada Göster" ile dolar; seriesFilter (Trends tabanlı,
  // gradyan) ile aynı FILL katmanını kullanır (karşılıklı dışlayıcı), ama gerçek,
  // zaten yüklü ülke bazlı görünürlük verisinden hesaplanan düz bir "yayında/değil"
  // işaretidir — kind alanı rozet/etiket metnini oyuncuya göre mi diziye göre mi
  // yazacağını belirler.
  const [highlightFilter, setHighlightFilter] = useState(null) // { kind: 'actor'|'series', label, byIso2: Map<iso2, score> } | null
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  })
  // Sağdaki CountryPanel de sol kıta çubuğu gibi açılıp kapanabilir olsun istendi.
  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(PANEL_COLLAPSED_KEY) === '1'
  })
  // Ülke panelindeki "Yayındaki diziler" listesinden hangi dizinin haritada/IMDb'de
  // gösterileceği — null iken en popüler dizi (seriesList zaten popülerliğe göre sıralı,
  // bkz. server/aggregate.js) varsayılan olarak gösterilir.
  const [activeSeriesId, setActiveSeriesId] = useState(null)
  // Sağ panel arama barından bir DİZİ sonucuna tıklandığında (bkz. handleSelectSeriesGlobal) —
  // artık ilgisiz bir ülkeye zıplamak yerine, o dizinin kendi bilgisi (ActorPanel'in
  // oyuncu için yaptığının aynısı) aynı panel slotunda gösterilir.
  const [searchedSeriesId, setSearchedSeriesId] = useState(null)
  const [view, setView] = useState('map')
  // Lowy Institute tarzı 2D düz harita varsayılan görünüm — kullanıcı daha önce 3D'yi
  // seçtiyse (localStorage'da kayıtlıysa) o tercih korunur.
  const [mapView, setMapView] = useState(() => {
    if (typeof window === 'undefined') return '2d'
    return window.localStorage.getItem(MAP_VIEW_STORAGE_KEY) === '3d' ? '3d' : '2d'
  })
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const profileMenuRef = useRef(null)

  const loadAuthStatus = useCallback(() => {
    fetchAuthStatus()
      .then((d) => {
        setUser(d.user)
        setAuthStatus(d.authenticated ? 'in' : 'out')
      })
      .catch(() => setAuthStatus('out'))
  }, [])

  useEffect(() => {
    loadAuthStatus()
  }, [loadAuthStatus])

  useEffect(() => {
    if (!showProfileMenu) return
    const handleClickOutside = (e) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setShowProfileMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showProfileMenu])

  useEffect(() => {
    if (!user?.isAdmin) return
    const loadPendingApprovals = () => {
      fetchAdminUsers()
        .then((res) => setPendingApprovals(res.items.filter((u) => u.status === 'pending').length))
        .catch(() => {})
    }
    loadPendingApprovals()
    const interval = setInterval(loadPendingApprovals, PENDING_APPROVALS_POLL_MS)
    return () => clearInterval(interval)
  }, [user?.isAdmin, view])

  useEffect(() => {
    if (authStatus !== 'in') return
    fetchVisibility()
      .then((data) => {
        setCountries(data.countries)
        setMeta({ updatedAt: data.updatedAt, seriesCount: data.seriesCount })
        setStatus('ready')
      })
      .catch((err) => {
        setError(err.message)
        setStatus('error')
      })
  }, [authStatus])

  useEffect(() => {
    window.localStorage.setItem(MAP_VIEW_STORAGE_KEY, mapView)
  }, [mapView])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  useEffect(() => {
    window.localStorage.setItem(PANEL_COLLAPSED_KEY, panelCollapsed ? '1' : '0')
  }, [panelCollapsed])

  // Ülke panelini/pop-up'ı kapatan tüm yollar (× butonu, Escape, harita boş alan tıklaması)
  // aynı işlevi paylaşır — seçili ülkeyle birlikte, o ülkeye ait sağ paneldeki oyuncu
  // görünümü de (varsa) temizlenir, aksi halde yeni bir ülke seçildiğinde eski oyuncu
  // görünümü hayalet gibi kalabilirdi.
  const handleCloseSelection = useCallback(() => {
    setSelected(null)
    setSelectedActorId(null)
    setSearchedSeriesId(null)
  }, [])

  // Escape: en üstteki katmanı kapatır — sağ paneldeki oyuncu görünümü açıksa önce o, sonra
  // aranan dizi görünümü, yoksa seçili ülke/pop-up. Harita bileşenlerinin kendi tıklama-dışı
  // kapama mantığıyla (Map2D svg background, Globe3D onGlobeClick) aynı hedefi
  // (handleCloseSelection) paylaşır.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== 'Escape') return
      if (selectedActorId != null) {
        setSelectedActorId(null)
      } else if (searchedSeriesId != null) {
        setSearchedSeriesId(null)
      } else if (selected) {
        handleCloseSelection()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selected, selectedActorId, searchedSeriesId, handleCloseSelection])

  // "Yayındaki diziler" listesinden hangi dizi seçiliyse (bkz. activeSeriesId) haritadaki
  // pop-up ve IMDb kartı ona göre güncellenir — seçim yoksa seriesList'in en popüler ilk
  // öğesi (topSeries ile aynı dizi, sadece theme/overview gibi ek alanları da taşıyor)
  // varsayılan gösterilir.
  const activeSeries =
    selected?.seriesList?.find((s) => s.id === activeSeriesId) ?? selected?.seriesList?.[0] ?? null

  // IMDb verisi artık ülkenin en popüler dizisi yerine ekranda o an gösterilen (activeSeries)
  // diziye göre çekiliyor — seçili ülke veya seçili dizi değiştikçe tek seferlik yenilenir.
  useEffect(() => {
    const tmdbId = activeSeries?.id
    if (tmdbId == null) {
      setImdbData(null)
      setImdbStatus('idle')
      return
    }
    let cancelled = false
    setImdbStatus('loading')
    setImdbData(null)
    fetchImdbData(tmdbId)
      .then((data) => {
        if (cancelled) return
        setImdbData(data)
        setImdbStatus(data.status)
      })
      .catch(() => {
        if (cancelled) return
        setImdbData(null)
        setImdbStatus('unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [activeSeries?.id])

  // Panel katlanmışken bir ülkeye/oyuncuya/diziye tıklamak veri günceller ama panel
  // görsel olarak kapalı kaldığı için hiçbir şey görünmüyordu — yeni bir seçim her zaman
  // paneli otomatik açar.
  const handleSelect = useCallback((country) => {
    setSelected(country)
    // Tek bir ülkeye odaklanmak, önceki oyuncu popülerlik ağı vurgusunu geçersiz kılar —
    // ikisi aynı anda haritada karışık görünmesin diye temizleniyor. Yeni ülkenin kendi
    // en popüler dizisiyle başlaması için önceki dizi seçimi de sıfırlanır.
    setActorHighlight(null)
    setActiveSeriesId(null)
    setSearchedSeriesId(null)
    setPanelCollapsed(false)
  }, [])

  const handleSelectCountryFromReport = useCallback(
    (iso2) => {
      const country = countries.find((c) => c.iso2 === iso2)
      if (!country) return
      setSelected({ ...country, name: countryNames[iso2]?.name || iso2 })
      setActorHighlight(null)
      setActiveSeriesId(null)
      setSearchedSeriesId(null)
      setPanelCollapsed(false)
      setView('map')
    },
    [countries]
  )

  // CountryPanel'deki "Yayındaki diziler" listesinden bir dizi seçildiğinde harita
  // pop-up'ı ve IMDb kartı o diziye geçer.
  const handleSelectSeries = useCallback((seriesId) => {
    setActiveSeriesId(seriesId)
  }, [])

  // Sağ paneldeki arama barından bir DİZİ sonucuna tıklandığında — ActorPanel'in oyuncu
  // için yaptığının aynısı: ilgisiz bir ülkenin tüm panosuna zıplamak yerine, o dizinin
  // kendi bilgisi (SeriesPanel) aynı panel slotunda gösterilir.
  const handleSelectSeriesGlobal = useCallback((seriesId) => {
    setSearchedSeriesId(seriesId)
    setSelectedActorId(null)
    setPanelCollapsed(false)
  }, [])

  // Sağ paneldeki arama barından bir OYUNCU sonucuna tıklandığında (bkz. CastBar/
  // PanelSearch) — actor view'ı açar VE paneli otomatik açık hale getirir.
  const handleSelectActor = useCallback((personId) => {
    setSelectedActorId(personId)
    setPanelCollapsed(false)
  }, [])

  // Arama barından bir ÜLKE sonucuna tıklandığında (bkz. PanelSearch) — mevcut
  // handleSelectCountryFromReport ile aynı akış, sadece adı farklı bir giriş noktası.
  const handleSelectCountryGlobal = handleSelectCountryFromReport

  // Kıta odaklanması (flyTo) — sidebar'da bir kıta seçildiğinde haritayı o kıtanın gerçek
  // ülke merkezlerinden hesaplanan ağırlık merkezine yumuşak geçişle götürür VE o kıtaya
  // dahil ülkelerin sınırlarını neon çizgiyle vurgular (aşırı yakınlaşmaya güvenmek yerine).
  const handleFocusContinent = useCallback((continentStats) => {
    const target = continentCentroid(continentStats.countries)
    if (target) setFocusTarget(target)
    setContinentHighlight(new Set(continentStats.countries.map((c) => c.iso2)))
  }, [])

  // "Genel Görünüm" butonu (Map2D + Globe3D) — kıta odaklanmasını ve sınır vurgusunu temizler;
  // harita bileşenlerinin kendi zoom/kamera sıfırlaması (Map2D'nin yerel zoom state'i,
  // Globe3D'nin pointOfView'ı) ayrıca kendi handleReset'lerinde yapılır.
  const handleResetMapView = useCallback(() => {
    setFocusTarget(null)
    setContinentHighlight(null)
  }, [])

  // Bir oyuncunun (sağ paneldeki oyuncu görünümünde) "Bu Oyuncunun Tüm Projelerini Haritada
  // Göster" eylemi — o oyuncunun TÜM dizilerindeki TÜM ülkeleri (skorları toplanmış) hem
  // kenar vurgusu (actorHighlight, Lowy tarzı düğüm ağı) hem de dolgu (highlightFilter)
  // olarak haritaya geçirir — seriesFilter ile aynı FILL katmanını paylaştığı için ikisi
  // karşılıklı dışlayıcıdır.
  const handleShowActorNetwork = useCallback((actorName, seriesList) => {
    const byIso2 = new Map()
    for (const series of seriesList || []) {
      for (const c of series.countries || []) {
        byIso2.set(c.iso2, (byIso2.get(c.iso2) || 0) + c.score)
      }
    }
    const highlight = Array.from(byIso2.entries())
      .map(([iso2, score]) => ({
        iso2,
        score,
        lat: countryNames[iso2]?.lat,
        lng: countryNames[iso2]?.lng,
      }))
      .filter((h) => h.lat != null && h.lng != null)
    setActorHighlight(highlight)
    setHighlightFilter({ kind: 'actor', label: actorName, byIso2 })
    setSeriesFilter(null)
    setSelectedActorId(null)
  }, [])

  // SeriesPanel'deki "Bu Dizinin Küresel Dağılımını Haritada Göster" eylemi — Trends'ten
  // (arama ilgisi) ayrı bir istek atmaz; SeriesPanel'in zaten client-side hesapladığı
  // GERÇEK yayın ülkesi listesini (series.countries) doğrudan kullanır. Önceden Google
  // Trends arama ilgisi verisi (seriesFilter) kullanılıyordu ama bu, "arama ilgisi" ile
  // "gerçekten yayında olma"yı karıştırıyordu — Trends verisi bazı ülkeler için hiç
  // olmayabildiğinden dizinin GERÇEKTEN yayınlandığı ülkeler haritada boş görünüyordu.
  const handleShowSeriesAvailability = useCallback((seriesName, countryScores) => {
    const byIso2 = new Map((countryScores || []).map((c) => [c.iso2, c.score]))
    setHighlightFilter({ kind: 'series', label: seriesName, byIso2 })
    setActorHighlight(null)
    setSeriesFilter(null)
  }, [])

  // TrendsExplorer'da zaten sorgulanmış sonucu tekrar fetch etmeden doğrudan kullanır —
  // bu, Google Trends ARAMA İLGİSİ gradyanını gösteren ayrı/farklı bir özellik
  // (handleShowSeriesAvailability'nin gerçek yayın verisiyle karıştırılmamalı).
  const handleShowSeriesOnMap = useCallback((result) => {
    setSeriesFilter({ seriesName: result.seriesName, byCountry: result.byCountry })
    setHighlightFilter(null)
    setActorHighlight(null)
    setView('map')
  }, [])

  const clearSeriesFilter = useCallback(() => {
    setSeriesFilter(null)
  }, [])

  const clearHighlightFilter = useCallback(() => {
    setHighlightFilter(null)
    setActorHighlight(null)
  }, [])

  const handleLogout = async () => {
    try {
      await logout()
    } finally {
      setUser(null)
      setAuthStatus('out')
    }
  }

  // Globe3D/Map2D'deki harita içi pop-up kart için: seçili ülkenin koordinatı + o an aktif
  // dizi (activeSeries) + o dizinin popülerlik skoru/teması + ülkenin trendi + (yüklendiyse)
  // IMDb verisi.
  const popup =
    selected && activeSeries
      ? {
          iso2: selected.iso2,
          lat: countryNames[selected.iso2]?.lat,
          lng: countryNames[selected.iso2]?.lng,
          series: activeSeries,
          score: activeSeries.popularity,
          dominantTheme: activeSeries.theme,
          trend: selected.trend,
          imdb: imdbData,
          imdbStatus,
          onClose: handleCloseSelection,
        }
      : null

  if (authStatus === 'checking') {
    return <div className="status">Yükleniyor…</div>
  }

  if (authStatus === 'out') {
    return <Login onSuccess={loadAuthStatus} />
  }

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-row">
          <div className="app__brand">
            <img src="/ib-logo.png" alt="T.C. Cumhurbaşkanlığı İletişim Başkanlığı" className="app__brand-logo" />
            <div className="app__brand-divider" />
            <div>
              <h1>Türk Dizileri — Kültürel Görünürlük Haritası</h1>
              {meta && (
                <p className="app__meta">
                  {meta.seriesCount} dizi · {countries.length} ülke · güncelleme: {new Date(meta.updatedAt).toLocaleString('tr-TR')}
                </p>
              )}
            </div>
          </div>
          <nav className="app__nav">
            <button
              className={view === 'map' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
              onClick={() => setView('map')}
            >
              Harita
            </button>
            {user?.isAdmin && (
              <button
                className={view === 'dashboard' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
                onClick={() => setView('dashboard')}
              >
                Analist Paneli
              </button>
            )}
            <button
              className={view === 'trends' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
              onClick={() => setView('trends')}
            >
              Arama İlgisi
            </button>
            <button
              className={view === 'impact' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
              onClick={() => setView('impact')}
              title="Ekonomik, Kültürel ve İhracat Etkisi"
            >
              Etki & İhracat Analizi
            </button>
            {user?.isAdmin && (
              <button
                className={view === 'admin' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
                onClick={() => setView('admin')}
              >
                Kullanıcılar
                {pendingApprovals > 0 && (
                  <span className="app__nav-badge" title={`${pendingApprovals} onay bekliyor`}>
                    {pendingApprovals}
                  </span>
                )}
              </button>
            )}
            <button className="app__nav-btn app__nav-btn--logout" onClick={handleLogout}>
              Çıkış Yap
            </button>
            <div className="app__profile-menu" ref={profileMenuRef}>
              <button
                className="app__profile-btn"
                onClick={() => setShowProfileMenu((v) => !v)}
                title={user?.name || 'Profil'}
              >
                {user?.name?.trim()?.charAt(0).toUpperCase() || '?'}
              </button>
              {showProfileMenu && (
                <div className="app__profile-dropdown">
                  <p className="app__profile-dropdown-name">{user?.name}</p>
                  <p className="app__profile-dropdown-email">{user?.email}</p>
                  <button
                    className="app__profile-dropdown-item"
                    onClick={() => {
                      setShowPasswordModal(true)
                      setShowProfileMenu(false)
                    }}
                  >
                    Şifremi Değiştir
                  </button>
                </div>
              )}
            </div>
          </nav>
        </div>
      </header>

      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}

      <main className="app__main">
        <Suspense fallback={<div className="status">Yükleniyor…</div>}>
          {view === 'dashboard' && user?.isAdmin && <AnalystDashboard canEdit={Boolean(user?.isAdmin)} />}
          {view === 'trends' && <TrendsExplorer onShowOnMap={handleShowSeriesOnMap} />}
          {view === 'impact' && (
            <ImpactReport onSelectCountry={handleSelectCountryFromReport} />
          )}
          {view === 'admin' && user?.isAdmin && <AdminUsersPanel />}
          {view === 'map' && (
            <>
              {status === 'loading' && <div className="status">Veri yükleniyor…</div>}
              {status === 'error' && <div className="status status--error">Veri alınamadı: {error}</div>}
              {status === 'ready' && (
                <div className="app__map-layout">
                  <ContinentSidebar
                    countries={countries}
                    onSelectCountry={handleSelectCountryFromReport}
                    onFocusContinent={handleFocusContinent}
                    collapsed={sidebarCollapsed}
                    onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
                  />
                  <div className="app__map-pane">
                    <MapViewToggle value={mapView} onChange={setMapView} />
                    {seriesFilter && (
                      <div className="series-filter-badge">
                        <span>
                          Gösterilen Veri: <strong>{seriesFilter.seriesName}</strong> Küresel İlgi Dağılımı
                        </span>
                        <button onClick={clearSeriesFilter}>✕ Filtreyi Temizle / Genel Görünüm</button>
                      </div>
                    )}
                    {highlightFilter && (
                      <div className="series-filter-badge">
                        <span>
                          {highlightFilter.kind === 'actor' ? (
                            <>
                              Filtre: <strong>{highlightFilter.label}</strong> Projeleri
                            </>
                          ) : (
                            <>
                              Filtre: <strong>{highlightFilter.label}</strong> — Yayınlandığı Ülkeler
                            </>
                          )}
                        </span>
                        <button onClick={clearHighlightFilter}>✕ Filtreyi Temizle / Genel Görünüm</button>
                      </div>
                    )}
                    {mapView === '3d' ? (
                      <Globe3D
                        countries={countries}
                        onSelect={handleSelect}
                        popup={popup}
                        focusTarget={focusTarget}
                        actorHighlight={actorHighlight}
                        selectedIso2={selected?.iso2}
                        seriesFilter={seriesFilter}
                        highlightFilter={highlightFilter}
                        continentHighlight={continentHighlight}
                        onResetView={handleResetMapView}
                      />
                    ) : (
                      <Map2D
                        countries={countries}
                        onSelect={handleSelect}
                        popup={popup}
                        focusTarget={focusTarget}
                        actorHighlight={actorHighlight}
                        selectedIso2={selected?.iso2}
                        seriesFilter={seriesFilter}
                        highlightFilter={highlightFilter}
                        continentHighlight={continentHighlight}
                        onResetView={handleResetMapView}
                      />
                    )}
                    <Legend
                      caption={
                        seriesFilter
                          ? `"${seriesFilter.seriesName}" için ülke bazlı Google Trends arama ilgisi (0-100) — gerçek izlenme rakamı değil, arama ilgisine dayalı bir yakınsama (proxy) göstergesidir.`
                          : highlightFilter
                            ? highlightFilter.kind === 'actor'
                              ? `"${highlightFilter.label}" oyuncusunun takip edilen dizilerinden en az birinin gerçekten yayınlandığı ülkeler işaretlenir.`
                              : `"${highlightFilter.label}" dizisinin gerçekten yayınlandığı ülkeler işaretlenir.`
                            : undefined
                      }
                    />
                    <CountryPanel
                      country={selected}
                      allCountries={countries}
                      onClose={handleCloseSelection}
                      onSelectActor={handleSelectActor}
                      onSelectSeries={handleSelectSeries}
                      onSelectSeriesGlobal={handleSelectSeriesGlobal}
                      onSelectCountry={handleSelectCountryGlobal}
                      activeSeriesId={activeSeries?.id}
                      collapsed={panelCollapsed}
                      onToggleCollapsed={() => setPanelCollapsed((v) => !v)}
                      activeActorId={selectedActorId}
                      onCloseActor={() => setSelectedActorId(null)}
                      onShowActorNetwork={handleShowActorNetwork}
                      activeSeriesGlobalId={searchedSeriesId}
                      onCloseSeriesGlobal={() => setSearchedSeriesId(null)}
                      onShowSeriesOnMap={handleShowSeriesAvailability}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </Suspense>
      </main>
    </div>
  )
}
