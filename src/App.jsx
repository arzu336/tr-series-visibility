import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import CountryPanel from './components/CountryPanel.jsx'
import Legend from './components/Legend.jsx'
import Login from './components/Login.jsx'
import MapFilterCard from './components/MapFilterCard.jsx'
import ChangePasswordModal from './components/ChangePasswordModal.jsx'
import ContinentSidebar from './components/ContinentSidebar.jsx'
import MapViewToggle from './components/MapViewToggle.jsx'

import ErrorBoundary from './components/ErrorBoundary.jsx'
import { useAsync } from './lib/useAsync.js'
import { useAuth } from './lib/useAuth.js'
import { usePersistedState, boolStorage } from './lib/usePersistedState.js'

const Globe3D = lazy(() => import('./components/Globe3D.jsx'))
const Map2D = lazy(() => import('./components/Map2D.jsx'))
const AnalystDashboard = lazy(() => import('./components/AnalystDashboard.jsx'))
const TrendsExplorer = lazy(() => import('./components/TrendsExplorer.jsx'))
const ReportsHub = lazy(() => import('./components/report/ReportsHub.jsx'))
const AdminUsersPanel = lazy(() => import('./components/AdminUsersPanel.jsx'))
const PENDING_APPROVALS_POLL_MS = 60000
const MAP_VIEW_STORAGE_KEY = 'gp_map_view'
import { fetchVisibility, logout, fetchAdminUsers, fetchImdbData } from './lib/api.js'
import { continentCentroid } from './lib/continents.js'
import countryNames from './data/country-centroids.json'
import { readYoutubeNotice } from './components/YoutubeConnections.jsx'
const SIDEBAR_COLLAPSED_KEY = 'gp_sidebar_collapsed'
const PANEL_COLLAPSED_KEY = 'gp_panel_collapsed'

const darEkranVarsayilani = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches

// Dizi sayfasının adresi: ?dizi=<tmdbId>. Geri/ileri tuşu ve paylaşılan bağlantı bu parametreden açılır.
function seriesIdFromUrl() {
  if (typeof window === 'undefined') return null
  const id = Number(new URLSearchParams(window.location.search).get('dizi'))
  return Number.isInteger(id) && id > 0 ? id : null
}

export default function App() {
  const { authStatus, user, sessionNotice, refresh: loadAuthStatus, signOut } = useAuth()
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [countries, setCountries] = useState([])
  const [meta, setMeta] = useState(null)
  const [selected, setSelected] = useState(null)
  const [selectedActorId, setSelectedActorId] = useState(null)
  const [focusTarget, setFocusTarget] = useState(null)
  const [actorHighlight, setActorHighlight] = useState(null)
  const [continentHighlight, setContinentHighlight] = useState(null)
  const [seriesFilter, setSeriesFilter] = useState(null)
  const [highlightFilter, setHighlightFilter] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState(
    SIDEBAR_COLLAPSED_KEY,
    darEkranVarsayilani,
    boolStorage
  )
  const [panelCollapsed, setPanelCollapsed] = usePersistedState(PANEL_COLLAPSED_KEY, darEkranVarsayilani, boolStorage)
  const [activeSeriesId, setActiveSeriesId] = useState(null)
  // Dizi sayfası 2026-10-07'de Dizi raporuyla birleşti: ?dizi=<id> Raporlar > Dizi raporu'nu açar.
  const [view, setView] = useState(() =>
    seriesIdFromUrl() != null ? 'reports' : new URLSearchParams(window.location.search).has('yonetim') ? 'admin' : 'map'
  )
  // YouTube onay ekranından dönüş (?yonetim=youtube&youtube=…): bildirim yönetim ekranında gösterilir, adres temizlenir.
  const [youtubeNotice] = useState(() => readYoutubeNotice())
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('yonetim')) {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])
  // Raporlar menüsü: sekme (kuresel | ulke | dizi) + seçili ülke / dizi
  const [reports, setReports] = useState(() => {
    const id = seriesIdFromUrl()
    return id != null ? { tab: 'dizi', iso2: null, seriesId: id } : { tab: 'ulke', iso2: null, seriesId: null }
  })
  const openReports = useCallback((next) => {
    setReports((r) => ({ ...r, ...next }))
    setView('reports')
  }, [])
  const [mapView, setMapView] = usePersistedState(MAP_VIEW_STORAGE_KEY, '2d', {
    parse: (s) => (s === '3d' ? '3d' : '2d'),
  })
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const profileMenuRef = useRef(null)

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
    const YONETICI_GORUNUMLERI = ['dashboard', 'admin']
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

  const handleCloseSelection = useCallback(() => {
    setSelected(null)
    setSelectedActorId(null)
  }, [])

  // Dizi sayfasının açıldığı ekran: geri düğmesi ve tarayıcının geri tuşu oraya döner (Arama İlgisi'nde dizi
  // arayan kullanıcı aramaya dönebilsin; varsayılan harita).
  // null: Raporlar menüden açıldı (geri düğmesi yok).
  const [seriesReturn, setSeriesReturn] = useState(() => (seriesIdFromUrl() != null ? 'map' : null))
  const seriesReturnRef = useRef('map')

  // Tarayıcının geri/ileri tuşu: adreste ?dizi= varsa dizi sayfası, yoksa (dizi sayfasındaysak) açıldığı ekran.
  useEffect(() => {
    const onPopState = () => {
      const id = seriesIdFromUrl()
      if (id != null) {
        setReports((r) => ({ ...r, tab: 'dizi', seriesId: id }))
        setView('reports')
      } else {
        setView((v) => (v === 'reports' && seriesReturnRef.current ? seriesReturnRef.current : v))
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== 'Escape') return
      if (selectedActorId != null) {
        setSelectedActorId(null)
      } else if (selected) {
        handleCloseSelection()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selected, selectedActorId, handleCloseSelection])

  const activeSeries = selected?.seriesList?.find((s) => s.id === activeSeriesId) ?? selected?.seriesList?.[0] ?? null

  const imdbReq = useAsync(() => fetchImdbData(activeSeries.id), [activeSeries?.id], {
    enabled: activeSeries?.id != null,
  })
  const imdbData = imdbReq.status === 'ready' ? imdbReq.data : null
  const imdbStatus =
    imdbReq.status === 'ready' ? imdbReq.data.status : imdbReq.status === 'error' ? 'unavailable' : imdbReq.status

  const handleSelect = useCallback(
    (country) => {
      setSelected(country)
      setActorHighlight(null)
      setActiveSeriesId(null)
      setPanelCollapsed(false)
    },
    [setPanelCollapsed]
  )

  const handleSelectCountryFromReport = useCallback(
    (iso2) => {
      const country = countries.find((c) => c.iso2 === iso2)
      if (!country) return
      setSelected({ ...country, name: countryNames[iso2]?.name || iso2 })
      setActorHighlight(null)
      setActiveSeriesId(null)
      setPanelCollapsed(false)
      setView('map')
    },
    [countries, setPanelCollapsed]
  )

  // Herhangi bir yerde diziye tıklamak Dizi raporunu açar (sağ panel yalnızca kısa özet; 2026-10-07'den beri ayrı
  // dizi sayfası yok — içeriği rapora taşındı).
  const handleOpenSeriesPage = useCallback((seriesId, from = 'map') => {
    if (seriesId == null) return
    seriesReturnRef.current = from
    setSeriesReturn(from)
    if (seriesIdFromUrl() !== seriesId) window.history.pushState(null, '', `?dizi=${seriesId}`)
    setReports((r) => ({ ...r, tab: 'dizi', seriesId }))
    setView('reports')
    window.scrollTo?.(0, 0)
  }, [])

  const handleBackToMap = useCallback(() => {
    if (seriesIdFromUrl() != null) window.history.pushState(null, '', window.location.pathname)
    setView('map')
  }, [])

  const handleBackFromSeries = useCallback(() => {
    if (seriesIdFromUrl() != null) window.history.pushState(null, '', window.location.pathname)
    setView(seriesReturnRef.current)
  }, [])

  const handleSelectActor = useCallback(
    (personId) => {
      setSelectedActorId(personId)
      setPanelCollapsed(false)
    },
    [setPanelCollapsed]
  )

  // Dizi sayfasından oyuncuya tıklayınca haritaya dönülür, oyuncu sağ panelde açılır.
  const handleSelectActorFromSeriesPage = useCallback(
    (personId) => {
      handleBackToMap()
      handleSelectActor(personId)
    },
    [handleBackToMap, handleSelectActor]
  )

  const handleSelectCountryGlobal = handleSelectCountryFromReport

  const handleOpenReport = useCallback((iso2) => openReports({ tab: 'ulke', iso2 }), [openReports])

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

  const handleShowSeriesAvailability = useCallback((seriesName, countryEntries) => {
    // Vurgu bilgisi: { weeks } (Netflix Top 10 hafta sayısı; liste kaydı yoksa null → "yayında")
    const byIso2 = new Map((countryEntries || []).map((c) => [c.iso2, { weeks: c.weeks ?? null }]))
    setHighlightFilter({ kind: 'series', label: seriesName, byIso2 })
    setActorHighlight(null)
    setSeriesFilter(null)
  }, [])

  // Dizi sayfasındaki "İlgiyi haritada göster": haritayı dizinin ülkelere göre arama ilgisiyle boyar.
  const handleShowInterestFromPage = useCallback(
    (result) => {
      setSeriesFilter({ seriesName: result.seriesName, byCountry: result.byCountry, fromSeriesId: reports.seriesId })
      setHighlightFilter(null)
      setActorHighlight(null)
      handleBackToMap()
    },
    [handleBackToMap, reports.seriesId]
  )

  // Dizi sayfasındaki "Haritada göster": listeye girdiği ülkeleri işaretleyip haritaya döner.
  const handleShowSeriesFromPage = useCallback(
    (seriesName, countryEntries) => {
      handleShowSeriesAvailability(seriesName, countryEntries)
      setHighlightFilter((f) => (f ? { ...f, fromSeriesId: reports.seriesId } : f))
      handleBackToMap()
    },
    [handleShowSeriesAvailability, handleBackToMap, reports.seriesId]
  )

  // Haritadaki filtre şeridinden, filtreyi açan dizi sayfasına geri dönüş (2026-10-07).
  const handleReturnToSeries = useCallback(
    (seriesId) => handleOpenSeriesPage(seriesId, seriesReturnRef.current),
    [handleOpenSeriesPage]
  )

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
      signOut()
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
              <h1 title="Türk Dizileri Küresel Görünürlük Platformu">Türk Dizileri Küresel Görünürlük Platformu</h1>
              {meta && (
                <p className="app__meta">
                  {meta.seriesCount} dizi · {countries.length} ülke · güncelleme:{' '}
                  {new Date(meta.updatedAt).toLocaleString('tr-TR')}
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
              className={view === 'reports' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
              onClick={() => {
                setSeriesReturn(null)
                setView('reports')
              }}
              title="Küresel görünüm, ülke brifingi ve dizi raporu"
            >
              Raporlar
            </button>
            {user?.isAdmin && (
              <button
                className={view === 'admin' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
                onClick={() => setView('admin')}
              >
                Yönetim
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
        <ErrorBoundary name="görünüm" resetKey={view}>
          <Suspense fallback={<div className="status">Yükleniyor…</div>}>
            {view === 'dashboard' && user?.isAdmin && (
              <AnalystDashboard canEdit={Boolean(user?.isAdmin)} onViewSeriesOnMap={handleOpenSeriesPage} />
            )}
            {view === 'trends' && (
              <TrendsExplorer onOpenSeries={(id) => handleOpenSeriesPage(id, 'trends')} countries={countries} />
            )}
            {view === 'reports' && (
              <ReportsHub
                isAdmin={Boolean(user?.isAdmin)}
                countries={countries}
                tab={reports.tab}
                iso2={reports.iso2}
                seriesId={reports.seriesId}
                onChange={(next) => setReports((r) => ({ ...r, ...next }))}
                onBack={reports.tab === 'dizi' && seriesReturn ? handleBackFromSeries : null}
                backLabel={seriesReturn === 'trends' ? 'Arama İlgisi’ne dön' : 'Haritaya dön'}
                seriesActions={{
                  onShowOnMap: handleShowSeriesFromPage,
                  onSelectActor: handleSelectActorFromSeriesPage,
                  onShowInterestOnMap: handleShowInterestFromPage,
                }}
              />
            )}
            {view === 'admin' && user?.isAdmin && (
              <AdminUsersPanel currentUserId={user.id} youtubeNotice={youtubeNotice} />
            )}
            {view === 'map' && (
              <>
                {status === 'loading' && <div className="status">Veri yükleniyor…</div>}
                {status === 'error' && <div className="status status--error">Veri alınamadı: {error}</div>}
                {status === 'ready' && (
                  <div className="app__map-layout">
                    <ContinentSidebar
                      countries={countries}
                      onSelectCountry={handleSelectCountryFromReport}
                      onSelectSeries={handleOpenSeriesPage}
                      onFocusContinent={handleFocusContinent}
                      collapsed={sidebarCollapsed}
                      onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
                    />
                    <div className="app__map-pane">
                      <div className="app__map-controls">
                        <MapViewToggle value={mapView} onChange={setMapView} />
                      </div>
                      {seriesFilter && (
                        <MapFilterCard
                          kicker="Haritada gösterilen"
                          title={seriesFilter.seriesName}
                          description="Ülkelere göre arama ilgisi — koyu renk daha çok aranıyor (0–100)"
                          onReturn={
                            seriesFilter.fromSeriesId != null
                              ? () => handleReturnToSeries(seriesFilter.fromSeriesId)
                              : null
                          }
                          onClear={clearSeriesFilter}
                        />
                      )}
                      {highlightFilter && (
                        <MapFilterCard
                          kicker={highlightFilter.kind === 'actor' ? 'Oyuncunun dizileri' : 'Haritada gösterilen'}
                          title={highlightFilter.label}
                          description={
                            highlightFilter.kind === 'actor'
                              ? 'Takip edilen dizilerinden en az birinin yayınlandığı ülkeler'
                              : 'Listeye girdiği ülkeler (koyu renk daha çok hafta); kayıt yoksa yayında olduğu ülkeler'
                          }
                          onReturn={
                            highlightFilter.fromSeriesId != null
                              ? () => handleReturnToSeries(highlightFilter.fromSeriesId)
                              : null
                          }
                          onClear={clearHighlightFilter}
                        />
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
                            ? `"${seriesFilter.seriesName}" için ülke bazlı arama ilgisi (0-100) — gerçek izlenme rakamı değil, arama ilgisine dayalı bir yakınsama göstergesidir.`
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
                        onSelectSeriesGlobal={handleOpenSeriesPage}
                        onSelectCountry={handleSelectCountryGlobal}
                        collapsed={panelCollapsed}
                        onToggleCollapsed={() => setPanelCollapsed((v) => !v)}
                        activeActorId={selectedActorId}
                        onCloseActor={() => setSelectedActorId(null)}
                        onShowActorNetwork={handleShowActorNetwork}
                        onOpenReport={handleOpenReport}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  )
}
