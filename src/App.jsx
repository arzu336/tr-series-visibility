import { useCallback, useEffect, useState } from 'react'
import Globe3D from './components/Globe3D.jsx'
import CountryPanel from './components/CountryPanel.jsx'
import Legend from './components/Legend.jsx'
import { fetchVisibility } from './lib/api.js'

export default function App() {
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)
  const [countries, setCountries] = useState([])
  const [meta, setMeta] = useState(null)
  const [selected, setSelected] = useState(null)

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
        <h1>Türk Dizileri — Kültürel Görünürlük Haritası</h1>
        {meta && (
          <p className="app__meta">
            {meta.seriesCount} dizi · {countries.length} ülke · güncelleme: {new Date(meta.updatedAt).toLocaleString('tr-TR')}
          </p>
        )}
      </header>

      <main className="app__main">
        {status === 'loading' && <div className="status">TMDB verisi yükleniyor…</div>}
        {status === 'error' && <div className="status status--error">Veri alınamadı: {error}</div>}
        {status === 'ready' && (
          <>
            <Globe3D countries={countries} onSelect={handleSelect} />
            <Legend />
            <CountryPanel country={selected} onClose={() => setSelected(null)} />
          </>
        )}
      </main>
    </div>
  )
}
