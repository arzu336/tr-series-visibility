import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import CountryPanel from './components/CountryPanel.jsx'
import Legend from './components/Legend.jsx'
import Login from './components/Login.jsx'
import ChangePasswordModal from './components/ChangePasswordModal.jsx'
import ContinentSidebar from './components/ContinentSidebar.jsx'
import MapViewToggle from './components/MapViewToggle.jsx'
import ActorModal from './components/ActorModal.jsx'

const Globe3D = lazy(() => import('./components/Globe3D.jsx'))
const Map2D = lazy(() => import('./components/Map2D.jsx'))
const AnalystDashboard = lazy(() => import('./components/AnalystDashboard.jsx'))
const TrendsExplorer = lazy(() => import('./components/TrendsExplorer.jsx'))
const ImpactReport = lazy(() => import('./components/ImpactReport.jsx'))
const AdminUsersPanel = lazy(() => import('./components/AdminUsersPanel.jsx'))
const PENDING_APPROVALS_POLL_MS = 60000
const MAP_VIEW_STORAGE_KEY = 'gp_map_view'
import { fetchVisibility, fetchAuthStatus, logout, fetchAdminUsers, fetchImdbData, fetchTrends } from './lib/api.js'
import { continentCentroid } from './lib/continents.js'
import countryNames from './data/country-centroids.json'
const SIDEBAR_COLLAPSED_KEY = 'gp_sidebar_collapsed'

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
  const [seriesFilterStatus, setSeriesFilterStatus] = useState('idle') // idle | loading | error
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  })
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

  // 1. Aşama (varsayılan): harita pop-up'ı ve CountryPanel özeti SADECE dizi bilgisini
  // gösterir (dizi adı, afişi, görünürlük skoru) — ana karakter burada gösterilmez, o
  // sadece 3. aşamada (bkz. ActorModal + handleShowActorNetwork) devreye girer.
  // IMDb bölümü aynı veriyi paylaşır — seçili ülke değiştikçe en popüler dizisi için tek
  // seferlik çekilir.
  useEffect(() => {
    const tmdbId = selected?.topSeries?.id
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
  }, [selected?.topSeries?.id])

  const handleSelect = useCallback((country) => {
    setSelected(country)
    // Tek bir ülkeye odaklanmak, önceki oyuncu popülerlik ağı vurgusunu geçersiz kılar —
    // ikisi aynı anda haritada karışık görünmesin diye temizleniyor.
    setActorHighlight(null)
  }, [])

  const handleSelectCountryFromReport = useCallback(
    (iso2) => {
      const country = countries.find((c) => c.iso2 === iso2)
      if (!country) return
      setSelected({ ...country, name: countryNames[iso2]?.name || iso2 })
      setActorHighlight(null)
      setView('map')
    },
    [countries]
  )

  const handleSelectCountryFromActor = useCallback(
    (iso2) => {
      handleSelectCountryFromReport(iso2)
      setSelectedActorId(null)
    },
    [handleSelectCountryFromReport]
  )

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

  // Bir oyuncunun ActorModal'daki "Popülerlik Ağını Haritada Göster" eylemi — o oyuncunun
  // TÜM dizilerindeki TÜM ülkeleri (skorları toplanmış) tek bir vurgu katmanı olarak
  // haritaya geçirir (Lowy Institute tarzı düğüm ağı).
  const handleShowActorNetwork = useCallback((seriesList) => {
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
    setSelectedActorId(null)
  }, [])

  // CountryPanel'deki bir dizi satırından "Bu Dizinin Küresel Dağılımını Haritada Göster" —
  // henüz veri yok, gerçek ülke bazlı Google Trends arama ilgisini çekip haritayı ona göre
  // filtreler (server/serpapi.js queryTrends — aynı veri TrendsExplorer'ın da kullandığı).
  const handleFilterBySeries = useCallback(async (seriesName) => {
    setSeriesFilterStatus('loading')
    setActorHighlight(null)
    try {
      const result = await fetchTrends(seriesName)
      setSeriesFilter({ seriesName: result.seriesName, byCountry: result.byCountry })
      setSeriesFilterStatus('idle')
    } catch (err) {
      console.error('[seriesFilter]', err.message)
      setSeriesFilterStatus('error')
    }
  }, [])

  // TrendsExplorer'da zaten sorgulanmış sonucu tekrar fetch etmeden doğrudan kullanır.
  const handleShowSeriesOnMap = useCallback((result) => {
    setSeriesFilter({ seriesName: result.seriesName, byCountry: result.byCountry })
    setActorHighlight(null)
    setView('map')
  }, [])

  const clearSeriesFilter = useCallback(() => {
    setSeriesFilter(null)
    setSeriesFilterStatus('idle')
  }, [])

  const handleLogout = async () => {
    try {
      await logout()
    } finally {
      setUser(null)
      setAuthStatus('out')
    }
  }

  // Globe3D/Map2D'deki harita içi pop-up kart için: seçili ülkenin koordinatı + en popüler
  // dizisi + görünürlük skoru + baskın tema/trend (Lowy tarzı glassmorphism kartın pill
  // etiketleri için) + (yüklendiyse) IMDb verisi + kadro butonundan ActorModal'a geçiş.
  const popup =
    selected && selected.topSeries
      ? {
          iso2: selected.iso2,
          lat: countryNames[selected.iso2]?.lat,
          lng: countryNames[selected.iso2]?.lng,
          series: selected.topSeries,
          score: selected.score,
          dominantTheme: selected.dominantTheme,
          isThemeUncertain: selected.isThemeUncertain,
          trend: selected.trend,
          imdb: imdbData,
          imdbStatus,
          onSelectActor: setSelectedActorId,
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
                    {seriesFilterStatus === 'loading' && (
                      <div className="series-filter-badge series-filter-badge--loading">Dizi dağılımı yükleniyor…</div>
                    )}
                    {seriesFilterStatus === 'error' && (
                      <div className="series-filter-badge series-filter-badge--error">
                        <span>Bu dizi için arama ilgisi verisi alınamadı.</span>
                        <button onClick={clearSeriesFilter}>✕ Kapat</button>
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
                        continentHighlight={continentHighlight}
                        onResetView={handleResetMapView}
                      />
                    )}
                    <Legend
                      caption={
                        seriesFilter
                          ? `"${seriesFilter.seriesName}" için ülke bazlı Google Trends arama ilgisi (0-100) — gerçek izlenme rakamı değil, arama ilgisine dayalı bir yakınsama (proxy) göstergesidir.`
                          : undefined
                      }
                    />
                    <CountryPanel
                      country={selected}
                      onClose={() => setSelected(null)}
                      imdb={imdbData}
                      imdbStatus={imdbStatus}
                      onSelectActor={setSelectedActorId}
                      allCountries={countries}
                      onFilterBySeries={handleFilterBySeries}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </Suspense>
      </main>

      {selectedActorId != null && (
        <ActorModal
          personId={selectedActorId}
          onClose={() => setSelectedActorId(null)}
          onSelectCountry={handleSelectCountryFromActor}
          onShowNetwork={handleShowActorNetwork}
        />
      )}
    </div>
  )
}
