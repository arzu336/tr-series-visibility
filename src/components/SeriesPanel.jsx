import { useEffect, useMemo, useState } from 'react'
import { fetchImdbData, fetchSeriesEnrichment } from '../lib/api.js'
import CastBar from './CastBar.jsx'
import { VISIBILITY_SCORE_NOTE } from '../lib/methodologyNotes.js'
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
  const [enrichment, setEnrichment] = useState(null)

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

  // data-pipeline-python/batch_run.py'nin ürettiği Dizilah topluluk puanı + IMDb ülke
  // bazlı yerelleştirilmiş isim verisi (bkz. server/services/pipelineData.js) —
  // pipeline'da hiç işlenmemiş bir dizi için sessizce null kalır, panel çökmez.
  useEffect(() => {
    if (seriesId == null) return
    let cancelled = false
    setEnrichment(null)
    fetchSeriesEnrichment(seriesId)
      .then((res) => {
        if (!cancelled) setEnrichment(res)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [seriesId])

  if (!series) {
    return <p className="dashboard__empty">Bu dizi için veri bulunamadı.</p>
  }

  // series.countries zaten allCountries'ten çıkarılmış GERÇEK yayın listesi (aşağıdaki
  // "Yayınlandığı Ülkeler" ile birebir aynı veri) — ayrı bir Google Trends isteğine gerek
  // yok, harita da doğrudan bu gerçek listeye göre işaretlenir.
  const handleShowOnMap = () => {
    onShowOnMap?.(series.name, series.countries)
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
          {enrichment?.dizilah?.communityRating != null && (
            <p
              className="panel__series-imdb-line"
              title="Dizilah topluluk puanı (5 üzerinden)."
            >
              📺 {enrichment.dizilah.communityRating.toFixed(1)}/5
              {enrichment.dizilah.voteCount != null ? ` (${formatVotes(enrichment.dizilah.voteCount)} oy)` : ''}
              {enrichment.dizilah.channel ? ` · ${enrichment.dizilah.channel}` : ''}
              {enrichment.dizilah.status ? ` · ${enrichment.dizilah.status}` : ''}
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
        title="Bu dizinin gerçekten yayınlandığı ülkeleri haritada işaretle"
      >
        🗺️ Bu Dizinin Yayınlandığı Ülkeleri Haritada Göster
      </button>

      {series.cast?.length > 0 && (
        <>
          <h3>Kadro</h3>
          <CastBar cast={series.cast} onSelectActor={onSelectActor} />
        </>
      )}

      <h3>Yayınlandığı Ülkeler</h3>
      <p className="dashboard__hint" title={`Sağdaki sayı ülkenin genel görünürlük skorudur. ${VISIBILITY_SCORE_NOTE}`}>
        Ülkenin genel skoru ⓘ
      </p>
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

      {enrichment?.imdb?.localizedTitles?.length > 0 && (
        <>
          <h3>Uluslararası İsimler</h3>
          <p className="dashboard__hint" title="Ülke bazlı isim kaydı.">
            Dünya genelinde bilindiği isimler ⓘ
          </p>
          <ul className="panel__series-list">
            {enrichment.imdb.localizedTitles.map((lt) => (
              <li key={`${lt.region}-${lt.title}`} className="panel__series-item panel__series-item--static">
                <div className="panel__series-row">
                  <span className="panel__series-info">
                    <span className="panel__series-name">{nameOf(lt.region)}</span>
                  </span>
                  <span className="panel__series-score">{lt.title}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
