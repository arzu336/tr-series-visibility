import { fetchCountryLeaderboard } from '../lib/api.js'
import { useAsync } from '../lib/useAsync.js'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w92'

const BADGE_LEVEL_CLASS = {
  verified: 'leaderboard__badge--verified',
  partial: 'leaderboard__badge--partial',
  weak: 'leaderboard__badge--weak',
}

function leaderboardState(req) {
  if (req.status === 'ready') {
    const data = req.data
    if (data.error || !data.entries?.length) return { status: 'empty', data, error: data.error || null }
    return { status: 'ready', data, error: null }
  }
  if (req.status === 'error') return { status: 'error', data: null, error: req.error }
  return { status: 'loading', data: null, error: null }
}

export default function CountryLeaderboard({ iso2 }) {
  const state = leaderboardState(useAsync(() => fetchCountryLeaderboard(iso2), [iso2], { enabled: Boolean(iso2) }))

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
