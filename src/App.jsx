import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import CountryPanel from './components/CountryPanel.jsx'
import Legend from './components/Legend.jsx'
import Login from './components/Login.jsx'
import ChangePasswordModal from './components/ChangePasswordModal.jsx'
import ContinentSidebar from './components/ContinentSidebar.jsx'
import MapViewToggle from './components/MapViewToggle.jsx'
import MapMetricToggle from './components/MapMetricToggle.jsx'
import { MAP_METRICS } from './lib/scale.js'

const Globe3D = lazy(() => import('./components/Globe3D.jsx'))
const Map2D = lazy(() => import('./components/Map2D.jsx'))
const AnalystDashboard = lazy(() => import('./components/AnalystDashboard.jsx'))
const TrendsExplorer = lazy(() => import('./components/TrendsExplorer.jsx'))
const ImpactAnalysisTabs = lazy(() => import('./components/ImpactAnalysisTabs.jsx'))
const AdminUsersPanel = lazy(() => import('./components/AdminUsersPanel.jsx'))
const PENDING_APPROVALS_POLL_MS = 60000
const MAP_VIEW_STORAGE_KEY = 'gp_map_view'
const MAP_METRIC_STORAGE_KEY = 'gp_map_metric'
import {
  fetchVisibility,
  fetchAuthStatus,
  logout,
  fetchAdminUsers,
  fetchImdbData,
  setUnauthorizedHandler,
} from './lib/api.js'
import { continentCentroid } from './lib/continents.js'
import countryNames from './data/country-centroids.json'
const SIDEBAR_COLLAPSED_KEY = 'gp_sidebar_collapsed'
const PANEL_COLLAPSED_KEY = 'gp_panel_collapsed'

export default function App() {
  const [authStatus, setAuthStatus] = useState('checking')
  const [sessionNotice, setSessionNotice] = useState(null)
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [countries, setCountries] = useState([])
  const [meta, setMeta] = useState(null)
  const [selected, setSelected] = useState(null)
  const [imdbData, setImdbData] = useState(null)
  const [imdbStatus, setImdbStatus] = useState('idle')
  const [selectedActorId, setSelectedActorId] = useState(null)
  const [focusTarget, setFocusTarget] = useState(null)
  const [actorHighlight, setActorHighlight] = useState(null)
  const [continentHighlight, setContinentHighlight] = useState(null)
  const [seriesFilter, setSeriesFilter] = useState(null)
  const [highlightFilter, setHighlightFilter] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    if (stored != null) return stored === '1'
    return window.matchMedia('(max-width: 900px)').matches
  })
  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    const stored = window.localStorage.getItem(PANEL_COLLAPSED_KEY)
    if (stored != null) return stored === '1'
    return window.matchMedia('(max-width: 900px)').matches
  })
  const [activeSeriesId, setActiveSeriesId] = useState(null)
  const [searchedSeriesId, setSearchedSeriesId] = useState(null)
  const [view, setView] = useState('map')
  const [mapView, setMapView] = useState(() => {
    if (typeof window === 'undefined') return '2d'
    return window.localStorage.getItem(MAP_VIEW_STORAGE_KEY) === '3d' ? '3d' : '2d'
  })
  const [mapMetric, setMapMetric] = useState(() => {
    if (typeof window === 'undefined') return MAP_METRICS.PER_CAPITA
    return window.localStorage.getItem(MAP_METRIC_STORAGE_KEY) === MAP_METRICS.TOTAL
      ? MAP_METRICS.TOTAL
      : MAP_METRICS.PER_CAPITA
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
        if (d.authenticated) setSessionNotice(null)
      })
      .catch(() => setAuthStatus('out'))
  }, [])

  useEffect(() => {
    loadAuthStatus()
  }, [loadAuthStatus])

  useEffect(() => {
    setUnauthorizedHandler((message) => {
      setUser(null)
      setAuthStatus('out')
      setSessionNotice(message)
    })
    return () => setUnauthorizedHandler(null)
  }, [])

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
    const YONETICI_GORUNUMLERI = ['dashboard', 'impact', 'admin']
    if (!user?.isAdmin && YONETICI_GORUNUMLERI.includes(view)) setView('map')
  }, [user?.isAdmin, view])

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
    window.localStorage.setItem(MAP_METRIC_STORAGE_KEY, mapMetric)
  }, [mapMetric])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  useEffect(() => {
    window.localStorage.setItem(PANEL_COLLAPSED_KEY, panelCollapsed ? '1' : '0')
  }, [panelCollapsed])

  const handleCloseSelection = useCallback(() => {
    setSelected(null)
    setSelectedActorId(null)
    setSearchedSeriesId(null)
  }, [])

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

  const activeSeries =
    selected?.seriesList?.find((s) => s.id === activeSeriesId) ?? selected?.seriesList?.[0] ?? null

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

  const handleSelect = useCallback((country) => {
    setSelected(country)
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

  const handleSelectSeries = useCallback((seriesId) => {
    setActiveSeriesId(seriesId)
  }, [])

  const handleSelectSeriesGlobal = useCallback((seriesId) => {
    setSearchedSeriesId(seriesId)
    setSelectedActorId(null)
    setPanelCollapsed(false)
  }, [])

  const handleViewSeriesOnMap = useCallback(
    (seriesId) => {
      setView('map')
      handleSelectSeriesGlobal(seriesId)
    },
    [handleSelectSeriesGlobal]
  )

  const handleSelectActor = useCallback((personId) => {
    setSelectedActorId(personId)
    setPanelCollapsed(false)
  }, [])

  const handleSelectCountryGlobal = handleSelectCountryFromReport

  const handleFocusContinent = useCallback((continentStats) => {
    const target = continentCentroid(continentStats.countries)
    if (target) setFocusTarget(target)
    setContinentHighlight(new Set(continentStats.countries.map((c) => c.iso2)))
  }, [])

  const handleResetMapView = useCallback(() => {
    setFocusTarget(null)
    setContinentHighlight(null)
  }, [])

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
  }, [])

  const handleShowSeriesAvailability = useCallback((seriesName, countryScores) => {
    const byIso2 = new Map((countryScores || []).map((c) => [c.iso2, c.score]))
    setHighlightFilter({ kind: 'series', label: seriesName, byIso2 })
    setActorHighlight(null)
    setSeriesFilter(null)
  }, [])

  const handleShowSeriesOnMap = useCallback((result) => {
    setSeriesFilter({ seriesName: result.seriesName, byCountry: result.byCountry })
    setHighlightFilter(null)
    setActorHighlight(null)
    setView('map')
    if (result.seriesId != null) {
      setSearchedSeriesId(result.seriesId)
      setSelectedActorId(null)
      setPanelCollapsed(false)
    }
  }, [])

  const handleGoToSeriesAnalysis = useCallback((seriesName) => {
    window.history.pushState(null, '', `?series=${encodeURIComponent(seriesName)}`)
    setView('trends')
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
    return <Login onSuccess={loadAuthStatus} notice={sessionNotice} />
  }

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-row">
          <div className="app__brand">
            <img src="/ib-logo.png" alt="T.C. Cumhurbaşkanlığı İletişim Başkanlığı" className="app__brand-logo" />
            <div className="app__brand-divider" />
            <div>
              <h1 title="Türk Dizileri — Kültürel Görünürlük Haritası">Türk Dizileri — Kültürel Görünürlük Haritası</h1>
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
            {/* Etki & İhracat Analizi artık yalnızca YÖNETİCİ görünümü: karar destek panelinin bu
                bölümü 11 ayrı analiz bölümü ve ~5900px içerik taşıyor (medya algısı tablosu tek
                başına 30 satır). Sıradan kullanıcının kendi panelinde bu ayrıntıya ihtiyacı yok;
                içerik silinmedi, yönetici görünümüne alındı ve PDF raporunda tam hâliyle duruyor.
                Sunucu tarafında da /api/impact* uçları requireAdmin ile korunuyor — düğmeyi
                gizlemek tek başına yalnızca görsel bir önlem olurdu. */}
            {user?.isAdmin && (
              <button
                className={view === 'impact' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
                onClick={() => setView('impact')}
                title="Ekonomik, Kültürel ve İhracat Etkisi"
              >
                Etki & İhracat Analizi
              </button>
            )}
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
          {view === 'dashboard' && user?.isAdmin && (
            <AnalystDashboard
              canEdit={Boolean(user?.isAdmin)}
              onViewSeriesOnMap={handleViewSeriesOnMap}
            />
          )}
          {view === 'trends' && <TrendsExplorer onShowOnMap={handleShowSeriesOnMap} />}
          {view === 'impact' && user?.isAdmin && (
            <ImpactAnalysisTabs onSelectCountry={handleSelectCountryFromReport} />
          )}
          {view === 'admin' && user?.isAdmin && <AdminUsersPanel currentUserId={user.id} />}
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
                    <div className="app__map-controls">
                      <MapViewToggle value={mapView} onChange={setMapView} />
                      {/* Dizi/oyuncu filtresi aktifken harita o filtrenin metriğini boyar;
                          metrik seçici o an anlamsız olurdu, bu yüzden gizlenir. */}
                      {!seriesFilter && !highlightFilter && (
                        <MapMetricToggle value={mapMetric} onChange={setMapMetric} />
                      )}
                    </div>
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
                        metric={mapMetric}
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
                        metric={mapMetric}
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
                      metric={mapMetric}
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
                      onGoToSeriesAnalysis={handleGoToSeriesAnalysis}
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
