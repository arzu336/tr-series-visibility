import { useState } from 'react'
import CastBar from './CastBar.jsx'
import { trendLabel } from '../lib/trend.js'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w154'

function formatVotes(n) {
  if (n == null) return null
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`
  return String(n)
}

// Lowy Institute tarzı Dark Glassmorphism harita içi detay kartı — Map2D.jsx'te
// <foreignObject> içinde render edilir. Globe3D.jsx'teki buildPopupElement ile aynı
// .map-popup-card sınıflarını paylaşır (biri gerçek DOM/innerHTML, biri JSX). 1. aşama
// (bkz. src/App.jsx popup state'i) dizi + skor + tema + trend + IMDb gösterir; "Ana
// Karakterler & Kadro" butonu CastBar'ı açar, bir oyuncuya tıklamak popup.onSelectActor
// üzerinden mevcut ActorModal akışını (3. aşama) tetikler — hiyerarşi bozulmadan.
export default function MapPopupCard({ popup }) {
  const [castOpen, setCastOpen] = useState(false)
  const { series, score, dominantTheme, isThemeUncertain, trend, imdb, imdbStatus, onSelectActor } = popup
  const trendInfo = trendLabel(trend)
  const cast = series.cast || []

  return (
    <div className="map-popup-card">
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
        {dominantTheme && (
          <span className="map-popup-card__pill">
            {dominantTheme}
            {isThemeUncertain ? ' ?' : ''}
          </span>
        )}
        <span className="map-popup-card__pill">Skor {score != null ? score.toFixed(1) : '—'}</span>
        <span className={`map-popup-card__pill map-popup-card__pill--${trendInfo.className}`}>
          {trendInfo.icon} {trendInfo.pct != null ? `${trendInfo.pct}%` : 'Yeni'}
        </span>
      </div>

      {cast.length > 0 && (
        <>
          <button className="map-popup-card__cast-toggle" onClick={() => setCastOpen((v) => !v)}>
            🎭 Ana Karakterler & Kadro {castOpen ? '▾' : '▸'}
          </button>
          {castOpen && (
            // Globe3D'nin vanilla-DOM popup'ı aynı .map-popup-card__cast-list sınıfını
            // classList.toggle ile açıp kapatıyor (bkz. styles.css: temel hal display:none,
            // --open display:block) — React burada zaten koşullu mount olduğu için --open'ı
            // baştan ekliyoruz, aksi halde CSS'in varsayılan gizli hali kalırdı.
            <div className="map-popup-card__cast-list map-popup-card__cast-list--open">
              <CastBar cast={cast} onSelectActor={onSelectActor} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
