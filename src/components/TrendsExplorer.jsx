import { useEffect, useState } from 'react'
import { fetchTrendSeriesList, fetchTrends } from '../lib/api.js'

export default function TrendsExplorer() {
  const [seriesList, setSeriesList] = useState([])
  const [selected, setSelected] = useState('')
  const [result, setResult] = useState(null)
  const [status, setStatus] = useState('loading') // loading | idle | querying | ready | error
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchTrendSeriesList()
      .then((data) => {
        setSeriesList(data.items)
        setSelected(data.items[0]?.name || '')
        setStatus('idle')
      })
      .catch((err) => {
        setError(err.message)
        setStatus('error')
      })
  }, [])

  const handleQuery = async () => {
    if (!selected) return
    setStatus('querying')
    setError(null)
    try {
      const data = await fetchTrends(selected)
      setResult(data)
      setStatus('ready')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  return (
    <div className="dashboard">
      <h2>Arama İlgisi — Google Trends (SerpAPI)</h2>
      <p className="dashboard__hint">
        Ücretsiz SerpAPI planı ayda 100 sorguyla sınırlıdır; her dizi yalnızca ilk sorguda kota
        harcar, sonrasında süresiz cache'lenir. Bu yüzden otomatik değil, seçtiğiniz dizi için
        talep üzerine çalışır.
      </p>

      <div className="trends__controls">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={status === 'loading'}
        >
          {seriesList.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <button onClick={handleQuery} disabled={status === 'querying' || !selected}>
          {status === 'querying' ? 'Sorgulanıyor…' : 'Sorgula'}
        </button>
      </div>

      {status === 'error' && <div className="status status--error">Hata: {error}</div>}

      {result && (
        <>
          <p className="dashboard__hint">
            "{result.seriesName}" için {result.fromCache ? 'cache\'den okundu' : 'SerpAPI\'den yeni çekildi'}
            {' · '}
            {new Date(result.queriedAt).toLocaleString('tr-TR')}
          </p>
          {result.byCountry.length === 0 ? (
            <p>Bu dizi için ülke bazlı arama ilgisi verisi bulunamadı.</p>
          ) : (
            <table className="dashboard__table">
              <thead>
                <tr>
                  <th>Ülke</th>
                  <th>Arama İlgisi (0-100)</th>
                </tr>
              </thead>
              <tbody>
                {result.byCountry.map((row) => (
                  <tr key={row.country}>
                    <td>{row.country}</td>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}
