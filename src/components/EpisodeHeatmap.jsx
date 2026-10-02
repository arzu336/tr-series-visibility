// IMDb bölüm puanları: her satır bir sezon, her kare bir bölüm (renk = puan). Puanı olmayan bölüm gri.
// Az oylu bölümler dalgalanabilir — oy sayısı kare ipucunda yazar.

const RATING_STEPS = [
  [9, '#1a9850'],
  [8, '#66bd63'],
  [7, '#a6d96a'],
  [6, '#fee08b'],
  [5, '#fdae61'],
  [0, '#f46d43'],
]
const LEGEND = ['<5', '5', '6', '7', '8', '9+']
const MIN_RATED = 3

export function ratingColor(rating) {
  if (rating == null) return null
  return RATING_STEPS.find(([min]) => rating >= min)[1]
}

function average(episodes) {
  const rated = episodes.filter((e) => e.rating != null)
  return rated.length ? rated.reduce((sum, e) => sum + e.rating, 0) / rated.length : null
}

export default function EpisodeHeatmap({ seasons = [] }) {
  const all = seasons.flatMap((s) => s.episodes.map((e) => ({ ...e, season: s.season })))
  const rated = all.filter((e) => e.rating != null)
  if (rated.length < MIN_RATED) return null
  const best = rated.reduce((a, b) => (b.rating > a.rating ? b : a))
  const worst = rated.reduce((a, b) => (b.rating < a.rating ? b : a))

  return (
    <div className="episode-map">
      <p className="episode-map__summary">
        {rated.length}/{all.length} bölüm puanlı · en yüksek {best.season}. sezon {best.episode}. bölüm (
        {best.rating.toFixed(1)}) · en düşük {worst.season}. sezon {worst.episode}. bölüm ({worst.rating.toFixed(1)})
      </p>
      {seasons.map((s) => {
        const avg = average(s.episodes)
        return (
          <div key={s.season} className="episode-map__row">
            <span className="episode-map__label">{s.season}. sezon</span>
            <div className="episode-map__cells">
              {s.episodes.map((e) => (
                <span
                  key={e.episode}
                  className="episode-map__cell"
                  style={e.rating != null ? { background: ratingColor(e.rating) } : undefined}
                  title={
                    e.rating != null
                      ? `${s.season}. sezon ${e.episode}. bölüm: ${e.rating.toFixed(1)} (${e.votes} oy)`
                      : `${s.season}. sezon ${e.episode}. bölüm: puan yok`
                  }
                />
              ))}
            </div>
            <span className="episode-map__avg">{avg != null ? avg.toFixed(1) : '—'}</span>
          </div>
        )
      })}
      <div className="episode-map__legend" aria-hidden="true">
        {[...RATING_STEPS].reverse().map(([, color], i) => (
          <span key={color} className="episode-map__legend-item">
            <span className="episode-map__cell" style={{ background: color }} />
            {LEGEND[i]}
          </span>
        ))}
        <span className="episode-map__legend-item">
          <span className="episode-map__cell" />
          puan yok
        </span>
      </div>
    </div>
  )
}
