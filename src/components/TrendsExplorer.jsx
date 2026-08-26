import { useEffect, useState } from 'react'
import { fetchTrendSeriesList, fetchTrends, fetchSocialListening, fetchImdbData } from '../lib/api.js'

function formatViews(n) {
  if (n == null) return '—'
  return new Intl.NumberFormat('tr-TR').format(n)
}

export default function TrendsExplorer({ onShowOnMap }) {
  const [seriesList, setSeriesList] = useState([])
  const [selected, setSelected] = useState('')
  const [result, setResult] = useState(null)
  const [social, setSocial] = useState(null)
  const [imdb, setImdb] = useState(null)
  const [imdbError, setImdbError] = useState(null)
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
    setSocial(null)
    setImdbError(null)
    setImdb(null)
    try {
      const data = await fetchTrends(selected)
      setResult(data)
      setStatus('ready')
    } catch (err) {
      setError(err.message)
      setStatus('error')
      return
    }
    try {
      const socialData = await fetchSocialListening(selected)
      setSocial(socialData)
    } catch {
      // Fragman ikincil bir bilgi — bulunamazsa/erişilemezse sessizce atlanır.
    }
    const selectedId = seriesList.find((s) => s.name === selected)?.id
    if (selectedId != null) {
      try {
        const imdbData = await fetchImdbData(selectedId)
        setImdb(imdbData)
      } catch (err) {
        setImdbError(err.message)
      }
    }
  }

  return (
    <div className="dashboard">
      <h2>Açık Kaynak İstihbaratı ve Küresel Veri Toplama Ağı</h2>
      <p className="dashboard__hint">Talep üzerine sorgulanır, sonuç kalıcı olarak önbelleklenir.</p>

      <div className="trends__controls">
        <input
          className="search-input"
          list="trends-series-list"
          type="text"
          placeholder="Dizi ara..."
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={status === 'loading'}
        />
        <datalist id="trends-series-list">
          {seriesList.map((s) => (
            <option key={s.id} value={s.name} />
          ))}
        </datalist>
        <button
          onClick={handleQuery}
          disabled={status === 'querying' || !seriesList.some((s) => s.name === selected)}
        >
          {status === 'querying' ? 'Sorgulanıyor…' : 'Sorgula'}
        </button>
      </div>

      {status === 'error' && <div className="status status--error">Hata: {error}</div>}

      {(imdbError || imdb) && (
        <section className="dashboard__section">
          <h3 className="dashboard__section-title">Puan Verisi</h3>
          {imdbError && <p className="dashboard__empty">Veri alınamadı: {imdbError}</p>}
          {imdb && (
            imdb.status === 'ready' ? (
              <ul className="panel__series-list">
                <li className="panel__series-item">
                  <div className="panel__series-row">
                    <span className="panel__series-info"><span className="panel__series-name">Puan</span></span>
                    <span className="panel__series-score">
                      {imdb.rating != null ? `⭐ ${imdb.rating.toFixed(1)}/10` : '—'}
                      {imdb.votes != null ? ` (${formatViews(imdb.votes)} oy)` : ''}
                    </span>
                  </div>
                </li>
                <li className="panel__series-item">
                  <div className="panel__series-row">
                    <span className="panel__series-info"><span className="panel__series-name">Ana Karakterler</span></span>
                    <span className="panel__series-score">
                      {imdb.topCast?.length > 0 ? imdb.topCast.join(', ') : '—'}
                    </span>
                  </div>
                </li>
              </ul>
            ) : (
              <p className="dashboard__empty">Veri güncelleniyor…</p>
            )
          )}

          {social?.youtube && (
            <>
              <h4 className="impact__rank-title" style={{ marginTop: '1.25rem' }}>Fragman</h4>
              <p className="dashboard__hint" style={{ margin: 0 }}>
                <a href={social.youtube.link} target="_blank" rel="noreferrer" className="dashboard__link-btn">
                  {social.youtube.title}
                </a>
                {' — '}
                {social.youtube.channel || 'Bilinmeyen kanal'}
                {social.youtube.channelVerified && ' ✓'}
                {' · '}
                {formatViews(social.youtube.views)} izlenme
                {social.youtube.publishedDate && ` · ${social.youtube.publishedDate}`}
              </p>
            </>
          )}
        </section>
      )}

      {result && (
        <section className="dashboard__section">
          <div className="dashboard__header-row">
            <h3 className="dashboard__section-title">Ülke Bazlı Arama İlgisi</h3>
            {result.byCountry.length > 0 && (
              <button className="dashboard__export-btn dashboard__export-btn--ghost" onClick={() => onShowOnMap?.(result)}>
                🗺️ Haritada Göster
              </button>
            )}
          </div>
          {(() => {
            const withInterest = result.byCountry.filter((row) => row.value > 0)
            return withInterest.length === 0 ? (
              <p className="dashboard__empty">Bu dizi için ülke bazlı arama ilgisi verisi bulunamadı.</p>
            ) : (
              <table className="dashboard__table">
                <thead>
                  <tr>
                    <th>Ülke</th>
                    <th>Arama İlgisi (0-100)</th>
                  </tr>
                </thead>
                <tbody>
                  {withInterest.map((row) => (
                    <tr key={row.country}>
                      <td>{row.country}</td>
                      <td>{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          })()}
        </section>
      )}
    </div>
  )
}
