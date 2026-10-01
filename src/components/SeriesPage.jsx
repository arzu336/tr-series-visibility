import { useMemo } from 'react'
import {
  fetchImdbData,
  fetchSeriesEnrichment,
  fetchSeriesCharts,
  fetchSeriesMeta,
  fetchMediaSentimentSummary,
} from '../lib/api.js'
import { useAsync } from '../lib/useAsync.js'
import CastBar from './CastBar.jsx'
import MagazineNews from './MagazineNews.jsx'
import Flag from './Flag.jsx'
import { fmtDateTr } from './ChartList.jsx'
import { AVAILABILITY_NOTE } from '../lib/methodologyNotes.js'
import countryNames from '../data/country-centroids.json'

// Dizi sayfası: haritadaki sağ panel kısa özet için; dizi hakkında her şey burada (listeler, nerede yayında,
// uluslararası isimler, magazin, kadro, basın algısı). Adresi ?dizi=<tmdbId> — geri tuşu haritaya döner.

const POSTER_BASE = 'https://image.tmdb.org/t/p/w342'

function nameOf(iso2) {
  return countryNames[iso2]?.name || iso2
}

function formatVotes(n) {
  if (n == null) return null
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`
  return String(n)
}

function Country({ iso2 }) {
  return (
    <span className="series-page__country">
      <Flag iso2={iso2} />
      {nameOf(iso2)}
    </span>
  )
}

/** Dizinin haritadaki verisinden: temel bilgiler + yayında olduğu ülkeler (o ülkedeki platformlarıyla). */
export function seriesFromCountries(allCountries, seriesId) {
  let base = null
  const availability = []
  for (const c of allCountries || []) {
    const match = c.seriesList?.find((s) => s.id === seriesId)
    if (!match) continue
    if (!base) base = match
    availability.push({ iso2: c.iso2, platforms: match.platforms || [] })
  }
  availability.sort((a, b) => nameOf(a.iso2).localeCompare(nameOf(b.iso2), 'tr'))
  return base ? { ...base, availability } : null
}

function ListingsTable({ listings }) {
  return (
    <div className="series-page__table-wrap">
      <table className="series-page__table">
        <thead>
          <tr>
            <th>Ülke</th>
            <th>Platform</th>
            <th>En iyi sıra</th>
            <th>Hafta</th>
            <th>Son</th>
          </tr>
        </thead>
        <tbody>
          {listings.map((l) => (
            <tr key={`${l.iso2}-${l.platform}`}>
              <td>
                <Country iso2={l.iso2} />
              </td>
              <td>{l.platform}</td>
              <td>#{l.bestRank}</td>
              <td>{l.weeks}</td>
              <td>{fmtDateTr(l.lastDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SentimentSummary({ seriesId }) {
  const { status, data } = useAsync(() => fetchMediaSentimentSummary(seriesId), [seriesId])
  if (status === 'loading' || status === 'idle') return <p className="dashboard__empty">Yükleniyor…</p>
  if (status === 'error' || !data || data.status === 'pending')
    return <p className="dashboard__empty">Bu dizi için henüz basın taraması yapılmadı.</p>
  if (data.status !== 'ready')
    return <p className="dashboard__empty">Taranan {data.scannedCount} ülkede yeterli haber bulunamadı.</p>
  const tone = { positive: 'olumlu', negative: 'olumsuz', neutral: 'nötr' }
  return (
    <>
      <p className="series-page__sentiment-line">
        {data.withDataCount} ülkede haber · olumlu %{data.avgPositivePct} · olumsuz %{data.avgNegativePct}
      </p>
      <ul className="series-page__chips">
        {data.countries
          .filter((c) => c.dominantSentiment && c.dominantSentiment !== 'yetersiz-veri')
          .map((c) => (
            <li key={c.iso2} className="series-page__chip">
              <Country iso2={c.iso2} />
              <span className="series-page__chip-meta">{tone[c.dominantSentiment] ?? c.dominantSentiment}</span>
            </li>
          ))}
      </ul>
    </>
  )
}

export default function SeriesPage({ seriesId, allCountries, onBack, onShowOnMap, onSelectActor, onAnalyze }) {
  const series = useMemo(() => seriesFromCountries(allCountries, seriesId), [allCountries, seriesId])
  const metaReq = useAsync(() => fetchSeriesMeta(seriesId), [seriesId], { enabled: seriesId != null })
  const imdbReq = useAsync(() => fetchImdbData(seriesId), [seriesId], { enabled: seriesId != null })
  const enrichment = useAsync(() => fetchSeriesEnrichment(seriesId), [seriesId], { enabled: seriesId != null }).data
  const chartsReq = useAsync(() => fetchSeriesCharts(seriesId), [seriesId], { enabled: seriesId != null })
  const meta = metaReq.status === 'ready' ? metaReq.data : null
  const imdb = imdbReq.status === 'ready' && imdbReq.data?.status === 'ready' ? imdbReq.data : null
  const charts = chartsReq.status === 'ready' ? chartsReq.data : null
  const listings = charts?.listings || []

  if (!series) {
    return (
      <div className="series-page">
        <button type="button" className="series-page__back" onClick={onBack}>
          ← Haritaya dön
        </button>
        <p className="dashboard__empty">Bu dizi için veri bulunamadı.</p>
      </div>
    )
  }

  const handleShowOnMap = () => {
    // Haritada vurgu: listeye girdiği ülkeler (en çok hafta); liste kaydı yoksa yayında olduğu ülkeler.
    const weeksByIso2 = new Map()
    for (const l of listings) weeksByIso2.set(l.iso2, Math.max(weeksByIso2.get(l.iso2) ?? 0, l.weeks))
    const entries = weeksByIso2.size
      ? [...weeksByIso2].map(([iso2, weeks]) => ({ iso2, weeks }))
      : series.availability.map((c) => ({ iso2: c.iso2, weeks: null }))
    onShowOnMap?.(series.name, entries)
  }

  const year = series.firstAirDate ? series.firstAirDate.slice(0, 4) : null
  const listedCountries = new Set(listings.map((l) => l.iso2)).size
  const localized = enrichment?.imdb?.localizedTitles || []

  return (
    <div className="series-page">
      <button type="button" className="series-page__back" onClick={onBack}>
        ← Haritaya dön
      </button>

      <header className="series-page__header">
        {series.posterPath ? (
          <img className="series-page__poster" src={`${POSTER_BASE}${series.posterPath}`} alt="" />
        ) : (
          <span className="series-page__poster series-page__poster--empty" aria-hidden="true" />
        )}
        <div className="series-page__intro">
          <h1 className="series-page__title">{series.name}</h1>
          <p className="series-page__meta">
            {[year, series.theme, meta?.totalEpisodes ? `${meta.totalEpisodes} bölüm` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="series-page__pills">
            {imdb?.rating != null && (
              <span className="map-popup-card__pill">
                ⭐ {imdb.rating.toFixed(1)}
                {imdb.votes != null ? ` (${formatVotes(imdb.votes)} oy)` : ''}
              </span>
            )}
            {enrichment?.dizilah?.channel && <span className="map-popup-card__pill">{enrichment.dizilah.channel}</span>}
            <span className="map-popup-card__pill">{series.availability.length} ülkede yayında</span>
            {listedCountries > 0 && <span className="map-popup-card__pill">{listedCountries} ülkede listede</span>}
          </div>
          {(meta?.overview || series.overview) && (
            <p className="series-page__overview">{meta?.overview || series.overview}</p>
          )}
          <div className="series-page__actions">
            <button type="button" className="actor-modal__network-btn" onClick={handleShowOnMap}>
              🗺️ Haritada göster
            </button>
            {onAnalyze && (
              <button type="button" className="dashboard__link-btn" onClick={() => onAnalyze(series.name)}>
                📊 Arama ilgisi analizi
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="series-page__grid">
        <div className="series-page__col">
          <section className="series-page__section">
            <h2>Listeler</h2>
            {chartsReq.status === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}
            {charts && listings.length > 0 && <ListingsTable listings={listings} />}
            {charts && listings.length === 0 && (
              <p className="dashboard__empty">Bu dizi takip ettiğimiz hiçbir listeye girmedi.</p>
            )}
          </section>

          <section className="series-page__section">
            <h2 title={AVAILABILITY_NOTE}>Nerede yayında — {series.availability.length} ülke ⓘ</h2>
            <ul className="series-page__rows">
              {series.availability.map((c) => (
                <li key={c.iso2} className="series-page__row">
                  <Country iso2={c.iso2} />
                  <span className="series-page__row-meta">{c.platforms.join(' · ')}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="series-page__col">
          <section className="series-page__section">
            <h2>Magazin</h2>
            <MagazineNews seriesId={seriesId} limit={10} />
          </section>

          {series.cast?.length > 0 && (
            <section className="series-page__section">
              <h2>Kadro</h2>
              <CastBar cast={series.cast} onSelectActor={onSelectActor} />
            </section>
          )}

          {localized.length > 0 && (
            <section className="series-page__section">
              <h2>Uluslararası isimler</h2>
              <ul className="series-page__rows">
                {localized.map((lt) => (
                  <li key={`${lt.region}-${lt.title}`} className="series-page__row">
                    <Country iso2={lt.region} />
                    <span className="series-page__row-meta">{lt.title}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="series-page__section">
            <h2>Basın &amp; medya algısı</h2>
            <SentimentSummary seriesId={seriesId} />
          </section>
        </div>
      </div>
    </div>
  )
}
