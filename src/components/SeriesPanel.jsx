import { useEffect, useMemo, useState } from 'react'
import { fetchImdbData, fetchTrends } from '../lib/api.js'
import CastBar from './CastBar.jsx'
import countryNames from '../data/country-centroids.json'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w154'

function nameOf(iso2) {
  return countryNames[iso2]?.name || iso2
}

function formatVotes(n) {
  if (n == null) return null
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`
  return String(n)
}

// Sağ panel arama barından bir DİZİ sonucuna tıklandığında açılır (bkz. CountryPanel.jsx
// activeSeriesGlobalId) — ActorPanel ile aynı mantık: arattığın şeyin (burada bir ülke
// değil, bir dizi) kendi bilgisi aynı panelde gösterilir, ilgisiz bir ülkenin tüm
// panosuna zıplamak yerine. Ülke bazlı dağılım zaten yüklü `allCountries`'ten (App.jsx)
// client-side çıkarılır — yeni bir backend isteği gerekmez.
export default function SeriesPanel({ seriesId, allCountries, onSelectActor, onShowOnMap }) {
  const [imdb, setImdb] = useState(null)
  const [imdbStatus, setImdbStatus] = useState('loading')
  const [mapFilterStatus, setMapFilterStatus] = useState('idle') // idle | loading | error

  const series = useMemo(() => {
    let base = null
    const countries = []
    for (const c of allCountries || []) {
      const match = c.seriesList?.find((s) => s.id === seriesId)
      if (match) {
        if (!base) base = match
        countries.push({ iso2: c.iso2, score: c.score })
      }
    }
    countries.sort((a, b) => b.score - a.score)
    return base ? { ...base, countries } : null
  }, [allCountries, seriesId])

  useEffect(() => {
    if (seriesId == null) return
    let cancelled = false
    setImdbStatus('loading')
    setImdb(null)
    fetchImdbData(seriesId)
      .then((res) => {
        if (cancelled) return
        setImdb(res)
        setImdbStatus(res.status)
      })
      .catch(() => {
        if (cancelled) return
        setImdbStatus('unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [seriesId])

  if (!series) {
    return <p className="dashboard__empty">Bu dizi için veri bulunamadı.</p>
  }

  const handleShowOnMap = async () => {
    setMapFilterStatus('loading')
    try {
      const result = await fetchTrends(series.name)
      onShowOnMap?.(result)
      setMapFilterStatus('idle')
    } catch (err) {
      console.error('[SeriesPanel] harita filtresi alınamadı:', err.message)
      setMapFilterStatus('error')
    }
  }

  return (
    <>
      <div className="actor-modal__header">
        {series.posterPath ? (
          <img className="panel__series-poster" src={`${POSTER_BASE}${series.posterPath}`} alt="" />
        ) : (
          <span className="panel__series-poster panel__series-poster--empty" aria-hidden="true" />
        )}
        <div>
          <h2>{series.name}</h2>
          {imdbStatus === 'ready' && imdb?.rating != null && (
            <p className="panel__series-imdb-line">
              ⭐ {imdb.rating.toFixed(1)}
              {imdb.votes != null ? ` (${formatVotes(imdb.votes)} Oy)` : ''}
            </p>
          )}
        </div>
      </div>

      <div className="map-popup-card__pills" style={{ margin: '0 0 1rem' }}>
        {series.theme && <span className="map-popup-card__pill">{series.theme}</span>}
        <span className="map-popup-card__pill">{series.countries.length} ülkede yayında</span>
      </div>

      <button
        className="actor-modal__network-btn"
        onClick={handleShowOnMap}
        disabled={mapFilterStatus === 'loading'}
        title="Bu dizinin gerçek, ülke bazlı Google Trends arama ilgisini haritada göster"
      >
        {mapFilterStatus === 'loading' ? 'Yükleniyor…' : '🗺️ Bu Dizinin Küresel Dağılımını Haritada Göster'}
      </button>
      {mapFilterStatus === 'error' && (
        <p className="dashboard__empty">Bu dizi için arama ilgisi verisi alınamadı.</p>
      )}

      {series.cast?.length > 0 && (
        <>
          <h3>Kadro</h3>
          <CastBar cast={series.cast} onSelectActor={onSelectActor} />
        </>
      )}

      <h3>Yayınlandığı Ülkeler</h3>
      <ul className="panel__series-list">
        {series.countries.map((c) => (
          <li key={c.iso2} className="panel__series-item panel__series-item--static">
            <div className="panel__series-row">
              <span className="panel__series-info">
                <span className="panel__series-name">{nameOf(c.iso2)}</span>
              </span>
              <span className="panel__series-score">{c.score.toFixed(1)}</span>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
