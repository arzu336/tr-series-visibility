import { useEffect, useState } from 'react'
import { fetchDestinationRanking } from '../lib/api.js'

export default function DestinationsView() {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchDestinationRanking()
      .then((data) => {
        setItems(data.items)
        setStatus('ready')
      })
      .catch((err) => {
        setError(err.message)
        setStatus('error')
      })
  }, [])

  if (status === 'loading') return <div className="dashboard status">Yükleniyor…</div>
  if (status === 'error') return <div className="dashboard status status--error">Hata: {error}</div>

  return (
    <div className="dashboard">
      <h2>Destinasyon Görünürlüğü</h2>
      <p className="dashboard__hint">
        Hangi Türkiye destinasyonu, dizilerin sinopsisinde geçen yer adı ve/veya analist onayı
        üzerinden en çok uluslararası görünürlük kazanıyor. Bu bir çekim lokasyonu ölçümü değil —
        Analist Paneli'nde etiketlenen dizilerin yayınlandığı ülkelerdeki toplam görünürlük skoru
        üzerinden hesaplanır.
      </p>
      {items.length === 0 ? (
        <p className="dashboard__empty">Henüz hiçbir dizi bir destinasyonla etiketlenmedi. Analist Paneli'nden etiketleme yapabilirsiniz.</p>
      ) : (
        <table className="dashboard__table">
          <thead>
            <tr>
              <th>Destinasyon</th>
              <th>Toplam görünürlük skoru</th>
              <th>Ülke sayısı</th>
              <th>Dizi sayısı</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{d.totalScore.toFixed(1)}</td>
                <td>{d.countryCount}</td>
                <td>{d.seriesCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
