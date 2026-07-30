import { useEffect, useState } from 'react'
import Sparkline from './Sparkline.jsx'
import CastBar from './CastBar.jsx'
import CircularProgress from './CircularProgress.jsx'
import { trendLabel } from '../lib/trend.js'
import { computeSharePct, totalScoreOf } from '../lib/scoreShare.js'
import { fetchRegionalInterest } from '../lib/api.js'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w92'

function yearOf(dateStr) {
  return dateStr ? dateStr.slice(0, 4) : null
}

function formatViews(n) {
  if (n == null) return null
  return new Intl.NumberFormat('tr-TR').format(n)
}

// En popüler dizi için IMDb kartı — App.jsx'te seçili ülke değiştikçe çekilen ve hem bu
// panelle hem harita içi pop-up kartla (Globe3D/Map2D) paylaşılan aynı veri.
function ImdbCard({ imdb, imdbStatus }) {
  if (imdbStatus !== 'ready' || !imdb) {
    return <p className="dashboard__empty" style={{ margin: '0.5rem 0 0' }}>IMDb verisi güncelleniyor…</p>
  }
  return (
    <div className="panel__imdb">
      <span className="panel__imdb-rating">
        {imdb.rating != null ? `⭐ ${imdb.rating.toFixed(1)}/10` : '—'}
        {imdb.votes != null ? ` (${formatViews(imdb.votes)} oy)` : ''}
      </span>
      {imdb.topCast?.length > 0 && <span className="panel__imdb-cast">Ana karakterler: {imdb.topCast.join(', ')}</span>}
    </div>
  )
}

// Best-effort bölgesel ilgi kırılımı (server/regional-interest.js) — şehir koordinatı/
// geocoding veritabanımız olmadığı için haritada pin olarak değil, burada sıralı bir liste
// olarak gösterilir. Google Trends bazı ülke/dizi kombinasyonlarında hiç veri döndürmeyebilir
// — bu durumda dürüstçe boş durum gösterilir, uydurma bir şehir listesi üretilmez.
function RegionalInterest({ seriesName, iso2 }) {
  const [state, setState] = useState({ status: 'loading', byRegion: [] })

  useEffect(() => {
    if (!seriesName || !iso2) return
    let cancelled = false
    setState({ status: 'loading', byRegion: [] })
    fetchRegionalInterest(seriesName, iso2)
      .then((res) => {
        if (cancelled) return
        setState({ status: res.byRegion?.length > 0 ? 'ready' : 'unavailable', byRegion: res.byRegion || [] })
      })
      .catch(() => {
        if (cancelled) return
        setState({ status: 'unavailable', byRegion: [] })
      })
    return () => {
      cancelled = true
    }
  }, [seriesName, iso2])

  if (state.status === 'loading') return <p className="dashboard__empty">Yükleniyor…</p>
  if (state.status === 'unavailable') {
    return <p className="dashboard__empty">Bu ülke/dizi için bölgesel arama ilgisi verisi bulunamadı.</p>
  }

  const top = state.byRegion.slice(0, 8)
  const maxValue = Math.max(...top.map((r) => r.value), 1)

  return (
    <div className="benchmark-card">
      <div className="benchmark-card__bars">
        {top.map((r) => (
          <div key={r.region} className="benchmark-card__row">
            <div className="benchmark-card__row-label">{r.region}</div>
            <div className="benchmark-card__row-bar-track">
              <div className="benchmark-card__row-bar" style={{ width: `${(r.value / maxValue) * 100}%`, background: '#3987e5' }} />
            </div>
            <div className="benchmark-card__row-value">{r.value}</div>
          </div>
        ))}
      </div>
      <p className="dashboard__hint">
        Google Trends bölgesel arama ilgisi (0-100) — gerçek izlenme rakamı değil, arama
        ilgisine dayalı bir yakınsama (proxy) göstergesidir.
      </p>
    </div>
  )
}

export default function CountryPanel({ country, onClose, imdb, imdbStatus, onSelectActor, allCountries, onFilterBySeries }) {
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    setExpandedId(null)
  }, [country?.iso2])

  if (!country) {
    return (
      <div className="panel panel--empty">
        <p>Detayları görmek için globdeki bir ülkeye tıklayın.</p>
      </div>
    )
  }

  const trend = trendLabel(country.trend)
  const sharePct = computeSharePct(country.score, totalScoreOf(allCountries))

  return (
    <div className="panel">
      <button className="panel__close" onClick={onClose} aria-label="Kapat">
        ×
      </button>
      <h2>{country.name}</h2>
      <div className="panel__score-row">
        <CircularProgress
          pct={sharePct}
          label="Bu ülkenin küresel Türk dizisi görünürlüğündeki göreli payı — kendi skoru / tüm ülkelerin toplam skoru."
        />
        <dl className="panel__stats" style={{ flex: 1 }}>
          <dt title="TMDB'nin kendi popülerlik metriği (arama/oy/trend karışımı) × yayın erişimi — gerçek izlenme rakamı değil, bir yakınsama (proxy) göstergesidir.">
            Görünürlük skoru ⓘ
          </dt>
          <dd>
            {country.score.toFixed(1)} <span className="panel__share-note">(küresel payın %{sharePct}'i)</span>
          </dd>
          <dt>En popüler dizi</dt>
          <dd>{country.topSeries ? country.topSeries.name : '—'}</dd>
          <dt>Yayındaki dizi sayısı</dt>
          <dd>{country.seriesCount}</dd>
          <dt>Baskın tema</dt>
          <dd>
            {country.dominantTheme}
            {country.isThemeUncertain && <span className="badge badge--uncertain"> (belirsiz)</span>}
          </dd>
        </dl>
      </div>

      {country.topSeries && (
        <>
          <h3>IMDb</h3>
          <ImdbCard imdb={imdb} imdbStatus={imdbStatus} />
        </>
      )}

      <h3>Trend ve Görünürlük Geçmişi</h3>
      <p className={`panel__trend-line ${trend.className}`}>
        {trend.icon} {trend.text}
      </p>
      <Sparkline history={country.history} />

      {country.topSeries && (
        <>
          <h3>Bölgesel İlgi Dağılımı</h3>
          <RegionalInterest seriesName={country.topSeries.name} iso2={country.iso2} />
        </>
      )}

      <h3>Yayındaki diziler</h3>
      <ul className="panel__series-list">
        {country.seriesList.map((s) => {
          const key = s.id ?? s.name
          const isExpanded = expandedId === key
          return (
            <li
              key={key}
              className={isExpanded ? 'panel__series-item panel__series-item--expanded' : 'panel__series-item'}
              onClick={() => setExpandedId(isExpanded ? null : key)}
            >
              <div className="panel__series-row">
                {s.posterPath ? (
                  <img className="panel__series-poster" src={`${POSTER_BASE}${s.posterPath}`} alt="" />
                ) : (
                  <span className="panel__series-poster panel__series-poster--empty" aria-hidden="true" />
                )}
                <span className="panel__series-info">
                  <span className="panel__series-name">{s.name}</span>
                  <span className="panel__series-meta">
                    {yearOf(s.firstAirDate) || '—'} · {s.theme}
                  </span>
                </span>
                <span className="panel__series-score">{s.popularity.toFixed(1)}</span>
              </div>
              {isExpanded && (
                <div className="panel__series-detail" onClick={(e) => e.stopPropagation()}>
                  <p className="panel__series-overview">{s.overview || 'Bu dizi için özet bulunmuyor.'}</p>
                  <CastBar cast={s.cast} onSelectActor={onSelectActor} />
                  <button
                    className="dashboard__link-btn panel__series-map-filter-btn"
                    onClick={() => onFilterBySeries?.(s.name)}
                    title="Genel görünüm yerine sadece bu dizinin gerçek ülke bazlı Google Trends arama ilgisini haritada göster"
                  >
                    🗺️ Bu Dizinin Küresel Dağılımını Haritada Göster
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
