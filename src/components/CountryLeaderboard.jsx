import { useEffect, useState } from 'react'
import { fetchCountryLeaderboard } from '../lib/api.js'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w92'

// ImpactReport.jsx'teki AYNI, doğrulanmış kategorik palet (dataviz skill, --mode dark,
// arka planımız #05070d'ye göre kontrol edildi) — en fazla 5 dizi karşılaştırıldığı için
// (bkz. server/services/trendsShareOfSearch.js MAX_TERMS) tam 5 renk yeterli.
const SLOT_COLORS = ['#3987e5', '#d55181', '#9085e9', '#d95926', '#199e70']

const BADGE_LEVEL_CLASS = {
  verified: 'leaderboard__badge--verified',
  partial: 'leaderboard__badge--partial',
  weak: 'leaderboard__badge--weak',
}

function fmtScore(n) {
  return n == null ? '—' : n.toFixed(1)
}

// Proje raporu — TMDB'nin tek küresel popülerlik skoruna bağımlılığı azaltan 4 faktörlü ülke
// sıralaması (bkz. server/services/countryScoringEngine.js). Panel satırını genişletmek
// (CountryPanel.jsx) zaten bilinçli bir kullanıcı eylemi olduğu için otomatik yüklenir — Share
// of Search canlı bir SerpAPI çağrısı gerektirse de (cache-first, 15 gün TTL) bu her
// ülke için sadece İLK açılışta gerçek kota harcar.
export default function CountryLeaderboard({ iso2 }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })

  useEffect(() => {
    if (!iso2) return
    let cancelled = false
    setState({ status: 'loading', data: null, error: null })
    fetchCountryLeaderboard(iso2)
      .then((data) => {
        if (cancelled) return
        if (data.error || !data.entries?.length) {
          setState({ status: 'empty', data, error: data.error || null })
        } else {
          setState({ status: 'ready', data, error: null })
        }
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', data: null, error: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [iso2])

  if (state.status === 'loading') {
    return (
      <div className="leaderboard leaderboard--skeleton" aria-busy="true" aria-label="Ülke sıralaması yükleniyor">
        <div className="leaderboard__skel-badge" />
        <div className="leaderboard__skel-bar" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="leaderboard__skel-row" />
        ))}
      </div>
    )
  }

  if (state.status === 'error' || state.status === 'empty') {
    return (
      <p className="dashboard__empty">
        {state.status === 'error'
          ? `Ülke sıralaması yüklenemedi (${state.error}).`
          : state.error || 'Bu ülke için yerel sıralama verisi henüz hesaplanmadı.'}
      </p>
    )
  }

  const { entries } = state.data
  const topBadge = entries[0]?.dataConfidence
  const sosEntries = entries.filter((e) => e.breakdown.shareOfSearch != null)

  return (
    <div className="leaderboard">
      {topBadge && (
        <span className={`leaderboard__badge ${BADGE_LEVEL_CLASS[topBadge.level] || ''}`}>
          {topBadge.label}
        </span>
      )}

      {sosEntries.length > 0 && (
        <>
          <div className="leaderboard__sos-label">Share of Search — Arama Payı</div>
          <div className="leaderboard__sos-bar" role="img" aria-label="Dizilerin arama payı dağılımı">
            {sosEntries.map((e, i) => (
              <div
                key={e.tmdbId}
                className="leaderboard__sos-seg"
                style={{ width: `${e.breakdown.shareOfSearch}%`, background: SLOT_COLORS[i % SLOT_COLORS.length] }}
                title={`${e.name}: %${e.breakdown.shareOfSearch}`}
              />
            ))}
          </div>
          <div className="leaderboard__sos-legend">
            {sosEntries.map((e, i) => (
              <span key={e.tmdbId}>
                <i className="leaderboard__sos-dot" style={{ background: SLOT_COLORS[i % SLOT_COLORS.length] }} />
                {e.name} %{e.breakdown.shareOfSearch}
              </span>
            ))}
          </div>
        </>
      )}

      <ol className="leaderboard__list">
        {entries.map((e, i) => (
          <li key={e.tmdbId} className="leaderboard__row">
            <span className="leaderboard__rank">{i + 1}</span>
            {e.posterPath ? (
              <img className="leaderboard__poster" src={`${POSTER_BASE}${e.posterPath}`} alt="" />
            ) : (
              <span className="leaderboard__poster leaderboard__poster--empty" aria-hidden="true" />
            )}
            <div className="leaderboard__info">
              <div className="leaderboard__name">{e.name}</div>
              <div className="leaderboard__mini-bar" title={e.evidence.join(' · ')}>
                <div
                  className="leaderboard__mini-seg leaderboard__mini-seg--sos"
                  style={{ width: `${e.breakdown.shareOfSearch ?? 0}%` }}
                />
                <div
                  className="leaderboard__mini-seg leaderboard__mini-seg--netflix"
                  style={{ width: `${e.breakdown.netflix ?? 0}%` }}
                />
                <div
                  className="leaderboard__mini-seg leaderboard__mini-seg--sentiment"
                  style={{ width: `${e.breakdown.mediaSentiment ?? 0}%` }}
                />
              </div>
              <div className="leaderboard__evidence">{e.evidence.join(' · ') || 'Kanıt yok'}</div>
            </div>
            <span className="leaderboard__score">{fmtScore(e.compositeScore)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
