import { useCallback, useEffect, useState } from 'react'
import Globe3D from './components/Globe3D.jsx'
import CountryPanel from './components/CountryPanel.jsx'
import Legend from './components/Legend.jsx'
import AnalystDashboard from './components/AnalystDashboard.jsx'
import TrendsExplorer from './components/TrendsExplorer.jsx'
import ImpactReport from './components/ImpactReport.jsx'
import { fetchVisibility } from './lib/api.js'

export default function App() {
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)
  const [countries, setCountries] = useState([])
  const [meta, setMeta] = useState(null)
  const [selected, setSelected] = useState(null)
  const [view, setView] = useState('map') // map | dashboard

  useEffect(() => {
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
  }, [])

  const handleSelect = useCallback((country) => setSelected(country), [])

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
          </nav>
        </div>
      </header>

      <main className="app__main">
        {view === 'dashboard' && <AnalystDashboard />}
        {view === 'trends' && <TrendsExplorer />}
        {view === 'impact' && <ImpactReport />}
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
