import { useMemo } from 'react'
import { fetchImdbData, fetchSeriesEnrichment, fetchSeriesCharts } from '../lib/api.js'
import { useAsync } from '../lib/useAsync.js'
import CastBar from './CastBar.jsx'
import ChartList, { ChartSource } from './ChartList.jsx'
import { NETFLIX_RANK_NOTE, AVAILABILITY_NOTE } from '../lib/methodologyNotes.js'
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

export default function SeriesPanel({ seriesId, allCountries, onSelectActor, onShowOnMap }) {
  const imdbReq = useAsync(() => fetchImdbData(seriesId), [seriesId], { enabled: seriesId != null })
  const imdb = imdbReq.status === 'ready' ? imdbReq.data : null
  const imdbStatus = imdbReq.status === 'ready' ? imdb?.status : imdbReq.status === 'error' ? 'unavailable' : 'loading'
  const enrichment = useAsync(() => fetchSeriesEnrichment(seriesId), [seriesId], { enabled: seriesId != null }).data
  const chartsReq = useAsync(() => fetchSeriesCharts(seriesId), [seriesId], { enabled: seriesId != null })
  const charts = chartsReq.status === 'ready' ? chartsReq.data : null

  const series = useMemo(() => {
    let base = null
    const countries = []
    for (const c of allCountries || []) {
      const match = c.seriesList?.find((s) => s.id === seriesId)
      if (match) {
        if (!base) base = match
        countries.push({ iso2: c.iso2 })
      }
    }
    countries.sort((a, b) => nameOf(a.iso2).localeCompare(nameOf(b.iso2), 'tr'))
    return base ? { ...base, countries } : null
  }, [allCountries, seriesId])

  if (!series) {
    return <p className="dashboard__empty">Bu dizi için veri bulunamadı.</p>
  }

  const handleShowOnMap = () => {
    // Haritada vurgu: Netflix Top 10'a girdiği ülkeler (hafta sayısıyla); liste kaydı yoksa yayında olduğu ülkeler.
    const chartCountries = charts?.status === 'hesaplandi' && charts.countries.length ? charts.countries : null
    onShowOnMap?.(
      series.name,
      chartCountries
        ? chartCountries.map((c) => ({ iso2: c.iso2, weeks: c.weeks }))
        : series.countries.map((c) => ({ iso2: c.iso2, weeks: null }))
    )
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
            <p className="panel__series-imdb-line" title="Dizilah topluluk puanı (5 üzerinden).">
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
        {charts?.status === 'hesaplandi' && charts.countries.length > 0 && (
          <span className="map-popup-card__pill" title={NETFLIX_RANK_NOTE}>
            Netflix Top 10: {charts.countries.length} ülke · {charts.totalWeeks} hafta
          </span>
        )}
        {charts?.turkeyTv && (
          <span className="map-popup-card__pill">
            Türkiye TV Top 10: {charts.turkeyTv.days} gün · en iyi #{charts.turkeyTv.bestRank}
          </span>
        )}
      </div>

      <button
        className="actor-modal__network-btn"
        onClick={handleShowOnMap}
        title="Netflix Top 10'a girdiği ülkeleri (hafta sayısıyla) haritada işaretle; liste kaydı yoksa yayında olduğu ülkeler"
      >
        🗺️ Listeye Girdiği Ülkeleri Haritada Göster
      </button>

      {series.cast?.length > 0 && (
        <>
          <h3>Kadro</h3>
          <CastBar cast={series.cast} onSelectActor={onSelectActor} />
        </>
      )}

      <h3>Listeye Girdiği Ülkeler</h3>
      {chartsReq.status === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}
      {charts?.status === 'hesaplandi' && charts.countries.length > 0 && (
        <>
          <ChartList
            compact
            items={charts.countries.map((c, i) => ({
              rank: i + 1,
              name: nameOf(c.iso2),
              kind: 'series',
              periods: c.weeks,
              bestRank: c.bestRank,
              lastDate: c.lastWeek,
            }))}
          />
          <ChartSource source={charts.source} periodLabel="tüm dönem (2021→)" />
        </>
      )}
      {charts && (charts.status !== 'hesaplandi' || charts.countries.length === 0) && (
        <p className="dashboard__empty">{charts.reason || "Bu dizi Netflix Top 10'a hiçbir ülkede girmedi."}</p>
      )}

      <h3 title={AVAILABILITY_NOTE}>Yayında Olduğu Ülkeler — {series.countries.length} ⓘ</h3>
      <ul className="panel__series-list">
        {series.countries.map((c) => (
          <li key={c.iso2} className="panel__series-item panel__series-item--static">
            <div className="panel__series-row">
              <span className="panel__series-info">
                <span className="panel__series-name">{nameOf(c.iso2)}</span>
              </span>
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
