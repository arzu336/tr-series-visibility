import { useEffect, useState } from 'react'
import { fetchPersonImpact, fetchImdbData } from '../lib/api.js'

const PROFILE_BASE = 'https://image.tmdb.org/t/p/w185'
const POSTER_BASE = 'https://image.tmdb.org/t/p/w92'

// Bir oyuncunun (CastBar.jsx'te tıklanan) zaten takip ettiğimiz Türk dizileri arasındaki
// diğer rollerini ve bu dizilerin küresel görünürlük dağılımını gösterir — server/cast.js
// bunu ayrı bir TMDB isteği yapmadan, zaten cache'lenmiş kadro verisinden hesaplar.
// Eskiden ortada bir modal olarak açılıyordu; artık CountryPanel'in sağ paneldeki aynı
// slotunun içinde render ediliyor (bkz. CountryPanel.jsx) — bu yüzden kendi backdrop/kapatma
// çerçevesi yok, sadece içerik döndürür.
//
// Not: "yayın platformu" burada gösterilmiyor — server/tmdb.js'teki sağlayıcı verisi
// (STREAMABLE_KEYS) doğası gereği ÜLKE BAZLI (aynı dizi bir ülkede Netflix'te, başka bir
// ülkede farklı bir platformda olabilir); dizi başına tek bir "platform" alanı göstermek
// gerçek veriyi yanlış temsil eder/uydurma bir basitleştirme olurdu, bu yüzden bilinçli
// olarak eklenmedi (bkz. proje genelindeki "gerçek veri yoksa uydurulmaz" ilkesi).
export default function ActorPanel({ personId, onShowNetwork, onSelectSeriesGlobal }) {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [imdbBySeriesId, setImdbBySeriesId] = useState({})
  const [photoFailed, setPhotoFailed] = useState(false)
  const [photoLoaded, setPhotoLoaded] = useState(false)

  useEffect(() => {
    if (personId == null) return
    let cancelled = false
    setStatus('loading')
    setData(null)
    setImdbBySeriesId({})
    setPhotoFailed(false)
    setPhotoLoaded(false)
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

  // Oyuncunun listelenen her dizisi için gerçek IMDb puanını (zaten server tarafında
  // 30 gün önbelleklenen OMDb verisi) paralel olarak çeker — CountryPanel/MapPopupCard'ın
  // kullandığı aynı /api/imdb uç noktası, uydurma bir puan üretilmez.
  useEffect(() => {
    if (status !== 'ready' || !data?.series?.length) return
    let cancelled = false
    data.series.forEach((s) => {
      fetchImdbData(s.id)
        .then((res) => {
          if (cancelled) return
          setImdbBySeriesId((prev) => ({ ...prev, [s.id]: res }))
        })
        .catch(() => {})
    })
    return () => {
      cancelled = true
    }
  }, [status, data])

  const showPhoto = data?.person?.profilePath && !photoFailed

  return (
    <>
      {status === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}
      {status === 'error' && <p className="dashboard__empty">Oyuncu verisi alınamadı: {error}</p>}
      {status === 'unavailable' && (
        <p className="dashboard__empty">Bu oyuncu için takip edilen başka bir Türk dizisi bulunamadı.</p>
      )}

      {status === 'ready' && data && (
        <>
          <div className="actor-modal__header">
            {showPhoto ? (
              <img
                key={data.person.profilePath}
                className={photoLoaded ? 'actor-modal__photo actor-modal__photo--loaded' : 'actor-modal__photo'}
                src={`${PROFILE_BASE}${data.person.profilePath}`}
                alt=""
                onLoad={() => setPhotoLoaded(true)}
                onError={() => setPhotoFailed(true)}
              />
            ) : (
              <span className="actor-modal__photo actor-modal__photo--empty" aria-hidden="true" />
            )}
            <h2>{data.person.name}</h2>
          </div>

          <button
            className="actor-modal__network-btn"
            onClick={() => onShowNetwork?.(data.person.name, data.series)}
            title="Bu oyuncunun dizilerinden en az birinin yayınlandığı ülkeleri haritada işaretle"
          >
            🌐 Bu Oyuncunun Tüm Projelerini Haritada Göster
          </button>

          <h3>Diğer Yapımlar ve Öne Çıktığı Ülkeler</h3>
          <ul className="panel__series-list">
            {data.series.map((s) => {
              const imdb = imdbBySeriesId[s.id]
              return (
                <li
                  key={s.id}
                  className="panel__series-item"
                  onClick={() => onSelectSeriesGlobal?.(s.id)}
                  title="Bu dizinin kadrosunu ve gerçekten yayınlandığı ülkeleri gör"
                >
                  <div className="panel__series-row">
                    {s.posterPath ? (
                      <img className="panel__series-poster" src={`${POSTER_BASE}${s.posterPath}`} alt="" />
                    ) : (
                      <span className="panel__series-poster panel__series-poster--empty" aria-hidden="true" />
                    )}
                    <span className="panel__series-info">
                      <span className="panel__series-name">
                        {s.name}
                        {imdb?.status === 'ready' && imdb.rating != null && (
                          <span className="panel__series-imdb" title="IMDb puanı">
                            ⭐ {imdb.rating.toFixed(1)}
                          </span>
                        )}
                      </span>
                      <span className="panel__series-meta">
                        {s.character} · {s.countries.length} ülkede yayında
                      </span>
                    </span>
                    <span className="panel__series-score">{s.totalScore}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}
