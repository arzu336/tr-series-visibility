import { useCallback, useEffect, useState } from 'react'
import Globe3D from './components/Globe3D.jsx'
import CountryPanel from './components/CountryPanel.jsx'
import Legend from './components/Legend.jsx'
import AnalystDashboard from './components/AnalystDashboard.jsx'
import TrendsExplorer from './components/TrendsExplorer.jsx'
import ImpactReport from './components/ImpactReport.jsx'
import DestinationsView from './components/DestinationsView.jsx'
import AdminUsersPanel from './components/AdminUsersPanel.jsx'
import Login from './components/Login.jsx'
import { fetchVisibility, fetchAuthStatus, logout } from './lib/api.js'
import countryNames from './data/country-centroids.json'

export default function App() {
  const [authStatus, setAuthStatus] = useState('checking') // checking | in | out
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)
  const [countries, setCountries] = useState([])
  const [meta, setMeta] = useState(null)
  const [selected, setSelected] = useState(null)
  const [view, setView] = useState('map')

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

  const handleSelect = useCallback((country) => setSelected(country), [])

  const handleSelectCountryFromReport = useCallback(
    (iso2) => {
      const country = countries.find((c) => c.iso2 === iso2)
      if (!country) return
      setSelected({ ...country, name: countryNames[iso2]?.name || iso2 })
      setView('map')
    },
    [countries]
  )

  const handleSelectDestinationFromReport = useCallback(() => setView('destinations'), [])

  const handleLogout = async () => {
    try {
      await logout()
    } finally {
      setUser(null)
      setAuthStatus('out')
    }
  }

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
          <div>
            <h1>Türk Dizileri — Kültürel Görünürlük Haritası</h1>
            {meta && (
              <p className="app__meta">
                {meta.seriesCount} dizi · {countries.length} ülke · güncelleme: {new Date(meta.updatedAt).toLocaleString('tr-TR')}
              </p>
            )}
          </div>
          <nav className="app__nav">
            <button
              className={view === 'map' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
              onClick={() => setView('map')}
            >
              Harita
            </button>
            <button
              className={view === 'dashboard' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
              onClick={() => setView('dashboard')}
            >
              Analist Paneli
            </button>
            <button
              className={view === 'trends' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
              onClick={() => setView('trends')}
            >
              Arama İlgisi
            </button>
            <button
              className={view === 'impact' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
              onClick={() => setView('impact')}
            >
              Etki Raporu
            </button>
            <button
              className={view === 'destinations' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
              onClick={() => setView('destinations')}
            >
              Destinasyonlar
            </button>
            {user?.isAdmin && (
              <button
                className={view === 'admin' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
                onClick={() => setView('admin')}
              >
                Kullanıcılar
              </button>
            )}
            <button className="app__nav-btn app__nav-btn--logout" onClick={handleLogout}>
              Çıkış Yap
            </button>
          </nav>
        </div>
      </header>

      <main className="app__main">
        {view === 'dashboard' && <AnalystDashboard />}
        {view === 'trends' && <TrendsExplorer />}
        {view === 'impact' && (
          <ImpactReport onSelectCountry={handleSelectCountryFromReport} onSelectDestination={handleSelectDestinationFromReport} />
        )}
        {view === 'destinations' && <DestinationsView />}
        {view === 'admin' && user?.isAdmin && <AdminUsersPanel />}
        {view === 'map' && (
          <>
            {status === 'loading' && <div className="status">Veri yükleniyor…</div>}
            {status === 'error' && <div className="status status--error">Veri alınamadı: {error}</div>}
            {status === 'ready' && (
              <>
                <Globe3D countries={countries} onSelect={handleSelect} />
                <Legend />
                <CountryPanel country={selected} onClose={() => setSelected(null)} />
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
