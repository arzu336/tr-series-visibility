import { trendLabel } from '../lib/trend.js'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w154'

function formatVotes(n) {
  if (n == null) return null
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`
  return String(n)
}

// Lowy Institute tarzı Dark Glassmorphism harita içi detay kartı — Map2D.jsx'te
// <foreignObject> içinde render edilir. Globe3D.jsx'teki buildPopupElement ile aynı
// .map-popup-card sınıflarını paylaşır (biri gerçek DOM/innerHTML, biri JSX). Sadece hızlı
// bakış içindir (dizi + skor + tema + trend + IMDb); kadro ve diğer ayrıntılar artık
// sadece sağ paneldedir (bkz. CountryPanel.jsx) — burada sadece ona işaret eden statik bir
// ipucu satırı var, ayrı bir buton/toggle yok.
export default function MapPopupCard({ popup }) {
  const { series, score, dominantTheme, trend, imdb, imdbStatus, onClose } = popup
  const trendInfo = trendLabel(trend)

  return (
    <div className="map-popup-card">
      <button className="map-popup-card__close" onClick={onClose} aria-label="Kapat">
        ✕
      </button>
      <div className="map-popup-card__top">
        <div className="map-popup-card__poster-wrap">
          {series.posterPath ? (
            <img className="map-popup-card__poster" src={`${POSTER_BASE}${series.posterPath}`} alt="" />
          ) : (
            <span className="map-popup-card__poster map-popup-card__poster--empty" aria-hidden="true" />
          )}
          {imdbStatus === 'ready' && imdb?.rating != null && (
            <div className="map-popup-card__imdb-badge" title={imdb.votes != null ? `${imdb.votes.toLocaleString('tr-TR')} oy` : undefined}>
              <span className="map-popup-card__imdb-badge-star">⭐</span>
              <span className="map-popup-card__imdb-badge-value">{imdb.rating.toFixed(1)}</span>
            </div>
          )}
        </div>
        <div className="map-popup-card__body">
          <div className="map-popup-card__name">{series.name}</div>
          {imdbStatus === 'ready' && imdb?.votes != null ? (
            <div className="map-popup-card__votes">({formatVotes(imdb.votes)} Oy)</div>
          ) : imdbStatus !== 'ready' ? (
            <div className="map-popup-card__pending">IMDb verisi güncelleniyor…</div>
          ) : null}
        </div>
      </div>

      <div className="map-popup-card__pills">
        {dominantTheme && <span className="map-popup-card__pill">{dominantTheme}</span>}
        <span className="map-popup-card__pill">Skor {score != null ? score.toFixed(1) : '—'}</span>
        <span className={`map-popup-card__pill map-popup-card__pill--${trendInfo.className}`}>
          {trendInfo.icon} {trendInfo.pct != null ? `${trendInfo.pct}%` : 'Yeni'}
        </span>
      </div>

      <p className="map-popup-card__hint">Kadro ve ayrıntılar için sağ paneli inceleyin →</p>
    </div>
  )
}
