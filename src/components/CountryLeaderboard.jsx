import { useEffect, useState } from 'react'
import { fetchCountryLeaderboard } from '../lib/api.js'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w92'

const BADGE_LEVEL_CLASS = {
  verified: 'leaderboard__badge--verified',
  partial: 'leaderboard__badge--partial',
  weak: 'leaderboard__badge--weak',
}

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
          ? `Sıralama yüklenemedi (${state.error}).`
          : state.error || 'Bu ülke için henüz yeterli veri yok.'}
      </p>
    )
  }

  const { entries } = state.data
  const topBadge = entries[0]?.dataConfidence

  return (
    <div className="leaderboard">
      {topBadge && (
        <span className={`leaderboard__badge ${BADGE_LEVEL_CLASS[topBadge.level] || ''}`}>{topBadge.label}</span>
      )}

      <ol className="leaderboard__list">
        {entries.slice(0, 5).map((e, i) => (
          <li key={e.tmdbId} className="leaderboard__row">
            <span className="leaderboard__rank">{i + 1}.</span>
            {e.posterPath ? (
              <img className="leaderboard__poster" src={`${POSTER_BASE}${e.posterPath}`} alt="" />
            ) : (
              <span className="leaderboard__poster leaderboard__poster--empty" aria-hidden="true" />
            )}
            <span className="leaderboard__name">{e.name}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
