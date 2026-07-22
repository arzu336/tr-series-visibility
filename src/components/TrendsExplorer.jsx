import { useEffect, useState } from 'react'
import { fetchTrendSeriesList, fetchTrends, fetchSocialListening } from '../lib/api.js'

function formatViews(n) {
  if (n == null) return '—'
  return new Intl.NumberFormat('tr-TR').format(n)
}

export default function TrendsExplorer() {
  const [seriesList, setSeriesList] = useState([])
  const [selected, setSelected] = useState('')
  const [result, setResult] = useState(null)
  const [social, setSocial] = useState(null)
  const [socialError, setSocialError] = useState(null)
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
    setSocialError(null)
    setSocial(null)
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
    } catch (err) {
      setSocialError(err.message)
    }
  }

  return (
    <div className="dashboard">
      <h2>Arama İlgisi</h2>
      <p className="dashboard__hint">
        Aylık sorgu kotası sınırlıdır; her dizi yalnızca ilk sorguda kota harcar, sonrasında
        süresiz cache'lenir. Bu yüzden otomatik değil, seçtiğiniz dizi için talep üzerine çalışır.
      </p>

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

      {result && (
        <section className="dashboard__section">
          <h3 className="dashboard__section-title">Ülke Bazlı Arama İlgisi</h3>
          <p className="dashboard__hint">
            "{result.seriesName}" için {result.fromCache ? "cache'den okundu" : 'yeni çekildi'}
            {' · '}
            {new Date(result.queriedAt).toLocaleString('tr-TR')}
          </p>
          {result.byCountry.length === 0 ? (
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
                {result.byCountry.map((row) => (
                  <tr key={row.country}>
                    <td>{row.country}</td>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {socialError && (
        <section className="dashboard__section">
          <h3 className="dashboard__section-title">Sosyal Dinleme</h3>
          <p className="dashboard__empty">Sosyal dinleme verisi alınamadı: {socialError}</p>
        </section>
      )}

      {social && (
        <section className="dashboard__section">
          <h3 className="dashboard__section-title">Sosyal Dinleme</h3>
          <p className="dashboard__hint">
            {social.fromCache ? "cache'den okundu" : 'yeni çekildi'} · {new Date(social.queriedAt).toLocaleString('tr-TR')}
          </p>

          <h4 className="impact__rank-title">Beğeni Oranı</h4>
          {social.knowledgeGraph?.ratings?.length > 0 ? (
            <ul className="panel__series-list">
              {social.knowledgeGraph.ratings.map((r, i) => (
                <li key={i} className="panel__series-item">
                  <div className="panel__series-row">
                    <span className="panel__series-info">
                      <span className="panel__series-name">{r.source}</span>
                    </span>
                    <span className="panel__series-score">{r.rating}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dashboard__empty">Bu dizi için beğeni oranı bulunamadı.</p>
          )}

          <h4 className="impact__rank-title" style={{ marginTop: '1.25rem' }}>YouTube Fragmanı</h4>
          {social.youtube ? (
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
          ) : (
            <p className="dashboard__empty">Bu dizi için fragman bulunamadı.</p>
          )}
        </section>
      )}
    </div>
  )
}
