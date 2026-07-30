import { useEffect, useState } from 'react'
import { fetchPersonImpact } from '../lib/api.js'
import countryNames from '../data/country-centroids.json'

const PROFILE_BASE = 'https://image.tmdb.org/t/p/w185'
const POSTER_BASE = 'https://image.tmdb.org/t/p/w92'

function nameOf(iso2) {
  return countryNames[iso2]?.name || iso2
}

// Bir oyuncunun (CastBar.jsx'te tıklanan) zaten takip ettiğimiz Türk dizileri arasındaki
// diğer rollerini ve bu dizilerin küresel görünürlük dağılımını gösterir — server/cast.js
// bunu ayrı bir TMDB isteği yapmadan, zaten cache'lenmiş kadro verisinden hesaplar.
export default function ActorModal({ personId, onClose, onSelectCountry, onShowNetwork }) {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (personId == null) return
    let cancelled = false
    setStatus('loading')
    setData(null)
    fetchPersonImpact(personId)
      .then((res) => {
        if (cancelled) return
        setData(res)
        setStatus(res.status)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [personId])

  if (personId == null) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="actor-modal" onClick={(e) => e.stopPropagation()}>
        <button className="panel__close" onClick={onClose} aria-label="Kapat">
          ×
        </button>

        {status === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}
        {status === 'error' && <p className="dashboard__empty">Oyuncu verisi alınamadı: {error}</p>}
        {status === 'unavailable' && (
          <p className="dashboard__empty">Bu oyuncu için takip edilen başka bir Türk dizisi bulunamadı.</p>
        )}

        {status === 'ready' && data && (
          <>
            <div className="actor-modal__header">
              {data.person.profilePath ? (
                <img className="actor-modal__photo" src={`${PROFILE_BASE}${data.person.profilePath}`} alt="" />
              ) : (
                <span className="actor-modal__photo actor-modal__photo--empty" aria-hidden="true" />
              )}
              <h2>{data.person.name}</h2>
            </div>

            <button
              className="actor-modal__network-btn"
              onClick={() => onShowNetwork?.(data.series)}
              title="Bu oyuncunun tüm dizilerinin göründüğü ülkeleri haritada tek seferde vurgula"
            >
              🌐 Popülerlik Ağını Haritada Göster
            </button>

            <h3>Diğer Yapımlar ve Öne Çıktığı Pazarlar</h3>
            <ul className="panel__series-list">
              {data.series.map((s) => {
                const topCountry = s.countries[0]
                return (
                  <li key={s.id} className="panel__series-item">
                    <div className="panel__series-row">
                      {s.posterPath ? (
                        <img className="panel__series-poster" src={`${POSTER_BASE}${s.posterPath}`} alt="" />
                      ) : (
                        <span className="panel__series-poster panel__series-poster--empty" aria-hidden="true" />
                      )}
                      <span className="panel__series-info">
                        <span className="panel__series-name">{s.name}</span>
                        <span className="panel__series-meta">
                          {s.character} · {s.countries.length} ülkede yayında
                        </span>
                      </span>
                      <span className="panel__series-score">{s.totalScore}</span>
                    </div>
                    {topCountry && (
                      <button
                        className="dashboard__link-btn actor-modal__show-on-map"
                        onClick={() => onSelectCountry?.(topCountry.iso2)}
                      >
                        {nameOf(topCountry.iso2)}'de haritada göster
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
